/**
 * 全量持有人枚举与分布总览。
 *
 * 为什么要单独做一层：`getTokenLargestAccounts` 只给前 20 名，回答不了
 * 「筹码结构长什么样」这个问题（是少数大户 + 海量灰尘，还是均匀分散）。
 *
 * 实测（9raUVuzeWUk53co63M4WXLWPWE4Xc6Lpn7RS9dnkpump，9,447 个 token account）：
 * - `getProgramAccounts` + `dataSlice{offset:32,length:40}` **一次调用 642ms**
 *   就拿到每个账户的 `owner + 余额`（token account 布局：mint@0、owner@32、amount@64，
 *   所以切片 32..72 正好同时覆盖 owner 与 amount；两个代币程序布局一致）。
 * - Helius DAS `getTokenAccounts` 分页 1000/页 ≈ 1s/页，全量要 10s 以上 —— 作为兜底。
 *
 * ⚠️ 三个口径必须同时说清楚，不能只报一个数：
 * 链上账户数（含已清空的 ATA）、**有余额账户数**、以及 RugCheck 的 `totalHolders`。
 * 实测同一个币：9,447 / 5,566 / 9,456 —— 差在「卖光后没关闭的空账户」算不算持有人。
 */
import { Connection, PublicKey } from '@solana/web3.js';
import type { Warning } from '../core/types';
import { warn } from '../core/warning';

import { BURN_ADDRESSES, THRESHOLDS } from '@/core/constants';
import { classifyHolder, isExcludedKind, type HolderKind } from '@/core/analyzers/holders';
import type {
  HolderBucket,
  HolderCurvePoint,
  HolderOverview,
  HolderRow,
  RawHolder,
} from '@/core/types';
import { RPC_TIMEOUT_MS, rpcUrl, timedFetch, withRetry } from './helius';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
/** token account 的数据长度（用于 dataSize 过滤；T22 多 17 字节扩展） */
const ACCOUNT_SIZE: Record<string, number> = {
  [TOKEN_PROGRAM]: 165,
  [TOKEN_2022_PROGRAM]: 182,
};
/** 明细接口每页上限 */
export const MAX_PAGE_SIZE = 200;
/** 兜底分页最多取多少页（1000/页）——超出的部分如实标注「不完整」 */
const MAX_DAS_PAGES = 40;

export interface RawTokenAccount {
  /** token account 地址 */
  account: string;
  owner: string;
  /** 原始整数余额（lamports 单位，未除 decimals） */
  amount: bigint;
}

export interface HolderEnumeration {
  accounts: RawTokenAccount[];
  source: 'rpc' | 'das';
  /** 是否因为上限而没取全 */
  truncated: boolean;
  warnings: Warning[];
}

interface DasTokenAccount {
  address?: string;
  owner?: string;
  amount?: number | string;
}

async function viaGetProgramAccounts(mint: string, tokenProgram: string): Promise<RawTokenAccount[]> {
  const conn = new Connection(rpcUrl(), {
    commitment: 'confirmed',
    fetch: timedFetch(Math.max(RPC_TIMEOUT_MS, 30_000)),
  });
  const size = ACCOUNT_SIZE[tokenProgram] ?? ACCOUNT_SIZE[TOKEN_PROGRAM];
  const rows = await conn.getProgramAccounts(new PublicKey(tokenProgram), {
    filters: [{ dataSize: size }, { memcmp: { offset: 0, bytes: mint } }],
    // owner(32..64) + amount(64..72)：一次把「谁、多少」都取回来
    dataSlice: { offset: 32, length: 40 },
  });
  return rows.map((r) => {
    const d = r.account.data;
    return {
      account: r.pubkey.toBase58(),
      owner: new PublicKey(d.subarray(0, 32)).toBase58(),
      amount: d.readBigUInt64LE(32),
    };
  });
}

/** Helius DAS 分页兜底（字段更全但慢：1000/页 ≈ 1s） */
async function viaDas(mint: string): Promise<{ accounts: RawTokenAccount[]; truncated: boolean }> {
  const out: RawTokenAccount[] = [];
  let cursor: string | undefined;
  let truncated = false;
  for (let page = 0; page < MAX_DAS_PAGES; page++) {
    const res = await fetch(rpcUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccounts',
        params: { mint, limit: 1000, ...(cursor ? { cursor } : {}) },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await res.json()) as {
      result?: { token_accounts?: DasTokenAccount[]; cursor?: string };
      error?: unknown;
    };
    if (j.error) throw new Error(`DAS getTokenAccounts: ${JSON.stringify(j.error).slice(0, 200)}`);
    const list = j.result?.token_accounts ?? [];
    for (const t of list) {
      if (!t.address || !t.owner) continue;
      out.push({ account: t.address, owner: t.owner, amount: BigInt(t.amount ?? 0) });
    }
    cursor = j.result?.cursor;
    if (!cursor || list.length === 0) return { accounts: out, truncated: false };
  }
  truncated = true;
  return { accounts: out, truncated };
}

/**
 * 枚举该 mint 的**全部** token account。
 * 先走 RPC 全量（快），失败或被拒再降级 DAS 分页（慢，可能不完整）。
 */
export async function fetchHolderAccounts(
  mint: string,
  tokenProgram?: string,
): Promise<HolderEnumeration> {
  const warnings: Warning[] = [];
  const programs = tokenProgram
    ? [tokenProgram]
    : [TOKEN_PROGRAM, TOKEN_2022_PROGRAM];

  for (const program of programs) {
    if (!ACCOUNT_SIZE[program]) continue;
    try {
      const accounts = await withRetry(() => viaGetProgramAccounts(mint, program), 2);
      if (accounts.length > 0) {
        return { accounts, source: 'rpc', truncated: false, warnings };
      }
    } catch (e) {
      warnings.push(
        warn(
          'warnings.holderList.rpcFailed',
          { program: program.slice(0, 8), reason: e instanceof Error ? e.message : String(e) },
          `RPC 全量枚举失败（${program.slice(0, 8)}…）：${e instanceof Error ? e.message : String(e)}。` +
            '已降级为 DAS 分页，结果可能不完整。',
        ),
      );
    }
  }

  try {
    const { accounts, truncated } = await viaDas(mint);
    if (accounts.length === 0) {
      return {
        accounts: [],
        source: 'das',
        truncated: false,
        warnings: [
          ...warnings,
          warn(
            'warnings.holderList.empty',
            undefined,
            '全量枚举没有得到任何 token account（该 mint 可能没有持有人）。',
          ),
        ],
      };
    }
    if (truncated) {
      warnings.push(
        warn(
          'warnings.holderList.dasCapped',
          { pages: MAX_DAS_PAGES, n: accounts.length },
          `DAS 分页达到上限（${MAX_DAS_PAGES} 页 × 1000），只取到前 ${accounts.length} 个账户，` +
            '分布图与持有人数**不完整**，不要当作全量。',
        ),
      );
    }
    return { accounts, source: 'das', truncated, warnings };
  } catch (e) {
    return {
      accounts: [],
      source: 'das',
      truncated: false,
      warnings: [
        ...warnings,
        warn(
          'warnings.holderList.enumerationFailed',
          { reason: e instanceof Error ? e.message : String(e) },
          `全量持有人枚举失败：${e instanceof Error ? e.message : String(e)}。本项无法计算。`,
        ),
      ],
    };
  }
}

/**
 * 取「已缓存的」枚举结果，**不发新请求**。
 *
 * 深度分析用它复用扫描时那次枚举 —— 重新枚举 9446 个账户要 0.6 秒且没必要，
 * 更重要的是必须保证深度分析用的地址集合与报告里展示的是同一份。
 * 没有缓存时返回 undefined，由调用方告诉用户「请先扫描一次」。
 */
export function getHolderEnumerationCached(mint: string): HolderEnumeration | undefined {
  const hit = cache.get(mint);
  if (!hit) return undefined;
  // 深度流程可能隔一会儿才发起，这里放宽到 10 分钟（与明细缓存一致）
  if (Date.now() - hit.at > THRESHOLDS.holders.overviewDetailTtlMs) return undefined;
  return hit.data;
}

/** 测试用：直接塞一份枚举进缓存，避免测试里真的去拉链上数据 */
export function cacheHolderEnumerationForTest(mint: string, data: HolderEnumeration): void {
  cache.set(mint, { at: Date.now(), data, decimals: 0 });
}

/** 内存缓存：明细分页时避免把 2.6MB 的全量数据反复拉一遍 */
const cache = new Map<string, { at: number; data: HolderEnumeration; decimals: number }>();

export async function getHolderAccountsCached(
  mint: string,
  tokenProgram?: string,
  decimals = 0,
): Promise<HolderEnumeration> {
  const hit = cache.get(mint);
  const ttl = THRESHOLDS.holders.overviewCacheTtlMs;
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await fetchHolderAccounts(mint, tokenProgram);
  cache.set(mint, { at: Date.now(), data, decimals });
  // 不让缓存无限增长：超过 8 个 mint 就丢最旧的
  if (cache.size > 8) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return data;
}

// ── 纯计算部分（可直接测）──────────────────────────────────────────

export interface OwnerAggregate {
  owner: string;
  /** UI 单位数量 */
  amount: number;
  accounts: number;
  pct: number;
  kind: HolderKind;
  counted: boolean;
}

/**
 * 按 owner 合并账户并分类。
 *
 * ⚠️ 同一 owner 可能有多个 token account（实测有 owner 拿 3 个），
 * 按账户数当持有人会把一个人算成好几个。
 * 分类优先复用扫描已经判定过的前 20 名（它们带着链上反查出来的托管 / 狙击标记），
 * 更深的行只能按地址归类 —— 托管判定需要逐账户反查控制程序，成本不允许。
 */
/**
 * 计算所需的上下文（窄接口：不依赖整个 ScanInput，便于直接测）。
 * `supplyUi` 是 UI 单位的总量（例如 1e9 枚），`decimals` 用来把原始整数换算回去。
 */
export interface OverviewContext {
  decimals: number;
  /** 总量（UI 单位） */
  supplyUi: number;
  /** 扫描已判定的前 20 名持仓（带托管 / 狙击标记），用于复用分类 */
  knownHolders: RawHolder[];
  poolAddresses: string[];
  creator?: string;
  launchWallet?: string;
  linkedWallets?: string[];
}

export function aggregateOwners(
  accounts: RawTokenAccount[],
  ctx: OverviewContext,
): OwnerAggregate[] {
  const { decimals } = ctx;
  const supplyRaw = ctx.supplyUi * 10 ** decimals || 1;
  const merged = new Map<string, { raw: bigint; accounts: number }>();
  for (const a of accounts) {
    const cur = merged.get(a.owner) ?? { raw: 0n, accounts: 0 };
    cur.raw += a.amount;
    cur.accounts += 1;
    merged.set(a.owner, cur);
  }

  const known = new Map<string, RawHolder>(ctx.knownHolders.map((h) => [h.address, h]));
  const poolAddresses = new Set(ctx.poolAddresses);
  const relatedWallets = new Set(
    [ctx.launchWallet, ...(ctx.linkedWallets ?? [])].filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    ),
  );

  const out: OwnerAggregate[] = [];
  for (const [owner, v] of merged) {
    const rawUi = Number(v.raw) / 10 ** decimals;
    const pct = supplyRaw > 0 ? (Number(v.raw) / supplyRaw) * 100 : 0;
    const base: RawHolder = known.get(owner) ?? { address: owner, amount: rawUi, pct };
    const kind = classifyHolder(
      { ...base, amount: rawUi, pct },
      { creator: ctx.creator, relatedWallets, poolAddresses, burnAddresses: BURN_ADDRESSES },
    );
    out.push({
      owner,
      amount: rawUi,
      accounts: v.accounts,
      pct,
      kind,
      counted: !isExcludedKind(kind),
    });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

/** 分桶（占总供应量，对数分桶） */
export function buildBuckets(owners: OwnerAggregate[]): HolderBucket[] {
  const defs: { label: string; min: number; max?: number }[] = [
    { label: '< 0.0001%', min: 0, max: 0.0001 },
    { label: '0.0001% – 0.001%', min: 0.0001, max: 0.001 },
    { label: '0.001% – 0.01%', min: 0.001, max: 0.01 },
    { label: '0.01% – 0.1%', min: 0.01, max: 0.1 },
    { label: '0.1% – 1%', min: 0.1, max: 1 },
    { label: '1% – 5%', min: 1, max: 5 },
    { label: '≥ 5%', min: 5 },
  ];
  return defs.map((d) => {
    const inB = owners.filter((o) => o.pct >= d.min && (d.max === undefined || o.pct < d.max));
    return {
      label: d.label,
      minPct: d.min,
      ...(d.max !== undefined ? { maxPct: d.max } : {}),
      owners: inB.length,
      pct: inB.reduce((s, o) => s + o.pct, 0),
    };
  });
}

/**
 * 累计集中度曲线（三个口径，见 HolderCurvePoint 注释）。
 *
 * 「占流通盘」不是另一个数据，而是把「剔除后占总供应量」换了个分母 ——
 * 换分母这件事必须在界面上写明，否则同一个 Top10 会出现三个数字。
 */
export function buildCurve(owners: OwnerAggregate[], circulatingPct: number): HolderCurvePoint[] {
  const counted = owners.filter((o) => o.counted);
  return THRESHOLDS.holders.overviewCurvePoints.filter((n) => n <= owners.length).map((n) => {
    const topAll = owners.slice(0, n).reduce((s, o) => s + o.pct, 0);
    const topCounted = counted.slice(0, n).reduce((s, o) => s + o.pct, 0);
    return {
      top: n,
      cumPctAll: topAll,
      cumPctCounted: topCounted,
      // 分母 = 总量 − 池/销毁/锁仓（与报告里的 Top10 集中度用**同一个**分母，
      // 这样界面上那个 38.22% 和 finding 里的 38.22% 一定是同一个数）
      cumPctCirculating: circulatingPct > 0 ? (topCounted / circulatingPct) * 100 : 0,
    };
  });
}

/** 达到目标累计占比需要多少个持有人（只在「计入集中度」的集合里算） */
export function ownersFor(owners: OwnerAggregate[], targetPct: number): number | undefined {
  const counted = owners.filter((o) => o.counted);
  const total = counted.reduce((s, o) => s + o.pct, 0);
  if (total <= 0) return undefined;
  let acc = 0;
  for (let i = 0; i < counted.length; i++) {
    acc += counted[i].pct;
    if ((acc / total) * 100 >= targetPct) return i + 1;
  }
  return undefined;
}

export interface OverviewResult {
  overview: HolderOverview;
  /** 合并并分类后的持有人列表 —— 明细接口直接翻这一份，不重算 */
  owners: OwnerAggregate[];
}

/** 组装总览（纯函数：给定账户列表与扫描上下文，产出报告里那块数据） */
export function buildHolderOverview(
  enumeration: HolderEnumeration,
  ctx: OverviewContext,
  opts: { reportedHolders?: number } = {},
): OverviewResult {
  const accountsWithBalance = enumeration.accounts.filter((a) => a.amount > 0n);
  const owners = aggregateOwners(enumeration.accounts, ctx);
  const ownersWithBalance = aggregateOwners(accountsWithBalance, ctx);
  const counted = ownersWithBalance.filter((o) => o.counted);
  const dustThreshold = THRESHOLDS.holders.overviewDustPct;
  const dust = counted.filter((o) => o.pct < dustThreshold);
  const coveredPct = owners.reduce((s, o) => s + o.pct, 0);
  const excludedPct = Math.max(0, coveredPct - counted.reduce((s, o) => s + o.pct, 0));
  // 流通盘分母 = 总量 − 剔除项。用 100 减而不是「枚举到的计入项之和」：
  // 后者在枚举不完整时会把分母算小、把集中度算得虚高。
  const circulatingPct = Math.max(0, 100 - excludedPct);

  const overview: HolderOverview = {
    source: enumeration.source,
    truncated: enumeration.truncated,
    accountsTotal: enumeration.accounts.length,
    accountsWithBalance: accountsWithBalance.length,
    ownersTotal: owners.length,
    ownersWithBalance: ownersWithBalance.length,
    coveredPct,
    excludedPct,
    circulatingPct,
    circulatingOwners: counted.length,
    buckets: buildBuckets(ownersWithBalance),
    curve: buildCurve(ownersWithBalance, circulatingPct),
    ownersFor50: ownersFor(ownersWithBalance, 50),
    ownersFor80: ownersFor(ownersWithBalance, 80),
    dustOwners: dust.length,
    dustPct: dust.reduce((s, o) => s + o.pct, 0),
    ...(opts.reportedHolders !== undefined ? { reportedHolders: opts.reportedHolders } : {}),
  };
  return { overview, owners };
}

/**
 * 明细缓存：扫描时把合并分类后的持有人列表存下来，`/api/holders` 翻页时直接读。
 *
 * ⚠️ TTL 比枚举缓存长（用户点开明细、慢慢翻页可能超过 1 分钟），
 * 但仍会过期 —— 过期后接口会明确要求重新扫描，而不是拿旧数据假装是新的。
 */
const ownerCache = new Map<
  string,
  {
    at: number;
    owners: OwnerAggregate[];
    meta: Pick<HolderOverview, 'source' | 'truncated' | 'accountsTotal' | 'accountsWithBalance' | 'reportedHolders'>;
  }
>();

export function cacheOwnerList(
  mint: string,
  owners: OwnerAggregate[],
  meta: Pick<HolderOverview, 'source' | 'truncated' | 'accountsTotal' | 'accountsWithBalance' | 'reportedHolders'>,
): void {
  ownerCache.set(mint, { at: Date.now(), owners, meta });
  if (ownerCache.size > 8) {
    const oldest = [...ownerCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) ownerCache.delete(oldest[0]);
  }
}

export function getCachedOwnerList(
  mint: string,
):
  | {
      owners: OwnerAggregate[];
      meta: Pick<HolderOverview, 'source' | 'truncated' | 'accountsTotal' | 'accountsWithBalance' | 'reportedHolders'>;
      ageMs: number;
    }
  | undefined {
  const hit = ownerCache.get(mint);
  if (!hit) return undefined;
  const ageMs = Date.now() - hit.at;
  if (ageMs > THRESHOLDS.holders.overviewDetailTtlMs) return undefined;
  return { owners: hit.owners, meta: hit.meta, ageMs };
}

/** 明细行（供分页接口返回） */
export function toHolderRows(owners: OwnerAggregate[]): HolderRow[] {
  return owners.map((o) => ({
    address: o.owner,
    amount: o.amount,
    pct: o.pct,
    kind: o.kind,
    counted: o.counted,
    accounts: o.accounts,
  }));
}
