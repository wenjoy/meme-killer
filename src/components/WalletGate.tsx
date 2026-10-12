'use client';

/**
 * 钱包连接与签名 —— 用网站前必须先连钱包。
 *
 * ── 为什么连接之后还要签名 ────────────────────────────────────────
 *
 * 「连上钱包」本身**不产生任何可验证的凭证**：Wallet Adapter 的 `publicKey`
 * 完全由客户端掌握，攻击者可以根本不装钱包，直接在请求头里塞一个地址。
 * 所以真正的门槛是**签名** —— 用私钥对服务端下发的挑战签一次字，
 * 服务端验证通过后才发会话 token。这一步无法伪造。
 *
 * ── 用户体验上的取舍 ──────────────────────────────────────────────
 *
 * 签名是「免 gas、不发起交易」的纯签名（`signMessage`），
 * 钱包会明确显示这是消息签名而不是转账。这一点要在 UI 里讲清楚 ——
 * 否则用户看到钱包弹窗会以为要付钱，直接关掉页面。
 *
 * 会话 24 小时有效，localStorage 里存着，所以**一个用户正常情况下
 * 一天只签一次**，不是每次扫描都签。
 */
import { useWallet } from '@solana/wallet-adapter-react';
import type { WalletAdapter } from '@solana/wallet-adapter-base';
import type { PublicKey } from '@solana/web3.js';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { track } from './analytics';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useI18n } from '@/i18n';

const TOKEN_KEY = 'mk.session';
/** 提前 5 分钟视为过期，避免「刚好在边界上」的请求失败 */
const EARLY_EXPIRY_MS = 5 * 60 * 1000;

interface StoredSession {
  token: string;
  wallet: string;
  expiresAt: number;
}

export function readSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (!s.token || !s.wallet || typeof s.expiresAt !== 'number') return null;
    if (s.expiresAt - EARLY_EXPIRY_MS < Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function writeSession(s: StoredSession | null): void {
  if (typeof window === 'undefined') return;
  if (s) localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
  else localStorage.removeItem(TOKEN_KEY);
}

/** 取当前会话 token（供 fetch 使用）。没登录返回 null。 */
export function sessionToken(): string | null {
  return readSession()?.token ?? null;
}

export type GateState = 'no-wallet' | 'need-sign' | 'ready' | 'signing' | 'error';

/**
 * 钱包主按钮的样式 —— **唯一来源**。
 *
 * 右上角与表单里那个按钮曾经长得不一样（一个有边框、一个是实心琥珀色），
 * 看起来像两个功能不同的东西。统一成一套：主操作是 accent 实心，
 * 这样用户一眼看出「这两个是同一个动作」。
 */
export const WALLET_BTN_PRIMARY =
  'rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors ' +
  'hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50';

/** 次要按钮（断开 / 重试）：与主按钮同尺寸，弱化成描边 */
export const WALLET_BTN_SECONDARY =
  'rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-ink-300 transition-colors ' +
  'hover:border-ink-500 hover:text-ink-100 disabled:opacity-50';

export interface Gate {
  state: GateState;
  wallet: string | null;
  error: string | null;
  /** 连接钱包 + 签名（如果还没签） */
  connect: () => Promise<void>;
  /** 断开并清除会话 */
  disconnect: () => void;
  /** 签名失败后重试 */
  retry: () => Promise<void>;
}

/**
 * 钱包会话 Context。
 *
 * ⚠️ **必须是 Context，不能让人各调一次 hook。**
 * 之前的 bug：`WalletButton`（顶部）与 `page.tsx`（表单门禁）各自调用
 * `useWalletGate()`，于是有两份互不相干的 `useState`。签名成功后只有
 * 其中一份变成 `ready`，另一份还停在 `no-wallet` ——
 * 界面就出现「已经签过名了，按钮还写着连接钱包」。
 *
 * 顺带也解决了「同一个钱包签名弹窗被弹两次」的问题。
 */
const GateContext = createContext<Gate | null>(null);

/**
 * 钱包会话 hook。
 *
 * 状态机：no-wallet → need-sign → signing → ready
 * 任何一步失败都落到 error，可重试。
 */
function useWalletGateState(): Gate {
  const {
    publicKey,
    connected,
    signMessage,
    disconnect: walletDisconnect,
    wallets: availableWallets,
  } = useWallet();
  const { setVisible } = useWalletModal();
  const [state, setState] = useState<GateState>('no-wallet');
  const [error, setError] = useState<string | null>(null);

  const wallet = publicKey?.toBase58() ?? null;

  /**
   * 同步状态：钱包连没连、会话有没有、是不是同一个钱包。
   *
   * ⚠️ 这里有个必须避开的坑：`doSign()` 成功后会把 state 设成 `ready`，
   * 但紧接着这个 effect 也会跑（因为 publicKey/connected 变了），
   * 如果它无条件重算，就会把刚设好的 `ready` 覆盖掉 ——
   * 表现就是「签名成功了，按钮却弹回『签名以启用』」。
   *
   * 所以：**signing 与 error 状态期间不干预**（那是 doSign 正在处理的流程）。
   */
  useEffect(() => {
    setState((prev) => {
      // 正在签名/刚出错 —— 交给 doSign 自己收尾，不要抢
      if (prev === 'signing' || prev === 'error') return prev;
      if (!wallet) return 'no-wallet';
      const s = readSession();
      // 会话必须属于**当前这个**钱包 —— 换钱包（换账号）时要重新签
      return s && s.wallet === wallet ? 'ready' : 'need-sign';
    });
  }, [wallet, connected]);

  /**
   * 等用户从弹窗里**选中**一个钱包。
   *
   * ⚠️ 不能用 `useWallet().wallet` 来等 —— 它只在 React 重新渲染后才更新，
   * 而在 `connect()` 这个 async 流程里我们需要「此刻」就知道结果。
   * 所以轮询 adapter 的 `readyState` / `connected`：
   * 一旦有 adapter 报告已连接或正在连接，就说明用户选好了。
   *
   * 超时 3 分钟：用户可能开着弹窗去装钱包，给足时间；
   * 但如果他直接关掉弹窗，这里会一直等 —— 所以同时检测弹窗是否已关闭
   * （`WalletModalProvider` 会把 `.wallet-adapter-modal` 从 DOM 移除）。
   */
  const waitForAdapter = useCallback(async (): Promise<WalletAdapter | null> => {
    /**
     * ⚠️ 这里刻意**不**用「弹窗是否还开着」来判断用户有没有放弃。
     *
     * 原因：`<WalletModalProvider>` 自己会在选中钱包后调用 `adapter.connect()`
     * 并**立即关闭弹窗**。所以「弹窗消失」并不代表用户放弃 ——
     * 恰恰相反，它通常表示用户刚选好。之前用弹窗来判断，
     * 结果选中钱包后 0.1 秒内就 return null，整个流程静默中断
     * （页面什么都不做，用户以为坏了）。
     *
     * 改成只看 adapter 状态：连上了就用，超时才放弃。
     */
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const picked = availableWallets.find((w) => w.adapter.connected || w.adapter.connecting);
      if (picked) return picked.adapter;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }, [availableWallets]);

  /**
   * 签名并换取会话。
   *
   * `explicit` 用于「刚连上钱包」的场景：此时 `publicKey` 还没通过
   * React 状态更新传播过来，闭包里拿到的仍是 null，所以把刚拿到的
   * publicKey 直接传进来 —— 否则会出现「必须点两次」。
   */
  const doSign = useCallback(
    async (explicit?: { publicKey: PublicKey; signMessage: (m: Uint8Array) => Promise<Uint8Array> }) => {
    const pk = explicit?.publicKey ?? publicKey;
    const sm = explicit?.signMessage ?? signMessage;
    if (!pk || !sm) {
      setState('error');
      setError('当前钱包不支持消息签名');
      return;
    }
    setState('signing');
    setError(null);
    try {
      const addr = pk.toBase58();

      // 1. 取挑战
      const cRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: addr }),
      });
      if (!cRes.ok) throw new Error(`获取挑战失败（HTTP ${cRes.status}）`);
      const { nonce } = (await cRes.json()) as { nonce: string };

      // 2. 钱包签名（免 gas，不发起交易）
      const sigBytes = await sm(new TextEncoder().encode(nonce));
      const signature = btoa(String.fromCharCode(...sigBytes));

      // 3. 换会话 token
      const vRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: addr, nonce, signature }),
      });
      if (!vRes.ok) {
        const j = (await vRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `签名验证失败（HTTP ${vRes.status}）`);
      }
      const { token, expiresAt } = (await vRes.json()) as {
        token: string;
        expiresAt: number;
      };
      writeSession({ token, wallet: addr, expiresAt });
      track('wallet_sign_ok');
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      track('wallet_sign_fail', undefined, {
        reason: (e instanceof Error ? e.message : String(e)).slice(0, 120),
      });
      setState('error');
    }
    },
    [publicKey, signMessage],
  );

  /**
   * 一次点击走完全程：连钱包 → 立刻签名 → 拿到会话。
   *
   * ⚠️ 之前的实现是「没连钱包就只弹选择器，然后 return」，
   * 于是用户点第一次只是把钱包连上（按钮变成「签名以启用」），
   * 必须再点第二次才弹签名 —— 这就是「点两次」的来源。
   *
   * 现在的做法：弹选择器后**等钱包连上**，拿到 publicKey 与 signMessage
   * 就直接接着签。用户全程只点一次，中间只看到钱包自己弹两次
   * （一次选钱包、一次签名确认），这是不可避免的 —— 那是钱包的行为。
   */
  const connect = useCallback(async () => {
    track('wallet_connect');
    if (wallet) {
      await doSign();
      return;
    }

    // 没连钱包：先弹选择器，再等连接结果
    setVisible(true);
    const adapter = await waitForAdapter();
    if (!adapter) return; // 用户关掉了弹窗，什么都不做

    setState('signing');
    setError(null);
    try {
      await adapter.connect();
      const pk = adapter.publicKey;
      // signMessage 只在 SignerWalletAdapter 上存在（纯 watch-only 钱包没有）
      const signer = adapter as WalletAdapter & {
        signMessage?: (m: Uint8Array) => Promise<Uint8Array>;
      };
      const sm = signer.signMessage?.bind(signer);
      if (!pk || !sm) throw new Error('钱包没有提供公钥或签名能力');
      // 把刚拿到的 pk/sm 直接传进去 —— 不能等 React 状态更新
      await doSign({ publicKey: pk, signMessage: sm });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, [wallet, setVisible, doSign, waitForAdapter]);

  const disconnect = useCallback(() => {
    writeSession(null);
    void walletDisconnect();
    setState('no-wallet');
    setError(null);
  }, [walletDisconnect]);

  return { state, wallet, error, connect, disconnect, retry: doSign };
}

/** 包住整棵需要读钱包状态的树。状态只有这一份。 */
export function WalletGateProvider({ children }: { children: ReactNode }) {
  const gate = useWalletGateState();
  // useMemo：避免每次渲染都产生新对象，导致下游组件无意义重渲染
  const value = useMemo(() => gate, [gate]);
  return <GateContext.Provider value={value}>{children}</GateContext.Provider>;
}

/**
 * 读钱包会话。
 *
 * 必须在 `WalletGateProvider` 之内 —— 缺了会直接抛错而不是静默给出
 * 错误状态（静默失败正是上一版 bug 难以察觉的原因）。
 */
export function useWalletGate(): Gate {
  const ctx = useContext(GateContext);
  if (!ctx) {
    throw new Error('useWalletGate 必须在 <WalletGateProvider> 内使用');
  }
  return ctx;
}

/**
 * 扫描前的守卫：返回 true 表示可以发请求。
 *
 * ⚠️ 这只是**前端**的拦截，目的是给用户即时反馈。
 * 真正的防护在服务端（`src/server/guard.ts`）——
 * 前端拦截可以被绕过，服务端不会。
 */
export function useScanGuard(): { token: string | null; blocked: boolean } {
  const { t } = useI18n();
  void t;
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setToken(sessionToken());
    sync();
    // 换钱包/重新签名后 localStorage 会变，但同标签页内不会触发 storage 事件，
    // 所以用一个轮询兜底（1 秒开销可忽略，而错过会导致「明明登录了却说没登录」）
    const timer = setInterval(sync, 1000);
    return () => clearInterval(timer);
  }, []);

  return { token, blocked: token === null };
}
