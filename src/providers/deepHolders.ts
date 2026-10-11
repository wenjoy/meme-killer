/**
 * 深度模式：对前 N 名持有人**逐地址拉完整历史**，算出真实成本。
 *
 * 为什么需要它：正常扫描只取「最近 100 笔 + 最早 25 笔」成交窗口，
 * 实测这个窗口只覆盖 9% 的时间跨度，导致抛压分布只能算出 14 个钱包的成本。
 * 逐地址拉完整历史后，成本覆盖率翻倍（14 → 29 / 50），而且拿到的是
 * **真实成本**而不是窗口估算。
 *
 * 为什么必须按需触发：50 个地址 = 38 秒 / 3809 笔历史。放进正常扫描会让每次
 * 体检都慢一倍，而多数人不需要这个精度。所以这里做成独立入口 + 后台任务 + 进度轮询。
 *
 * ⚠️ 限流是真实存在的：实测并发 8 时 50 个请求里 45 个被 429 拒掉，
 * 并发 3 + 指数退避才能 50/50 成功。这不是可调参数，是硬约束。
 */
import { THRESHOLDS } from '../core/constants';
import type { HolderEnumeration } from './holderList';

export interface DeepHolderTrade {
  trader: string;
  side: 'buy' | 'sell';
  sol: number;
  tokenAmount: number;
  ts?: number;
  mintLike?: true;
}

export interface DeepHolderResult {
  /** 逐地址聚合出的成交（只含本币），用于重算成本 */
  trades: DeepHolderTrade[];
  /** 实际拉了哪些地址 */
  addresses: string[];
  /** 成功/失败的地址数 */
  succeeded: number;
  failed: number;
  /** 一共翻了多少页、拿到多少笔历史 */
  pages: number;
  totalTxs: number;
  elapsedMs: number;
  warnings: string[];
}

interface HeliusHistoryTx {
  signature?: string;
  type?: string;
  timestamp?: number;
  feePayer?: string;
  fee?: number;
  transactionError?: unknown;
  tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; tokenAmount?: number; mint?: string }[];
  accountData?: { account?: string; nativeBalanceChange?: number }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchHistory(
  address: string,
  mint: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ txs: HeliusHistoryTx[]; pages: number; error?: string }> {
  const all: HeliusHistoryTx[] = [];
  let cursor: string | undefined;
  let pages = 0;
  while (pages < THRESHOLDS.sellPressure.deepMaxPages) {
    let done = false;
    for (let attempt = 0; attempt < THRESHOLDS.sellPressure.deepRetries; attempt++) {
      if (signal?.aborted) return { txs: all, pages, error: 'aborted' };
      const url =
        `https://api.helius.xyz/v0/addresses/${address}/transactions` +
        `?api-key=${apiKey}&limit=100${cursor ? `&before=${cursor}` : ''}`;
      let res: Response;
      try {
        res = await fetch(url, { signal });
      } catch (e) {
        if (attempt === THRESHOLDS.sellPressure.deepRetries - 1) {
          return { txs: all, pages, error: String(e) };
        }
        await sleep(THRESHOLDS.sellPressure.deepBackoffMs * (attempt + 1) ** 2);
        continue;
      }
      // 429 是实测中最常见的失败：并发 8 时 50 个请求里 45 个被拒
      if (res.status === 429) {
        await sleep(THRESHOLDS.sellPressure.deepBackoffMs * (attempt + 1) ** 2);
        continue;
      }
      if (!res.ok) return { txs: all, pages, error: `HTTP ${res.status}` };
      const batch = (await res.json()) as HeliusHistoryTx[];
      if (!Array.isArray(batch) || batch.length === 0) {
        done = true;
        break;
      }
      all.push(...batch);
      pages += 1;
      cursor = batch[batch.length - 1]?.signature;
      if (batch.length < 100) done = true;
      break;
    }
    if (done) break;
    if (!cursor) break;
    // 重试用尽还没拿到这一页：停在这里，已经拿到的仍然有用
    if (pages > 0 && all.length > 0 && !cursor) break;
    if (pages >= THRESHOLDS.sellPressure.deepMaxPages) break;
  }
  return { txs: all, pages };
}

/**
 * 把某个地址的历史归因成「它自己的」本币买卖。
 *
 * ⚠️ 与窗口口径同一套规则：只用 SOL 净变化与代币净变化同向的成交，
 * 并排除 CREATE/TOKEN_MINT（凭空得的筹码没有买入价）。
 */
function attribute(txs: HeliusHistoryTx[], address: string, mint: string): DeepHolderTrade[] {
  const out: DeepHolderTrade[] = [];
  for (const t of txs) {
    if (t.transactionError) continue;
    const mine = (t.tokenTransfers ?? []).filter((x) => x.mint === mint);
    if (mine.length === 0) continue;
    let netTok = 0;
    for (const tt of mine) {
      if (tt.toUserAccount === address) netTok += tt.tokenAmount ?? 0;
      if (tt.fromUserAccount === address) netTok -= tt.tokenAmount ?? 0;
    }
    if (netTok === 0) continue;
    const solDelta =
      (t.accountData ?? []).find((a) => a.account === address)?.nativeBalanceChange ?? 0;
    const sol = (solDelta + (t.fee ?? 0)) / 1e9;
    const mintLike = t.type === 'CREATE' || t.type === 'TOKEN_MINT';
    // 方向必须自洽：买入 = 付出 SOL 得到代币；卖出 = 给出代币收到 SOL
    if (netTok > 0 && sol < 0) {
      out.push({
        trader: address,
        side: 'buy',
        sol: -sol,
        tokenAmount: netTok,
        ...(t.timestamp !== undefined ? { ts: t.timestamp } : {}),
        ...(mintLike ? { mintLike: true as const } : {}),
      });
    } else if (netTok < 0 && sol > 0) {
      out.push({
        trader: address,
        side: 'sell',
        sol,
        tokenAmount: -netTok,
        ...(t.timestamp !== undefined ? { ts: t.timestamp } : {}),
      });
    }
  }
  return out;
}

/** 待深挖的地址：取有余额的前 N 名（含池/托管地址 —— 排除与否交给上层判断） */
export function pickDeepTargets(
  enumeration: HolderEnumeration,
  limit = THRESHOLDS.sellPressure.deepTopWallets,
): string[] {
  const byOwner = new Map<string, number>();
  for (const a of enumeration.accounts) {
    const amt = Number(a.amount);
    if (!(amt > 0)) continue;
    byOwner.set(a.owner, (byOwner.get(a.owner) ?? 0) + amt);
  }
  return [...byOwner.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([owner]) => owner);
}

export interface DeepProgress {
  done: number;
  total: number;
  /** 0–100 */
  pct: number;
}

/**
 * 逐地址拉完整历史。
 *
 * 并发固定为 3（实测值，不是随手设的）：并发 8 时 45/50 被 429，
 * 并发 3 + 退避重试 50/50 成功、总耗时 38 秒。
 */
export async function fetchDeepHolderHistory(
  mint: string,
  addresses: string[],
  apiKey: string,
  opts: { signal?: AbortSignal; onProgress?: (p: DeepProgress) => void } = {},
): Promise<DeepHolderResult> {
  const warnings: string[] = [];
  const started = Date.now();
  const trades: DeepHolderTrade[] = [];
  let succeeded = 0;
  let failed = 0;
  let pages = 0;
  let totalTxs = 0;
  let done = 0;

  const conc = THRESHOLDS.sellPressure.deepConcurrency;
  for (let i = 0; i < addresses.length; i += conc) {
    if (opts.signal?.aborted) break;
    const batch = addresses.slice(i, i + conc);
    const results = await Promise.all(
      batch.map((a) => fetchHistory(a, mint, apiKey, opts.signal)),
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      done += 1;
      if (r.error) {
        failed += 1;
      } else {
        succeeded += 1;
        pages += r.pages;
        totalTxs += r.txs.length;
        trades.push(...attribute(r.txs, batch[j], mint));
      }
    }
    opts.onProgress?.({
      done,
      total: addresses.length,
      pct: addresses.length > 0 ? Math.round((done / addresses.length) * 100) : 0,
    });
  }

  if (failed > 0) {
    warnings.push(
      `深度模式下有 ${failed} 个地址的历史没拉全（限流或超时），` +
        `这些地址的成本仍按窗口估算 —— 深度结果只覆盖了 ${succeeded} 个地址。`,
    );
  }
  if (totalTxs === 0 && succeeded > 0) {
    warnings.push(
      '深度模式拉到的历史里没有本币成交：这些地址的代币是从别处转入的（不是买来的），' +
        '因此拿不到买入成本。',
    );
  }

  return {
    trades,
    addresses: addresses.slice(0, succeeded + failed),
    succeeded,
    failed,
    pages,
    totalTxs,
    elapsedMs: Date.now() - started,
    warnings,
  };
}
