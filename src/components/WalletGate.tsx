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
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useCallback, useEffect, useState } from 'react';

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
 * 钱包会话 hook。
 *
 * 状态机：no-wallet → need-sign → signing → ready
 * 任何一步失败都落到 error，可重试。
 */
export function useWalletGate(): Gate {
  const { publicKey, connected, signMessage, disconnect: walletDisconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [state, setState] = useState<GateState>('no-wallet');
  const [error, setError] = useState<string | null>(null);

  const wallet = publicKey?.toBase58() ?? null;

  // 同步状态：钱包连没连、会话有没有、是不是同一个钱包
  useEffect(() => {
    if (!wallet) {
      setState('no-wallet');
      return;
    }
    const s = readSession();
    // 会话必须属于**当前这个**钱包 —— 切换钱包（换账号）时要重新签
    if (s && s.wallet === wallet) setState('ready');
    else setState('need-sign');
  }, [wallet, connected]);

  const doSign = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setState('error');
      setError('当前钱包不支持消息签名');
      return;
    }
    setState('signing');
    setError(null);
    try {
      const addr = publicKey.toBase58();

      // 1. 取挑战
      const cRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: addr }),
      });
      if (!cRes.ok) throw new Error(`获取挑战失败（HTTP ${cRes.status}）`);
      const { nonce } = (await cRes.json()) as { nonce: string };

      // 2. 钱包签名（免 gas，不发起交易）
      const sigBytes = await signMessage(new TextEncoder().encode(nonce));
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
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, [publicKey, signMessage]);

  const connect = useCallback(async () => {
    if (!wallet) {
      // 没连钱包 → 弹选择器
      setVisible(true);
      return;
    }
    await doSign();
  }, [wallet, setVisible, doSign]);

  const disconnect = useCallback(() => {
    writeSession(null);
    void walletDisconnect();
    setState('no-wallet');
    setError(null);
  }, [walletDisconnect]);

  return { state, wallet, error, connect, disconnect, retry: doSign };
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
