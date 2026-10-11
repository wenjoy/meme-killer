/**
 * RugCheck Provider —— LP 锁定/销毁、持有人数、池与金库地址。
 *
 * 为什么需要：Solana RPC 拿不到「LP 是否锁定 / 是否销毁」——
 * LP 凭证在哪个账户、锁在哪个程序里，光看 mint 账户与持仓是推不出来的。
 * 结果是 `contract.lp.locked/burned` 与 `liquidity.lpLockedOrBurned` 这类字段
 * **永远拿不到值**，分析器里对应的分支全部变成死代码：
 * 「LP 已销毁」这条利好永远不出现，而每个已毕业代币都固定背一条「LP 状态未知」。
 *
 * 实测（2026-10，对着真实响应逐字段核对过）RugCheck 的
 * `GET /v1/tokens/{mint}/report` 直接给出链上推导的结果：
 *   - `markets[].lp.lpLockedPct / lpBurnedPct`   LP 锁定/销毁比例
 *   - `markets[].lp.holders[]`                    LP 持有地址与占比（判断单一持有者）
 *   - `markets[].pubkey / liquidityA / liquidityB` 池与它的两个金库账户
 *   - `totalHolders`                              持有人总数
 *   - `risks[]`、`rugged`、`knownAccounts[]`       风险项与标签（LOCKER / CREATOR …）
 *
 * ⚠️ 三个必须记住的真实数据陷阱（都是实测撞出来的）：
 *
 * 1. **`marketType: "pump_fun"` 是 bonding curve，不是 AMM 池。**
 *    它也会报 `lpLockedPct: 100`（曲线的钱本来就在曲线里），
 *    把它当成「LP 已锁定」会给还没毕业的代币发一张安全证明。判定 LP 必须排除它。
 * 2. **大币的 report 能大到几 MB**（实测某个热门币 > 667KB 还没读完）。
 *    因此带字节上限读取：超限就退回 `/report/summary`（体积小，
 *    含 `lpLockedPct` 但不含 LP 持有者明细），而不是把内存和延迟交给运气。
 * 3. **`risks[]` 是判定，不是事实。** 只作为 warnings 展示，不直接变成 finding；
 *    `rugged: false` 也不代表安全，所以只写 `true`，不用它产出任何积极信号。
 */
import { BURN_ADDRESSES } from '@/core/constants';
import type { ContractInfo, FieldOrigin, LiquidityInfo } from '@/core/types';

const BASE = 'https://api.rugcheck.xyz/v1/tokens';
const TIMEOUT_MS = 8000;
/** 完整 report 的读取上限；超过就退到 summary 端点 */
const REPORT_MAX_BYTES = 3_000_000;
const SUMMARY_MAX_BYTES = 200_000;
/** 锁定/销毁比例达到该值才认为「已锁定 / 已销毁」 */
const LOCKED_PCT = 95;
/** Solana 零地址：RugCheck 用它表示「这个池还没有 LP mint」 */
const NULL_ADDRESS = '11111111111111111111111111111111';

interface RugLpHolder {
  owner?: string;
  pct?: number;
  amount?: number;
}

interface RugLp {
  lpMint?: string;
  /** 锁定比例（%）；注意 pump_fun 曲线市场也会是 100 */
  lpLockedPct?: number;
  lpBurnedPct?: number;
  pctSupply?: number;
  baseUSD?: number;
  quoteUSD?: number;
  lpLockedUSD?: number;
  /** 已锁定的 LP 数量（最小单位） */
  lpLocked?: number;
  /** **未**锁定且未销毁的 LP 数量（最小单位）—— 能被持有人提走的那部分 */
  lpUnlocked?: number;
  lpTotalSupply?: number;
  holders?: RugLpHolder[];
}

/** RugCheck 的 lockers 表：锁仓合约地址 → 合约详情 */
interface RugLocker {
  programID?: string;
  tokenAccount?: string;
  owner?: string;
  uri?: string;
  /** 解锁时间（unix 秒） */
  unlockDate?: number;
  type?: string;
}

interface RugMarket {
  pubkey?: string;
  /** "pump_fun" = bonding curve；"pump_fun_amm" 等才是真实 AMM 池 */
  marketType?: string;
  mintLP?: string;
  liquidityA?: string;
  liquidityB?: string;
  lp?: RugLp;
}

export interface RugReport {
  markets?: RugMarket[];
  /** summary 端点只有这个顶层字段 */
  lpLockedPct?: number;
  totalHolders?: number;
  totalMarketLiquidity?: number;
  rugged?: boolean;
  risks?: { name?: string; level?: string; value?: string }[];
  knownAccounts?: Record<string, { name?: string; type?: string } | undefined>;
  lockers?: Record<string, RugLocker>;
}

export interface RugCheckResult {
  /** LP 状态；只有真的判定出结果时才写字段，未知一律留空 */
  lp?: ContractInfo['lp'];
  /** 是否确认存在 AMM 池（bonding curve 不算） */
  hasAmmMarket: boolean;
  /** 是否确认仍停在 bonding curve 上 */
  stillOnCurve: boolean;
  /** AMM 池 / 金库账户地址，用于持仓剔除 */
  poolAddresses: string[];
  liquidity?: Partial<LiquidityInfo>;
  warnings: string[];
  origin: FieldOrigin;
}

/** 纯映射：把 RugCheck 的响应变成归一化字段。与网络解耦，便于单测。 */
export function mapRugCheckReport(report: RugReport): Omit<RugCheckResult, 'origin'> {
  const warnings: string[] = [];
  const markets = Array.isArray(report.markets) ? report.markets : [];
  // ⚠️ 曲线市场要排除在 LP 判定之外，但它的金库地址仍然要收进来做持仓剔除
  const ammMarkets = markets.filter((m) => m.marketType !== 'pump_fun');
  const curveMarkets = markets.filter((m) => m.marketType === 'pump_fun');

  const poolAddresses = new Set<string>();
  const addAddr = (a?: unknown) => {
    if (typeof a === 'string' && a.length >= 32 && a.length <= 44) poolAddresses.add(a);
  };
  for (const m of markets) {
    addAddr(m.pubkey);
    addAddr(m.liquidityA);
    addAddr(m.liquidityB);
  }

  const known = report.knownAccounts ?? {};
  const liquidity: Partial<LiquidityInfo> = {};
  if (typeof report.totalMarketLiquidity === 'number' && report.totalMarketLiquidity > 0) {
    liquidity.liquidityUsd = report.totalMarketLiquidity;
  }
  if (typeof report.totalHolders === 'number' && report.totalHolders > 0) {
    liquidity.holderCount = report.totalHolders;
  }
  if (report.rugged === true) liquidity.rugged = true;

  for (const r of report.risks ?? []) {
    if (r?.name) warnings.push(`RugCheck 风险项：${r.name}${r.level ? `（${r.level}）` : ''}`);
  }

  // ── 主市场：成交深度最大的那个 AMM 池 ────────────────────────────
  // 与 DexScreener 的 pickMainPair 同思路：主池才代表真实可撤走的流动性。
  const depth = (m: RugMarket) =>
    (m.lp?.baseUSD ?? 0) + (m.lp?.quoteUSD ?? 0) || (m.lp?.lpLockedUSD ?? 0);
  const main = [...ammMarkets].sort((a, b) => depth(b) - depth(a))[0];
  const lpInfo: ContractInfo['lp'] | undefined = main ? {} : undefined;

  // ⚠️ LP mint 缺失或为零地址 → 该市场的 LP 数据不可用，必须整体忽略。
  // 实测：新币索引未完成时 RugCheck 会返回 mintLP = 1111…（零地址）
  // 并附带一个假的「LP 持有者」，据此判定「LP 未锁定 + 单一持有」会得到
  // 与事实相反的结论（本是 LP 尚未建立，却被判成正在被单一地址控制）。
  const lpUsable = Boolean(main?.mintLP && main.mintLP !== NULL_ADDRESS);
  const lp: RugLp | undefined = lpUsable ? main?.lp : undefined;
  if (main && !lpUsable) {
    warnings.push(
      'RugCheck 的这个池还没有有效的 LP mint（索引未完成），LP 锁定/销毁状态无法判定，已按「未知」处理。',
    );
  }

  // summary 端点没有 markets，只有顶层 lpLockedPct —— 至少能判定「已锁定」
  if (!main && typeof report.lpLockedPct === 'number') {
    const locked = report.lpLockedPct >= LOCKED_PCT;
    return {
      lp: { locked, lockedPct: report.lpLockedPct },
      hasAmmMarket: false,
      stillOnCurve: false,
      poolAddresses: [...poolAddresses],
      liquidity,
      warnings: [
        'RugCheck 只返回了汇总数据（完整报告过大），因此只能判定 LP 锁定比例，' +
          '拿不到 LP 持有者与池地址。',
        ...warnings,
      ],
    };
  }

  if (lpInfo && lp) {
    const lockedPct = lp.lpLockedPct;
    const burnedPct = lp.lpBurnedPct;
    if (typeof burnedPct === 'number') lpInfo.burned = burnedPct >= LOCKED_PCT;
    if (typeof lockedPct === 'number') {
      lpInfo.locked = lockedPct >= LOCKED_PCT;
      lpInfo.lockedPct = Math.max(lockedPct, burnedPct ?? 0);
    } else if (typeof burnedPct === 'number') {
      lpInfo.lockedPct = burnedPct;
    }

    // LP 持有者明细：按占比排序，判断「销毁」与「单一持有者」
    const holders = [...(lp.holders ?? [])]
      .filter((h) => typeof h.owner === 'string')
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const top = holders[0];
    if (top && (top.pct ?? 0) >= LOCKED_PCT && BURN_ADDRESSES.has(top.owner!)) {
      // LP 凭证在销毁地址里 —— 这比任何「锁定」都更硬
      lpInfo.burned = true;
      lpInfo.locked = false;
      lpInfo.lockedPct = 100;
    }

    // ── 证据：未锁部分占比 + LP 持有者明细 ──────────────────────
    // 「未锁定也未销毁」这条结论不能只有一句判断，必须带上可核对的原始数字：
    // 未锁占比是多少、这些 LP 凭证在谁手里（RugCheck 的 knownAccounts 会标注
    // Creator / LOCKER 等身份）。否则「项目方随时可撤池」就是没有依据的断言。
    const unlockedTokens = typeof lp.lpUnlocked === 'number' ? lp.lpUnlocked : undefined;
    const lpSupply = typeof lp.lpTotalSupply === 'number' && lp.lpTotalSupply > 0 ? lp.lpTotalSupply : undefined;
    if (unlockedTokens !== undefined && lpSupply !== undefined) {
      lpInfo.unlockedPct = (unlockedTokens / lpSupply) * 100;
    } else if (typeof lockedPct === 'number' || typeof burnedPct === 'number') {
      lpInfo.unlockedPct = Math.max(0, 100 - Math.max(lockedPct ?? 0, burnedPct ?? 0));
    }

    // ⚠️ 关键修正：`lpUnlocked` 不等于「可随时撤走」。
    // 实测 `AVKpeeWa…pump`（lpLockedPct 68.3%）与 `BdzaE3T7…pump`（50.6%）：
    // 未锁的那部分 LP 全部躺在 Streamflow 线性解锁合约里，持有人是 LOCKER 账户 ——
    // 它们不能立刻全额提走（逐步解锁），只是「还没锁到 RugCheck 的 locked 口径」。
    // 把这段算成撤池风险会冤枉项目方，所以按持有人身份再拆一刀。
    const lockersByAccount = new Map<string, RugLocker>();
    for (const entry of Object.values(report.lockers ?? {})) {
      if (!entry) continue;
      if (entry.tokenAccount) lockersByAccount.set(entry.tokenAccount, entry);
      if (entry.owner) lockersByAccount.set(entry.owner, entry);
    }
    const lockerOf = (owner: string): RugLocker | undefined =>
      known[owner]?.type === 'LOCKER' ? (lockersByAccount.get(owner) ?? {}) : lockersByAccount.get(owner);
    const unlockAtOf = (entry: RugLocker | undefined): string | undefined => {
      const sec = entry?.unlockDate;
      if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return undefined;
      const d = new Date(sec * 1000);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
    };

    // ⚠️ 这里刻意**不做加减法**：RugCheck 的 `lpUnlocked` 与 `holders[]` 并不是
    // 一套自洽的账。实测 `BdzaE3T7…pump`：lpUnlocked = 49.4%，但持有者明细里
    // 锁仓合约就占 50.6%（正好等于 lpLockedPct），其余 49% 不对应任何可见账户
    // （多半已销毁或由 AMM 自身持有）。用 `unlocked − locker` 会算出负数或
    // 自相矛盾的结论，所以两个占比各自独立统计、各自署上来源。
    const lockerPct = holders
      .filter((h) => lockerOf(h.owner!))
      .reduce((sum, h) => sum + (h.pct ?? 0), 0);
    if (lockerPct > 0) lpInfo.lockerPct = lockerPct;
    // 可自由提走 = 普通钱包持有（既不是锁仓合约，也不是销毁地址）
    lpInfo.withdrawablePct = holders
      .filter((h) => !lockerOf(h.owner!) && !BURN_ADDRESSES.has(h.owner!))
      .reduce((sum, h) => sum + (h.pct ?? 0), 0);

    if (holders.length > 0) {
      lpInfo.lpHolders = holders.slice(0, 3).map((h) => {
        const locker = lockerOf(h.owner!);
        const unlockAt = unlockAtOf(locker);
        return {
          owner: h.owner!,
          pct: h.pct ?? 0,
          ...(known[h.owner!]?.name || known[h.owner!]?.type || locker
            ? { label: known[h.owner!]?.name ?? known[h.owner!]?.type ?? locker?.type }
            : {}),
          ...(locker ? { isLocker: true } : {}),
          ...(unlockAt ? { unlockAt } : {}),
        };
      });
    }

    if (lpInfo.burned !== true) {
      if (lpInfo.locked === true) {
        const locker = holders
          .map((h) => (h.owner ? known[h.owner] : undefined))
          .find((k) => k?.type === 'LOCKER');
        if (locker?.name) lpInfo.locker = locker.name;
      } else if (lpInfo.locked === false) {
        // 已确认未锁定：单一「可自由撤走」的持有者才是随时可撤池的那个地址。
        // 锁仓/线性解锁账户不算 —— 它不能立刻全额提走。
        const freeHolders = holders.filter((h) => !lockerOf(h.owner!));
        const topFree = freeHolders[0];
        if (freeHolders.length === 1 && (topFree?.pct ?? 0) >= LOCKED_PCT) {
          lpInfo.singleHolder = true;
          lpInfo.holder = topFree!.owner;
        }
      }
    }
  }

  const stillOnCurve = ammMarkets.length === 0 && curveMarkets.length > 0;
  return {
    ...(lpInfo ? { lp: lpInfo } : {}),
    hasAmmMarket: ammMarkets.length > 0,
    stillOnCurve,
    poolAddresses: [...poolAddresses],
    liquidity: Object.keys(liquidity).length > 0 ? liquidity : undefined,
    warnings,
  };
}

/** 带超时与字节上限的 JSON 读取 —— 大响应必须能被主动放弃，而不是拖垮整次扫描 */
async function getJson(
  url: string,
  maxBytes: number,
): Promise<{ ok: true; json: unknown } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const text = await readCapped(res, maxBytes);
    if (text === null) return { ok: false, reason: `响应超过 ${Math.round(maxBytes / 1e6)}MB` };
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: aborted ? `超时（${TIMEOUT_MS}ms）` : msg(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** 读响应体，超过 maxBytes 立即放弃（返回 null）而不是继续吃内存 */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const body = res.body;
  if (!body) {
    const text = await res.text();
    return text.length > maxBytes ? null : text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function fetchRugCheck(mint: string): Promise<RugCheckResult> {
  const full = await getJson(`${BASE}/${mint}/report`, REPORT_MAX_BYTES);
  if (full.ok) {
    const mapped = mapRugCheckReport(full.json as RugReport);
    return { ...mapped, origin: 'rugcheck' };
  }

  const summary = await getJson(`${BASE}/${mint}/report/summary`, SUMMARY_MAX_BYTES);
  if (summary.ok) {
    const mapped = mapRugCheckReport(summary.json as RugReport);
    return {
      ...mapped,
      origin: 'rugcheck',
      warnings: [
        `RugCheck 完整报告不可用（${full.reason}），已退回汇总接口。`,
        ...mapped.warnings,
      ],
    };
  }

  return {
    hasAmmMarket: false,
    stillOnCurve: false,
    poolAddresses: [],
    warnings: [
      `RugCheck 不可用（${full.reason}；汇总接口：${summary.reason}）—— ` +
        'LP 是否锁定/销毁、持有人总数本次无法判定，报告中会如实标为「未知」。',
    ],
    origin: 'unavailable',
  };
}
