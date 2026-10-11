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
import { scan } from '@/core/engine';
import type { FieldOrigin, LiquidityInfo, RawHolder, ScanInput, ScanMeta, ScanReport } from '@/core/types';
import { fetchDexScreener } from './dexscreener';
import {
  fetchDeveloper,
  fetchMintActivity,
  fetchOnChain,
  hasEnhancedApi,
  isLikelyMint,
  rpcUrl,
} from './helius';
import { resolvePoolAddresses } from './pools';
import { fetchRugCheck, type RugCheckResult } from './rugcheck';

export interface CollectOptions {
  /** 只做链上采集，跳过 DexScreener（调试用） */
  skipMarket?: boolean;
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
}): ScanInput {
  const { mint, onchain, activity, developer, dex, rug, warnings, origins } = parts;

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

  // 把池地址回填到持仓分类：**owner 或 token account 任一命中即视为池**。
  // ⚠️ token account 这一路是必须的：Raydium v4 这类池把代币放在独立 vault 里，
  // vault 的 owner 是一个与池地址不同的 authority PDA，
  // 只认 owner 会让金库持仓被算进集中度（实测某池金库占比 5%+ 被当成大户）。
  const isPoolHolder = (h: RawHolder) =>
    pools.addresses.has(h.address) || (h.tokenAccount ? pools.addresses.has(h.tokenAccount) : false);

  // 狙击仓位：最早若干笔成交的买家 ∩ 当前前 20 大持仓（推算，非链上事实）
  const earlyBuyers = new Set(activity.earlyBuyers);
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
  if (activity.earlyBuyers.length > 0) {
    warnings.push(
      `狙击仓位为推算值：取最早 ${activity.earlyBuyers.length} 笔成交的付款方，` +
        '与当前前 20 大持仓求交集（链上只返回前 20），因此只是下限，不是全量。',
    );
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
    ...(activity.earlyBuyers.length > 0
      ? { sniperHoldPct: Math.round(sniperPct * 100) / 100 }
      : {}),
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
    fetchRugCheck(mint),
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

  // 开发者履历依赖 activity 解析出的 creator，必须串行
  const developer = await fetchDeveloper(mint, activity.creator, warnings);
  warnings.push(...developer.warnings);
  origins.developer = developer.origin;

  origins.social = 'unavailable';
  warnings.push(
    '社交热度数据源未接入（Helius 不提供社交数据，需 X/TG 第三方服务）。该维度标记为未采集，不计入评分。',
  );

  const input = mergeInputs({ mint, onchain, activity, developer, dex, rug, warnings, origins });
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
