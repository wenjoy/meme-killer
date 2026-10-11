/**
 * 风控阈值与协议固定标识。
 *
 * 重要原则：Pump.fun 的内部常量（虚拟储备、毕业阈值、program id）随版本调整过，
 * 凡是"协议内部"的数值都必须运行时从链上读。本文件只放：
 *   1. 风控判定阈值（经验值，标 ⚠️ 的需要按实际数据分布回调）
 *   2. 协议公开的固定标识（可硬编码）
 */
import type { RiskBand } from './types';

// ── 协议公开固定标识 ────────────────────────────────────────────────
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** Pump.fun 相关 program（用于识别 bonding curve / 迁移交易） */
export const PUMP_PROGRAM_IDS = new Set([
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // pump.fun bonding curve
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // PumpSwap AMM
]);

/** 已知 burn 地址：计算持币集中度时必须剔除，否则误判为庄家控盘 */
export const BURN_ADDRESSES = new Set([
  '1nc1nerator11111111111111111111111111111111',
  '11111111111111111111111111111111',
]);

/**
 * 池 / 金库地址匹配模式 —— **最大的误报来源**。
 * bonding curve 与 AMM pool 天然持有大部分供应量，不剔除的话
 * 任何正常项目都会被算成「Top10 控盘 80%」。
 */
export const POOL_LABEL_PATTERN = /(bondingcurve|bonding curve|pool|vault|amm|raydium|pumpswap|liquidity|meteora)/i;

// ── 评分权重（维度风险分 0–100 加权求和）────────────────────────────
export const WEIGHTS: Record<string, number> = {
  contract: 0.3,
  liquidity: 0.25,
  holders: 0.2,
  developer: 0.15,
  social: 0.1,
};

// 维度中文名（UI / 报告共用，避免多处硬编码导致不一致）
export const DIMENSION_LABELS: Record<string, string> = {
  contract: '合约安全',
  liquidity: '流动性 & 资金流',
  holders: '持币集中度',
  developer: '开发者历史',
  social: '社交热度',
};

export const DIMENSION_ORDER = ['contract', 'liquidity', 'holders', 'developer', 'social'] as const;

// ── 风险等级映射 ────────────────────────────────────────────────────
export const RISK_BANDS: RiskBand[] = [
  { max: 25, level: 'LOW', label: '低风险', verdict: '可考虑小仓买入', tone: 'success' },
  { max: 45, level: 'MEDIUM', label: '中等风险', verdict: '仅小仓位试探', tone: 'warning' },
  { max: 65, level: 'HIGH', label: '高风险', verdict: '建议观望', tone: 'warning' },
  { max: Infinity, level: 'CRITICAL', label: '极高风险', verdict: '不要买入', tone: 'error' },
];

// ── 各维度判定阈值 ──────────────────────────────────────────────────
export const THRESHOLDS = {
  holders: {
    top10Warn: 25, // ⚠️ Top10 占流通盘 > 25% 警惕
    top10Danger: 40, // ⚠️ > 40% 高危（硬否决）
    singleWalletWarn: 10, // ⚠️ 单一非 dev 钱包 > 10%
    devClusterDanger: 15, // ⚠️ dev + 关联钱包合计 > 15%
    minHolderCount: 100, // 持有人数 < 100 且集中 → 无出货深度
    sniperWalletDanger: 25, // ⚠️ 狙击钱包持仓占比（只在这一处判定，避免两个维度重复计分）
    custodyWarnPct: 1, // 程序托管（多签等）占比低于此值只是尘埃，不值得单独提示
    /**
     * 全量持有人总览：账户数超过这个量级就不在扫描里自动拉 ——
     * 实测 9.4k 账户 642ms / 2.2MB，50k 以上会明显拖慢扫描并放大失败面，
     * 此时改为按钮手动触发，并如实标注「未自动加载」。
     */
    overviewMaxAccounts: 20_000,
    /** 灰尘账户门槛（占总供应量）：低于此值算长尾噪音 */
    overviewDustPct: 0.001,
    /** 总览/明细的全量数据缓存时长，避免翻页时反复拉 2MB */
    overviewCacheTtlMs: 60_000,
    /** 明细接口的缓存时长（用户主动翻页，给长一点；过期要求重新扫描而不是给旧数据） */
    overviewDetailTtlMs: 10 * 60_000,
    /** 累计集中度曲线取这些名次 */
    overviewCurvePoints: [10, 50, 100, 500, 1000, 5000, 10_000],
  },
  liquidity: {
    /**
     * 「早期买家 / 狙击」取样窗口：代币最早的这么多笔成交。
     *
     * 大额卖单的钱包要用它来定性：开盘就买入的地址在砸盘，与半路进场的
     * 持有人止盈，是两件性质完全不同的事。取 1 笔不够（创建交易占掉第一笔），
     * 取太多又会把正常早期买家全算成狙击 —— 25 笔是实测下来能覆盖首区块买家的窗口。
     */
    sniperWindowTrades: 25,
    sellPressureDanger: 60, // 卖方金额占比超过此值 → 抛压主导
    washTradeNetInflowSol: 0.5, // 笔数高但净流入低于此值 → 刷量
    // 刷量还要求「净流入/总成交额」足够小：只看绝对值时，
    // 成交 40 SOL、净流出 0.3 SOL 的正常币也会被扣上刷量帽子。
    washTradeNetRatio: 0.1,
    minRealSolReserves: 5, // curve 内真实 SOL 过低 → 极易被砸穿
  },
  developer: {
    // 没有「历史 rug 次数」阈值：判定历史代币是否 rug 需要价格/流动性历史，
    // 本工具只用单次查询做不到，因此宁可不判（见 analyzers/developer.ts 的说明）。
    devSoldRatioWarn: 0.3,
    devSoldRatioDanger: 0.8,
    fastDumpWindowSec: 3600, // 毕业后 1 小时内清仓算快速出货
  },
  social: {
    lowMentionWarn: 50,
    botRatioDanger: 0.6, // ⚠️ 疑似 bot 账号占比
  },
  contract: {
    maxTransferFeeBps: 0, // 任何 > 0 的转移税都警惕
    // 未锁部分的 LP 里，能被普通钱包「随时提走」的比例低于此值 → 主要是锁仓托管，
    // 不算撤池风险（但仍会列出来，因为线性解锁到期后就能提）。
    lpWithdrawableDangerPct: 5,
  },
} as const;

/** 发现项严重度 → 风险分权重（各分析器共用，避免重复定义漂移） */
export const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 100,
  high: 55,
  medium: 28,
  low: 10,
  good: 0,
};

export const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  good: 4,
};

/** 风险分 → 等级 */
export function bandFor(score: number): RiskBand {
  return RISK_BANDS.find((b) => score < b.max) ?? RISK_BANDS[RISK_BANDS.length - 1];
}

/** 线性映射到 0–100 并夹紧 */
export function scale(value: number | undefined, warn: number, danger: number): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  if (value <= warn) return 0;
  const t = (value - warn) / Math.max(danger - warn, 1e-9);
  return Math.max(0, Math.min(100, t * 100));
}

/**
 * 无否决项时，把发现项折算成 0–100 的风险分。
 *
 * 取"最严重项 + 其余项的 25%"而非简单求和：多个中危不该自动等于一个高危，
 * 但最严重的那一项必须完整计入 —— 否则会被大量 good 项稀释掉真实风险。
 */
export function scoreFromFindings(findings: { severity: string }[], cap = 100): number {
  const weights = findings.map((f) => SEVERITY_WEIGHT[f.severity] ?? 0);
  if (weights.length === 0) return 0;
  const worst = Math.max(...weights);
  const rest = weights.reduce((s, w) => s + w, 0) - worst;
  return Math.min(cap, worst + rest * 0.25);
}

// ── 第三方托管程序（锁仓 / 多签）────────────────────────────────────

//
// 判定「这个仓位是不是被程序控制」的依据：token account 的 authority
// （owner）不是一个普通钱包，而是某个程序的 PDA —— 可以用该 token account
// 的**创建交易里出现的 program id** 来确定是哪个程序（实测有效）。
//
// ⚠️ 只有 `timelock` 允许从集中度/巨鲸计算里剔除。
// `multisig` **不是时间锁**：多签金库可以随时凑齐签名转出，把它当锁仓
// 剔除等于把真巨鲸放过去 —— 属于危险的漏报，绝不可以。
//
// 程序 id 均来自真实链上数据（用 JUP 前 20 大持仓反查控制程序得到），
// 不是猜测。新增条目必须先核实再写入。
export type CustodyKind = 'timelock' | 'multisig' | 'unknown-program';

export const CUSTODY_PROGRAMS: Record<string, { kind: CustodyKind; label: string }> = {
  // Jupiter Lock：线性归属/锁仓，托管账户布局可解析（解析器在 providers/helius.ts）
  LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn: {
    kind: 'timelock',
    label: 'Jupiter Lock（锁仓）',
  },
  // Squads 多签金库：可随时签名转出，不剔除
  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: { kind: 'multisig', label: 'Squads 多签金库' },
};

/**
 * 从「流通盘 / 集中度 / 巨鲸」计算里剔除的持仓类型。
 *
 * 注意 `custody`（多签、未知托管）**不在**这里 —— 它们能随时卖出，
 * 必须计入集中度，只是单独标注出来让用户看得见。
 */
export const EXCLUDED_HOLDER_KINDS = new Set(['pool', 'burn', 'timelock']);

/**
 * 已知 AMM / 联合曲线程序。
 *
 * 这些程序**自己拥有**的 token account 就是池子的储备金库，属于流动性，
 * 必须从「集中度 / 巨鲸」里剔除。靠程序 id 判定比拿地址文本正则碰运气
 * 可靠得多 —— 实测某代币的 PumpSwap 金库占 5.15%，
 * 用旧的池识别完全没认出来，被当成大户计入了集中度。
 *
 * 每个 id 都用 Helius 交易的 `source` 字段独立核对过，不是凭记忆写的：
 *   PUMP_AMM / PUMP_FUN / METEORA / ORCA 等。
 */
export const AMM_PROGRAMS: Record<string, string> = {
  // pump.fun 联合曲线
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'pump.fun 联合曲线',
  // PumpSwap（pump.fun 的 AMM）
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: 'PumpSwap 池',
  // Meteora DLMM
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'Meteora DLMM 池',
  // Raydium AMM v4
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM v4 池',
  // Raydium CPMM
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: 'Raydium CPMM 池',
  // Orca Whirlpool
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'Orca Whirlpool 池',
};
