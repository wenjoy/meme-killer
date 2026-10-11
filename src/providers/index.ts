/**
 * 采集编排 —— 只使用真实数据源，没有 mock、没有回退样本。
 *
 * 数据源分工：
 *   Solana RPC + DAS        → mint 账户权限、Token-2022 扩展、元数据、最大持仓
 *   Helius Enhanced API     → 部署者身份、买卖结构、dev 行为、历史发币
 *   DexScreener             → 价格/市值/流动性 USD、pair 地址（可用时）
 *
 * 三条铁律：
 * 1. **采集失败绝不能变成「看起来安全」**。缺失字段一律标 `unavailable`
 *    并写进 warnings，UI 必须把「未知」和「安全」区分开。
 * 2. **覆盖率不足时拒绝给结论**。没数据就不给分数、不给仓位建议。
 * 3. 不猜。拿不到的字段留空，不用启发式编一个看起来确定的数字。
 */
import { THRESHOLDS } from '@/core/constants';
import { scan } from '@/core/engine';
import type {
  DeveloperInfo,
  FieldOrigin,
  HolderOverviewLazy,
  HolderRow,
  LiquidityInfo,
  RawHolder,
  ScanInput,
  ScanMeta,
  ScanReport,
} from '@/core/types';
import { fetchDexScreener } from './dexscreener';
import {
  fetchDeveloper,
  fetchLpMintSupply,
  fetchMetadataCreators,
  fetchMintActivity,
  fetchOnChain,
  hasEnhancedApi,
  isLikelyMint,
  rpcUrl,
} from './helius';
import { resolveCreator } from './creator';
import { getDeepResultCached } from './deepJobs';
import {
  buildHolderOverview,
  cacheOwnerList,
  getHolderAccountsCached,
  type HolderEnumeration,
} from './holderList';
import { resolvePoolAddresses } from './pools';
import { fetchRugCheck, type RugCheckResult } from './rugcheck';

export interface CollectOptions {
  /** 只做链上采集，跳过 DexScreener（调试用） */
  skipMarket?: boolean;
  /**
   * 即使账户数超过自动加载上限也强制拉全量持有人分布。
   * 用于报告里那个「按需加载」按钮 —— 用户明确要求了，慢也要拉。
   */
  forceOverview?: boolean;
}

/** 合并各 provider 的产出为分析器需要的归一化结构 */
export function mergeInputs(parts: {
  mint: string;
  onchain: Awaited<ReturnType<typeof fetchOnChain>>;
  activity: Awaited<ReturnType<typeof fetchMintActivity>>;
  developer: Awaited<ReturnType<typeof fetchDeveloper>>;
  dex: Awaited<ReturnType<typeof fetchDexScreener>>;
  rug: RugCheckResult;
  warnings: string[];
  origins: Record<string, FieldOrigin>;
  /** 三级解析后的部署者（providers/creator.ts），用于把 dev 本人剔出狙击仓位 */
  creator?: string;
  /** 创建交易的付款方，与 creator 不同时才有值 */
  launchWallet?: string;
  /** 全量持有人枚举结果（扫描时按阈值自动拉；没拉就没有） */
  holderEnumeration?: HolderEnumeration;
  /** 本次扫描的参考时间（秒）—— 持仓时长等计算统一用它，避免同一份报告里出现两个「现在」 */
  nowSec: number;
  /** 没自动加载全量的原因 */
  holdersOverviewLazy?: HolderOverviewLazy;
  /** RugCheck 口径的持有人总数，用于总览的口径对照 */
  reportedHolders?: number;
}): ScanInput {
  const {
    mint,
    onchain,
    activity,
    developer,
    dex,
    rug,
    warnings,
    origins,
    creator,
    launchWallet,
    holderEnumeration,
    nowSec,
    holdersOverviewLazy,
    reportedHolders,
  } = parts;

  const token = {
    ...onchain.token,
    ...pruneUndefined(dex.token),
    mint,
    createdAt: onchain.token.createdAt ?? activity.createdSec,
  };

  // ── 池地址：三路确定性来源 ──────────────────────────────────────
  // 1. 确定性 PDA 推导（bonding curve 与其 ATA）
  // 2. DexScreener 的 pair 地址
  // 3. RugCheck 的 AMM 池与其两个金库账户
  //
  // ⚠️ 刻意不采纳「从成交里观察到的对手方」：那个信号无法区分
  // 「AMM 池提供流动性」与「dev/巨鲸砸盘」，实测曾把 dev 持有的 46%
  // 供应量误当成池而剔除，导致高度集中的币被判成「持仓分布健康」。
  // 宁可漏掉池（会在 warnings 里如实说明），也不能抹掉真实筹码。
  const pools = resolvePoolAddresses(mint, dex.liquidity?.poolAddresses ?? []);
  for (const w of pools.warnings) warnings.push(w);
  for (const addr of rug.poolAddresses) {
    if (pools.addresses.has(addr)) continue;
    pools.addresses.add(addr);
    pools.labels[addr] = 'RugCheck 池/金库账户';
  }

  const poolAddresses = [...pools.addresses];

  // ── 全量持有人总览：在拿到池地址与分类结果之后聚合 ──────────────
  // 注意顺序：池地址要先由 resolvePoolAddresses 定下来，否则池持仓会被
  // 当成普通大户算进分布里（那正是集中度最大的误报源）。
  let holdersOverview: ScanInput['holdersOverview'];
  if (holderEnumeration && holderEnumeration.accounts.length > 0) {
    const res = buildHolderOverview(
      holderEnumeration,
      {
        decimals: token.decimals ?? 0,
        supplyUi: onchain.contract?.supply ?? token.supply ?? 0,
        knownHolders: onchain.holders ?? [],
        poolAddresses: [...pools.addresses],
        creator,
        ...(launchWallet ? { launchWallet } : {}),
        linkedWallets: developer?.developer?.linkedWallets ?? [],
      },
      {
        ...(reportedHolders !== undefined ? { reportedHolders } : {}),
      },
    );
    holdersOverview = res.overview;
    // 明细接口翻的是这一份（合并 + 分类后），不重算
    cacheOwnerList(mint, res.owners, {
      source: res.overview.source,
      truncated: res.overview.truncated,
      accountsTotal: res.overview.accountsTotal,
      accountsWithBalance: res.overview.accountsWithBalance,
      ...(res.overview.reportedHolders !== undefined
        ? { reportedHolders: res.overview.reportedHolders }
        : {}),
    });
  }


  // 把池地址回填到持仓分类：**owner 或 token account 任一命中即视为池**。
  // ⚠️ token account 这一路是必须的：Raydium v4 这类池把代币放在独立 vault 里，
  // vault 的 owner 是一个与池地址不同的 authority PDA，
  // 只认 owner 会让金库持仓被算进集中度（实测某池金库占比 5%+ 被当成大户）。
  const isPoolHolder = (h: RawHolder) =>
    pools.addresses.has(h.address) || (h.tokenAccount ? pools.addresses.has(h.tokenAccount) : false);

  // 狙击仓位：最早若干笔成交的买家 ∩ 当前前 20 大持仓（推算，非链上事实）
  //
  // ⚠️ 要把**部署者本人**从「狙击手」里剔除：dev 的开盘自买不是狙击仓位。
  // 这里剔除两个地址：解析出的 creator（curve 状态）与创建交易付款方 ——
  // 后者在 provider 那层已按「最早一笔的付款方」剔过一次，但最早一笔未必是创建交易。
  const earlyBuyers = new Set(
    activity.earlyBuyers.filter((a) => a !== creator && a !== launchWallet),
  );
  const holders = onchain.holders.map((h) => {
    let out = h;
    if (isPoolHolder(h)) {
      out = {
        ...out,
        isPool: true,
        label: pools.labels[h.address] ?? pools.labels[h.tokenAccount ?? ''] ?? 'observed pool',
      };
    }
    if (!out.isPool && !out.isBurn && earlyBuyers.has(h.address)) out = { ...out, isSniper: true };
    return out;
  });

  const sniperPct = holders.filter((h) => h.isSniper).reduce((s, h) => s + (h.pct ?? 0), 0);
  if (earlyBuyers.size > 0) {
    warnings.push(
      `狙击仓位为推算值：取代币最早 ${THRESHOLDS.liquidity.sniperWindowTrades} 笔成交，` +
        `排除部署者相关地址后剩 ${earlyBuyers.size} 个付款方，与当前前 20 大持仓求交集` +
        '（链上只返回前 20），因此只是下限，不是全量。',
    );
  }

  // ── 钻石手：逐地址成交 + 全量持仓 ────────────────────────────────
  // 必须放在池地址推导之后：池/金库的成交不是「人的行为」，混进去会污染比例。
  // 地址 → 当前余额（UI 单位）。用**全量枚举**（含零余额账户）：
  // 「买了但已经卖光」的钱包余额是 0，只有全量枚举才看得到它们。
  // 钻石手与抛压分布共用同一份，避免重复构建。
  let holderBalances: Map<string, number> | undefined;
  if (holderEnumeration && holderEnumeration.accounts.length > 0) {
    const dec = token.decimals ?? 0;
    holderBalances = new Map<string, number>();
    for (const a of holderEnumeration.accounts) {
      holderBalances.set(a.owner, (holderBalances.get(a.owner) ?? 0) + Number(a.amount) / 10 ** dec);
    }
  }

  let diamond: ScanInput['diamond'];
  if (activity.trades && activity.trades.length > 0) {
    const createdSec = activity.createdSec ?? onchain.token.createdAt;
    const ageSec =
      typeof createdSec === 'number' ? Math.max(0, nowSec - createdSec) : undefined;
    // 窗口覆盖：最早窗口结束 → 最近窗口开始 之间的缺口有多大
    const ascEnd = activity.earlyWindowEndSec;
    const descStart = activity.recentWindowStartSec;
    const gapSec =
      ascEnd !== undefined && descStart !== undefined && descStart > ascEnd
        ? descStart - ascEnd
        : 0;
    const coveredSec =
      ageSec !== undefined && ageSec > 0 ? Math.max(0, ageSec - gapSec) / ageSec : 1;
    diamond = {
      trades: activity.trades,
      nowSec,
      ...(creator ? { creator } : {}),
      ...(launchWallet ? { launchWallet } : {}),
      relatedWallets: developer?.developer?.linkedWallets ?? [],
      // 前 20 名（已带 isPool/isSniper 标记）用来标注证据行的分类与持仓占比
      ...(holders.length > 0
        ? {
            topHolders: holders.map((h) => ({
              address: h.address,
              amount: h.amount,
              pct: h.pct ?? 0,
              kind: (h.isPool
                ? 'pool'
                : h.isBurn
                  ? 'burn'
                  : h.isSniper
                    ? 'sniper'
                    : 'retail') as HolderRow['kind'],
              counted: !h.isPool && !h.isBurn,
            })),
          }
        : {}),
      ...(holderBalances ? { holderBalances } : {}),
      ...(ascEnd !== undefined ? { earlyWindowEndSec: ascEnd } : {}),
      ...(descStart !== undefined ? { recentWindowStartSec: descStart } : {}),
      windowCoveragePct: Math.round(coveredSec * 1000) / 10,
      gapDays: gapSec / 86_400,
    };
  }


  // ── 抛压分布：需要每笔成交的代币数量才能反推成本价 ────────────────
  // 深度模式的结果（如果这个代币做过）：优先于窗口估算
  const deep = getDeepResultCached(mint);
  let sellPressure: ScanInput['sellPressure'];
  if (activity.trades && activity.trades.length > 0) {
    const pairable = activity.trades.filter((t) => t.tokenAmount > 0);
    // 流通盘的代币数量：总量 × 流通盘比例（来自全量枚举，没有就用 100%）
    const supply = onchain.contract?.supply ?? token.supply ?? 0;
    const circPct = holdersOverview?.circulatingPct ?? 100;
    const kindMap = new Map<string, string>();
    for (const h of holders) {
      kindMap.set(
        h.address,
        h.isPool ? 'pool' : h.isBurn ? 'burn' : h.isSniper ? 'sniper' : 'retail',
      );
    }
    sellPressure = {
      trades: pairable.map((t) => ({
        trader: t.trader,
        side: t.side,
        sol: t.sol,
        tokenAmount: t.tokenAmount,
        ...(t.ts !== undefined ? { ts: t.ts } : {}),
        ...(t.mintLike ? { mintLike: true as const } : {}),
      })),
      // 窗口内全部成交 = 配对成功的 + 配对失败的（后者在 provider 层已被丢弃）
      windowTrades: activity.trades.length + (activity.unattributedTrades ?? 0),
      nowSec,
      circulatingTokens: (supply * circPct) / 100,
      ...(holderBalances ? { holderBalances } : {}),
      ...(kindMap.size > 0 ? { kinds: kindMap } : {}),
      // 做过深度分析的话，把完整历史并进来（那些地址的成本就是真实值了）
      ...(deep ? { deepTrades: deep.trades, deepAddresses: deep.addresses.length } : {}),
    };
  }


  // ── 流动性：按可信度从低到高覆盖 ────────────────────────────────
  // RugCheck（LP/持有人/池深度）→ DexScreener（USD 行情）→
  // Helius 逐笔成交（SOL 口径，覆盖推算值）→ bonding curve 账户（阶段与真实 SOL）
  //
  // ⚠️ 阶段判定只认「明确的信号」：curve 账户的 complete 标志、DexScreener 有池、
  // RugCheck 的 AMM 市场。曾经用「curve 账户存在」当未毕业的证据，
  // 结果给已毕业、池里有 2.2 万美元流动性的代币报出
  // 「尚未毕业」+「curve 内真实 SOL 极低（0）」两条完全错误的结论。
  const curve = onchain.curve;
  const curveLiquidity: Partial<LiquidityInfo> =
    curve && curve.exists
      ? {
          graduated: curve.complete,
          complete: curve.complete,
          // 已毕业时 curve 余额恒为 0，写进去只会变成一条假的「深度 0」
          ...(curve.complete ? {} : { realSolReserves: curve.realSolReserves }),
        }
      : {};
  const liquidity = {
    ...pruneUndefined(rug.liquidity ?? {}),
    ...pruneUndefined(dex.liquidity ?? {}),
    ...pruneUndefined(activity.liquidity),
    // RugCheck 看到 AMM 市场 = 已经不在曲线上（真实信号，不是推断）
    ...(rug.hasAmmMarket ? { graduated: true, complete: true } : {}),
    ...curveLiquidity,
    // ⚠️ 用**过滤后**的名单判断「有没有样本」：如果最早那批人全是部署者自己，
    // 那就没有狙击样本可用，此时必须留空（未知），不能写 0 假装「没有狙击仓位」。
    ...(earlyBuyers.size > 0 ? { sniperHoldPct: Math.round(sniperPct * 100) / 100 } : {}),
    poolAddresses,
  };

  // ── LP 锁定/销毁：只有拿到明确判定才写，未知一律留空 ────────────
  //
  // LP 是否存在，同样要靠「真实池信号」判断，不能看池地址集合是否非空：
  // bonding curve 自己的地址与金库也在那个集合里（它们是用来剔除持仓的），
  // 把集合非空当成「有 AMM 池」，会给未毕业的代币报一条假的「LP 状态未知」。
  const contract = onchain.contract;
  if (contract) {
    const hasAmmPool =
      rug.hasAmmMarket || dex.liquidity?.graduated === true || (curve?.exists === true && curve.complete);
    if (hasAmmPool) {
      contract.lp = { exists: true, ...(rug.lp ?? {}) };
    } else if ((curve?.exists === true && !curve.complete) || rug.stillOnCurve) {
      // 明确未毕业（curve 的 complete=false，或 RugCheck 只看到曲线市场）
      // = 确实还没建立 LP。这是事实，不是「没查到」。
      contract.lp = { exists: false };
    }
    if (contract.lp?.exists === true && contract.lp.locked === undefined && contract.lp.burned === undefined) {
      warnings.push(
        'LP 是否锁定/销毁未能确认（RugCheck 未覆盖该池或本次不可达）。当前显示为「未知」—— ' +
          '请在 RugCheck 上二次确认（这关系到能否被撤池）。',
      );
    }
  }

  // 只有 poolAddresses 时不算「有流动性数据」—— 分析器需要真实指标
  const hasLiquidityMetrics = Object.keys(liquidity).some((k) => k !== 'poolAddresses');

  return {
    token,
    contract,
    liquidity: hasLiquidityMetrics ? liquidity : null,
    holders,
    developer: developer.developer,
    // 全量持有人总览（没加载时字段不存在 —— 未知不能写成 0）
    ...(holdersOverview ? { holdersOverview } : {}),
    ...(holdersOverviewLazy ? { holdersOverviewLazy } : {}),
    // 钻石手：逐地址成交（没取到时字段不存在，同样是「未知」而不是「0 个」）
    ...(diamond ? { diamond } : {}),
    ...(sellPressure ? { sellPressure } : {}),
    // Helius 不提供社交数据，需要第三方服务；留空让维度标记为未采集
    social: null,
    meta: {
      source: describeSources(),
      live: true,
      fetchedAt: new Date().toISOString(),
      origins,
      warnings,
    },
  };
}

function describeSources(): string {
  const host = (() => {
    try {
      return new URL(rpcUrl()).host;
    } catch {
      return 'custom-rpc';
    }
  })();
  const parts = [host];
  if (hasEnhancedApi()) parts.push('Helius Enhanced API');
  parts.push('DexScreener');
  parts.push('RugCheck');
  return parts.join(' + ');
}

function pruneUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** 采集 + 分析。任何环节失败都降级为「部分数据」，而不是崩溃或编造 */
export async function collectAndScan(
  mint: string,
  opts: CollectOptions = {},
): Promise<ScanReport> {
  const started = Date.now();
  const warnings: string[] = [];
  const origins: Record<string, FieldOrigin> = {};

  if (!isLikelyMint(mint)) {
    throw new Error('这不是一个合法的 Solana 地址（base58，32–44 位）。请检查是否复制完整。');
  }

  // 链上基础事实、市场数据、成交结构与 RugCheck 互不依赖，并行采集。
  // 串行会让任一慢数据源把总耗时叠加起来（实测 3 个全挂 = 65 秒）。
  const [onchain, dex, activity, rug] = await Promise.all([
    fetchOnChain(mint, warnings),
    opts.skipMarket
      ? Promise.resolve({
          token: {},
          liquidity: null,
          origin: 'unavailable' as FieldOrigin,
          warning: '已跳过 DexScreener（调试模式）',
        })
      : fetchDexScreener(mint),
    fetchMintActivity(mint, 0, warnings),
    // 传入链上 LP 供应量的读法：把「RugCheck 说锁定 x%」核成「已销毁 y%」
    fetchRugCheck(mint, fetchLpMintSupply),
  ]);

  Object.assign(origins, onchain.origins);
  // 流动性字段来自三个源，按「谁真的给了值」标注，避免把推算值说成链上事实
  origins.liquidity =
    activity.origin !== 'unavailable'
      ? activity.origin
      : dex.origin !== 'unavailable'
        ? dex.origin
        : onchain.curve?.exists
          ? 'onchain'
          : rug.origin !== 'unavailable'
            ? rug.origin
            : 'unavailable';
  // LP 锁定/销毁与持有人数只有 RugCheck 能给
  origins.lp = rug.origin;
  for (const w of rug.warnings) warnings.push(w);
  if (dex.warning) warnings.push(dex.warning);

  // ── 部署者：三级来源，从最权威往下回退（顺序见 providers/creator.ts）──
  const curveCreator = onchain.curve?.exists === true ? onchain.curve.creator : undefined;
  const metadataCreators = await fetchMetadataCreators(mint);
  const launchWallet = activity.creator;
  const resolved = resolveCreator({
    curveCreator,
    metadataCreator: metadataCreators?.[0]?.address,
    launchWallet,
  });
  const creator = resolved.creator;
  for (const w of resolved.warnings) warnings.push(w);

  // 开发者履历依赖解析后的 creator，必须串行
  const developer = await fetchDeveloper(mint, creator, warnings);
  if (developer.developer || creator) {
    developer.developer = {
      ...(developer.developer ?? {}),
      ...(creator ? { creator } : {}),
      ...(resolved.source ? { creatorSource: resolved.source } : {}),
      ...(resolved.launchWallet ? { launchWallet: resolved.launchWallet } : {}),
    };
  }
  warnings.push(...developer.warnings);
  origins.developer = developer.origin;

  origins.social = 'unavailable';
  warnings.push(
    '社交热度数据源未接入（Helius 不提供社交数据，需 X/TG 第三方服务）。该维度标记为未采集，不计入评分。',
  );

  // ── 全量持有人总览：账户数在阈值内就自动拉 ──────────────────────
  // 实测 9.4k 账户 642ms / 2.2MB；再大就会明显拖慢扫描并放大失败面，
  // 所以超过阈值只给一个按钮（并在报告里说明「未自动加载」，不是「没有持有人」）。
  const reportedHolders = rug.liquidity?.holderCount;
  let holderEnumeration: HolderEnumeration | undefined;
  let holdersOverviewLazy: ScanInput['holdersOverviewLazy'];
  const decimals = onchain.token.decimals ?? 0;
  if (
    !opts.forceOverview &&
    reportedHolders !== undefined &&
    reportedHolders > THRESHOLDS.holders.overviewMaxAccounts
  ) {
    holdersOverviewLazy = {
      reason:
        `该代币有约 ${reportedHolders.toLocaleString()} 个持仓账户，超过自动加载上限 ` +
        `${THRESHOLDS.holders.overviewMaxAccounts.toLocaleString()}，本次扫描没有拉全量分布。` +
        '可以点下方按钮按需加载（会更慢，且可能因 RPC 限制不完整）。',
      estimatedAccounts: reportedHolders,
    };
    warnings.push(
      `持有人总览未自动加载：约 ${reportedHolders.toLocaleString()} 个账户超过上限 ` +
        `${THRESHOLDS.holders.overviewMaxAccounts.toLocaleString()}。这不是「没有持有人」，是按需加载。`,
    );
  } else {
    const enumerated = await getHolderAccountsCached(
      mint,
      onchain.contract?.tokenProgram,
      decimals,
    );
    for (const w of enumerated.warnings) warnings.push(w);
    if (enumerated.accounts.length > 0) {
      holderEnumeration = enumerated;
      // 口径对照：链上账户 / 有余额账户 / RugCheck 报的持有人数
      const withBal = enumerated.accounts.filter((a) => a.amount > 0n).length;
      if (reportedHolders !== undefined) {
        warnings.push(
          `「持有人数」有三个口径，差额不做推断：链上 token account ${enumerated.accounts.length} 个` +
            `（其中有余额 ${withBal} 个、已清空 ${enumerated.accounts.length - withBal} 个）、` +
            `RugCheck 报 ${reportedHolders.toLocaleString()} 个。`,
        );
      }
    } else {
      holdersOverviewLazy = { reason: '本次未能枚举全量持仓账户（RPC 与分页兜底都没成功），可手动重试。' };
    }
  }

  const scanStartedSec = Math.floor(started / 1000);
  const input = mergeInputs({
    mint,
    onchain,
    activity,
    developer,
    dex,
    rug,
    warnings,
    origins,
    ...(creator ? { creator } : {}),
    ...(resolved.launchWallet ? { launchWallet: resolved.launchWallet } : {}),
    ...(holderEnumeration ? { holderEnumeration } : {}),
    nowSec: scanStartedSec,
    ...(holdersOverviewLazy ? { holdersOverviewLazy } : {}),
    ...(reportedHolders !== undefined ? { reportedHolders } : {}),
  });
  const report = scan(input);
  report.meta.elapsedMs = Date.now() - started;
  return report;
}

/** 供 UI 展示的数据来源摘要 */
export function describeMeta(meta: ScanMeta): string {
  return meta.source;
}

/** 启动自检：告诉用户当前配置下哪些维度能真正生效 */
export function capabilityReport(): {
  rpcHost: string;
  enhancedApi: boolean;
  note: string;
} {
  const enhanced = hasEnhancedApi();
  return {
    rpcHost: describeSources().split(' + ')[0],
    enhancedApi: enhanced,
    note: enhanced
      ? '已检测到 Helius API key：合约安全、流动性、持币集中度、开发者历史四个维度可计算。' +
        'LP 锁定/销毁与持有人总数由 RugCheck 提供（无需 key，每次扫描实时获取；不可达时标为「未知」并告警）。'
      : '未检测到 Helius API key：仅标准 RPC 可用，部署者身份与成交明细将缺失，覆盖率会因此下降。' +
        'LP 锁定/销毁与持有人总数由 RugCheck 提供（无需 key）。',
  };
}
