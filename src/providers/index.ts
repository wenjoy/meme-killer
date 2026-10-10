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
import type { FieldOrigin, ScanInput, ScanMeta, ScanReport } from '@/core/types';
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
  warnings: string[];
  origins: Record<string, FieldOrigin>;
}): ScanInput {
  const { mint, onchain, activity, developer, dex, warnings, origins } = parts;

  const token = {
    ...onchain.token,
    ...pruneUndefined(dex.token),
    mint,
    createdAt: onchain.token.createdAt ?? activity.createdSec,
  };

  // ── 池地址：两路确定性来源 ──────────────────────────────────────
  // 1. 确定性 PDA 推导（bonding curve / PumpSwap / 池 ATA）
  // 2. DexScreener 的 pair 地址
  //
  // ⚠️ 刻意不采纳「从成交里观察到的对手方」：那个信号无法区分
  // 「AMM 池提供流动性」与「dev/巨鲸砸盘」，实测曾把 dev 持有的 46%
  // 供应量误当成池而剔除，导致高度集中的币被判成「持仓分布健康」。
  // 宁可漏掉池（会在 warnings 里如实说明），也不能抹掉真实筹码。
  const pools = resolvePoolAddresses(mint, activity.creator, dex.liquidity?.poolAddresses ?? []);
  for (const w of pools.warnings) warnings.push(w);

  const poolAddresses = [...pools.addresses];

  // 把池地址回填到持仓分类：owner 或 token account 命中即视为池
  const holders = onchain.holders.map((h) =>
    pools.addresses.has(h.address)
      ? { ...h, isPool: true, label: pools.labels[h.address] ?? 'observed pool' }
      : h,
  );

  // ── 流动性：真实成交优先，DexScreener 补 USD 口径 ───────────────
  // 买卖笔数/金额来自逐笔成交（更原始、更可信）；
  // 价格、市值、流动性 USD 只有 DexScreener 有。
  const liquidity = {
    ...pruneUndefined(dex.liquidity ?? {}),
    ...pruneUndefined(activity.liquidity),
    poolAddresses,
  };

  const contract = onchain.contract;
  if (contract && (dex.liquidity?.graduated || poolAddresses.length > 0)) {
    contract.lp = { exists: true, ...contract.lp };
    if (contract.lp.locked === undefined && contract.lp.burned === undefined) {
      warnings.push(
        'LP 是否锁定/销毁无法从 RPC 直接判定。当前显示为「未知」—— ' +
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

  // 链上基础事实、市场数据、成交结构三者互不依赖，并行采集。
  // 串行会让任一慢数据源把总耗时叠加起来（实测 3 个全挂 = 65 秒）。
  const [onchain, dex, activity] = await Promise.all([
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
  ]);

  Object.assign(origins, onchain.origins);
  origins.liquidity = dex.origin !== 'unavailable' ? dex.origin : activity.origin;
  if (dex.warning) warnings.push(dex.warning);

  // 开发者履历依赖 activity 解析出的 creator，必须串行
  const developer = await fetchDeveloper(mint, activity.creator, warnings);
  warnings.push(...developer.warnings);
  origins.developer = developer.origin;

  origins.social = 'unavailable';
  warnings.push(
    '社交热度数据源未接入（Helius 不提供社交数据，需 X/TG 第三方服务）。该维度标记为未采集，不计入评分。',
  );

  const input = mergeInputs({ mint, onchain, activity, developer, dex, warnings, origins });
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
      ? '已检测到 Helius API key：合约安全、流动性、持币集中度、开发者历史四个维度可计算。'
      : '未检测到 Helius API key：仅标准 RPC 可用，部署者身份与成交明细将缺失，覆盖率会因此下降。',
  };
}
