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
    sniperWalletDanger: 25, // ⚠️ 狙击钱包持仓占比
  },
  liquidity: {
    sellPressureDanger: 60, // 卖方金额占比超过此值 → 抛压主导
    washTradeNetInflowSol: 0.5, // 笔数高但净流入低于此值 → 刷量
    sniperWalletDanger: 25, // ⚠️ 狙击钱包持仓占比
    minRealSolReserves: 5, // curve 内真实 SOL 过低 → 极易被砸穿
  },
  developer: {
    priorRugDanger: 2, // ⚠️ 历史 rug ≥ 2 次 → 硬否决
    priorRugWarn: 1,
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
