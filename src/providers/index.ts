/**
 * 采集编排 —— 把「真实链上」与「优雅降级」缝合在一起。
 *
 * 数据源优先级：
 *   1. Solana RPC  → 合约安全、权限、持仓（可信度最高）
 *   2. DexScreener → 价格、成交量、买卖笔数、池地址
 *   3. 本地样本     → 网络不可用时的演示兜底
 *
 * 两条铁律：
 * - **采集失败绝不能变成「看起来安全」**。缺失字段一律在 meta 里标 unavailable，
 *   并进入 warnings；UI 必须把「未知」和「安全」区分开。
 * - 真实数据与样本数据必须能被一眼区分（meta.live），绝不能混淆。
 */
import { scan } from '@/core/engine';
import type { FieldOrigin, ScanInput, ScanMeta, ScanReport } from '@/core/types';
import { fetchDexScreener } from './dexscreener';
import { fetchOnChain, isLikelyMint, rpcUrl } from './solana';
import { sampleScanInput } from './sample';

export interface CollectOptions {
  /** 强制使用样本数据（离线演示） */
  sample?: string;
  /** 跳过链上采集，仅用 DexScreener */
  skipOnChain?: boolean;
}

/** 把两组 provider 的产出合并成分析器需要的归一化结构 */
export function mergeInputs(
  mint: string,
  parts: {
    onchain: Awaited<ReturnType<typeof fetchOnChain>>;
    dex: Awaited<ReturnType<typeof fetchDexScreener>>;
    warnings: string[];
    origins: Record<string, FieldOrigin>;
  },
): ScanInput {
  const { onchain, dex, warnings, origins } = parts;

  const token = { ...onchain.token, ...pruneUndefined(dex.token), mint };
  const contract = onchain.contract;
  if (contract && dex.liquidity?.graduated) {
    // 有 AMM 池即说明已毕业；LP 锁定状态链上无法直接判定
    contract.lp = {
      exists: true,
      ...contract.lp,
    };
    if (contract.lp.locked === undefined && contract.lp.burned === undefined) {
      warnings.push(
        'LP 是否锁定/销毁无法从 RPC 直接判定，当前状态为「未知」—— 请在 RugCheck 等平台二次确认。',
      );
    }
  }

  const liquidity: ScanInput['liquidity'] = dex.liquidity;

  // 社交数据链上拿不到、也没有免费可靠来源 → 明确标记 unavailable，而不是填 0
  origins.social = 'unavailable';
  warnings.push('社交热度数据源未接入（需 X/TG 数据服务），该维度不计入本次评分。');

  origins.developer = 'unavailable';
  warnings.push('开发者历史（历史 rug 数、dev 卖出比例）需索引器支持，本次未采集，该维度仅能给出基础判断。');

  return {
    token,
    contract,
    liquidity,
    holders: onchain.holders,
    // developer / social 都依赖索引器与社交数据源，本次未接入。
    // 传 null（而不是 {}）才能让分析器正确判定为「数据缺失」并调低覆盖率 ——
    // 传 {} 会被当成「查过了，没有前科」，反而制造假安全。
    developer: null,
    social: null,
    meta: {
      source: `Solana RPC (${shortRpc(rpcUrl())}) + DexScreener`,
      live: true,
      fetchedAt: new Date().toISOString(),
      origins,
      warnings,
    },
  };
}

function shortRpc(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'custom';
  }
}

function pruneUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** 采集 + 分析；任何环节失败都降级为「部分数据」而非崩溃 */
export async function collectAndScan(
  mint: string,
  opts: CollectOptions = {},
): Promise<ScanReport> {
  const started = Date.now();
  const warnings: string[] = [];
  const origins: Record<string, FieldOrigin> = {};

  // ── 样本模式 ────────────────────────────────────────────────────
  if (opts.sample) {
    const input = sampleScanInput(opts.sample);
    if (!input) {
      throw new Error(`未知样本：${opts.sample}`);
    }
    const report = scan(input);
    report.meta.elapsedMs = Date.now() - started;
    return report;
  }

  if (!isLikelyMint(mint)) {
    throw new Error('这不是一个合法的 Solana 地址（base58，32–44 位）。请检查是否复制完整。');
  }

  // ── 并行采集两个数据源 ──────────────────────────────────────────
  const [onchain, dex] = await Promise.all([
    opts.skipOnChain
      ? Promise.resolve({ token: { mint }, contract: null, holders: [], origins } as Awaited<
          ReturnType<typeof fetchOnChain>
        >)
      : fetchOnChain(mint, warnings),
    fetchDexScreener(mint),
  ]);

  Object.assign(origins, onchain.origins);
  if (dex.origin !== 'unavailable') origins.liquidity = dex.origin;
  else origins.liquidity = 'unavailable';
  if (dex.warning) warnings.push(dex.warning);

  const input = mergeInputs(mint, { onchain, dex, warnings, origins });
  const report = scan(input);
  report.meta.elapsedMs = Date.now() - started;
  return report;
}

/** 供 UI 展示的元信息摘要 */
export function describeMeta(meta: ScanMeta): string {
  if (!meta.live) return `样本数据 · ${meta.source}`;
  return meta.source;
}
