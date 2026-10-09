/**
 * 样本数据 Provider —— 离线演示与自检用。
 *
 * 这 6 个场景是一条从「健康」到「典型 rug」的光谱，用来验证评分模型的**区分度**：
 * 如果一个模型对健康项目和 rug 项目给出相近的分数，那它没有价值。
 *
 * 这些数据是**构造的**，不是真实链上数据。UI 必须明确标注，
 * 绝不能让人误以为这是某个真实代币的体检结果。
 */
import type { RawHolder, ScanInput } from '../core/types';

const ZERO = '11111111111111111111111111111111';

function holder(
  address: string,
  pct: number,
  extra: Partial<RawHolder> = {},
): RawHolder {
  return { address, pct, amount: pct * 10_000_000, ...extra };
}

function meta(source: string) {
  return {
    source,
    live: false,
    fetchedAt: new Date().toISOString(),
    origins: {
      token: 'sample' as const,
      contract: 'sample' as const,
      liquidity: 'sample' as const,
      holders: 'sample' as const,
      developer: 'sample' as const,
      social: 'sample' as const,
    },
    warnings: ['当前为内置样本数据，不是真实链上数据 —— 仅用于演示分析链路。'],
  };
}

export interface Sample {
  key: string;
  label: string;
  blurb: string;
  data: ScanInput;
}

export const SAMPLES: Sample[] = [
  // ── 1. 健康项目 ────────────────────────────────────────────────
  {
    key: 'healthy',
    label: 'GOODCAT · 健康样本',
    blurb: '权限已弃、LP 已销毁、持仓分散、dev 未卖出',
    data: {
      token: { mint: 'GoodCat111111111111111111111111111111111111', symbol: 'GOODCAT', name: 'Good Cat', supply: 1_000_000_000, priceUsd: 0.00042, marketCapUsd: 420_000, createdAt: Date.now() - 86_400_000 * 3 },
      contract: { mintAuthority: null, freezeAuthority: null, lp: { exists: true, burned: true }, isMutableMetadata: false },
      liquidity: { graduated: true, realSolReserves: 82, graduationTargetSol: 85, lpLockedOrBurned: true, buyVolumeSol: 210, sellVolumeSol: 168, buyCount: 1420, sellCount: 860, sniperHoldPct: 4, holderCount: 2380, holderGrowth24h: 180, liquidityUsd: 96_000, poolAddresses: ['RaydiumPoolV4xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'] },
      holders: [
        holder('RaydiumPoolV4xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 28.4, { isPool: true, label: 'Raydium AMM Pool' }),
        holder(ZERO, 12.0, { isBurn: true }),
        holder('DevWallet111111111111111111111111111111111', 3.2),
        holder('Holder2111111111111111111111111111111111111', 2.1),
        holder('Holder3111111111111111111111111111111111111', 1.8),
        holder('Holder4111111111111111111111111111111111111', 1.5),
        holder('Holder5111111111111111111111111111111111111', 1.3),
        holder('Holder6111111111111111111111111111111111111', 1.1),
        holder('Holder7111111111111111111111111111111111111', 1.0),
        holder('Holder8111111111111111111111111111111111111', 0.9),
        holder('Holder9111111111111111111111111111111111111', 0.8),
        holder('HolderA1111111111111111111111111111111111111', 0.7),
      ],
      developer: { creator: 'DevWallet111111111111111111111111111111111', priorTokens: [{ mint: 'Prev1111111111111111111111111111111111111111', symbol: 'OLDCAT', rugged: false }], priorRugCount: 0, tokensLast7d: 1, devSoldRatio: 0, devHoldingPct: 3.2, linkedWallets: [], twitterAgeDays: 420 },
      social: { mentions24h: 1840, mentionGrowthPct: 62, engagementRatio: 0.38, suspectedBotRatio: 0.12, retweetToReplyRatio: 2.1, uniqueAuthors: 640 },
    },
  },

  // ── 2. 新发但结构正常 ──────────────────────────────────────────
  {
    key: 'newLaunch',
    label: 'FRESH · 新发正常',
    blurb: '刚发币，无前科，热度自然，但 curve 深度尚浅',
    data: {
      token: { mint: 'Fresh11111111111111111111111111111111111111', symbol: 'FRESH', name: 'Fresh Launch', supply: 1_000_000_000, priceUsd: 0.000021, marketCapUsd: 21_000, createdAt: Date.now() - 3_600_000 },
      contract: { mintAuthority: null, freezeAuthority: null, lp: { exists: false }, isMutableMetadata: true },
      liquidity: { graduated: false, realSolReserves: 18, graduationTargetSol: 85, buyVolumeSol: 24, sellVolumeSol: 6, buyCount: 310, sellCount: 74, sniperHoldPct: 11, holderCount: 142, holderGrowth24h: 142, poolAddresses: ['BondingCurve11111111111111111111111111111111'] },
      holders: [
        holder('BondingCurve11111111111111111111111111111111', 62.0, { isPool: true, label: 'pump.fun bonding curve' }),
        holder('DevWallet222222222222222222222222222222222', 4.8),
        holder('Sniper1111111111111111111111111111111111111', 4.2, { isSniper: true }),
        holder('Sniper2111111111111111111111111111111111111', 3.6, { isSniper: true }),
        holder('Holder2111111111111111111111111111111111111', 3.1),
        holder('Holder3111111111111111111111111111111111111', 2.7),
        holder('Holder4111111111111111111111111111111111111', 2.2),
        holder('Holder5111111111111111111111111111111111111', 1.9),
        holder('Holder6111111111111111111111111111111111111', 1.6),
        holder('Holder7111111111111111111111111111111111111', 1.4),
        holder('Holder8111111111111111111111111111111111111', 1.2),
      ],
      developer: { creator: 'DevWallet222222222222222222222222222222222', priorTokens: [], priorRugCount: 0, tokensLast7d: 1, devSoldRatio: 0, devHoldingPct: 4.8, linkedWallets: [], twitterAgeDays: 30 },
      social: { mentions24h: 96, mentionGrowthPct: 240, engagementRatio: 0.31, suspectedBotRatio: 0.22, retweetToReplyRatio: 3.4, uniqueAuthors: 58 },
    },
  },

  // ── 3. 慢速失血（未触发否决，但风险显著）───────────────────────
  {
    key: 'slowRug',
    label: 'MOONX · 缓慢失血',
    blurb: '热度衰减、dev 减持、抛压主导，但未触发硬否决',
    data: {
      token: { mint: 'MoonX11111111111111111111111111111111111111', symbol: 'MOONX', name: 'Moon X', supply: 1_000_000_000, priceUsd: 0.0000089, marketCapUsd: 8_900, createdAt: Date.now() - 86_400_000 * 6 },
      contract: { mintAuthority: null, freezeAuthority: null, lp: { exists: true, locked: false, singleHolder: false }, isMutableMetadata: true },
      liquidity: { graduated: true, realSolReserves: 11, lpLockedOrBurned: false, buyVolumeSol: 34, sellVolumeSol: 96, buyCount: 420, sellCount: 380, sniperHoldPct: 31, holderCount: 410, holderGrowth24h: -38, liquidityUsd: 9_800, poolAddresses: ['PumpSwapPool1111111111111111111111111111111'] },
      holders: [
        holder('PumpSwapPool1111111111111111111111111111111', 22.0, { isPool: true, label: 'PumpSwap AMM Pool' }),
        holder('DevWallet333333333333333333333333333333333', 12.4),
        holder('TeamWallet11111111111111111111111111111111111', 6.8, { isTeamWallet: true }),
        holder('Whale11111111111111111111111111111111111111', 8.2),
        holder('Sniper1111111111111111111111111111111111111', 5.4, { isSniper: true }),
        holder('Sniper2111111111111111111111111111111111111', 4.1, { isSniper: true }),
        holder('Holder2111111111111111111111111111111111111', 3.4),
        holder('Holder3111111111111111111111111111111111111', 2.9),
        holder('Holder4111111111111111111111111111111111111', 2.4),
        holder('Holder5111111111111111111111111111111111111', 2.0),
        holder('Holder6111111111111111111111111111111111111', 1.7),
      ],
      developer: { creator: 'DevWallet333333333333333333333333333333333', priorTokens: [{ mint: 'Prev211111111111111111111111111111111111111', symbol: 'MOONY', rugged: true }], priorRugCount: 1, tokensLast7d: 4, devSoldRatio: 0.55, devHoldingPct: 12.4, devFirstSellAgeSec: 7200, linkedWallets: ['Linked1111111111111111111111111111111111111'], twitterAgeDays: 9 },
      social: { mentions24h: 210, mentionGrowthPct: -46, engagementRatio: 0.11, suspectedBotRatio: 0.48, retweetToReplyRatio: 9.2, uniqueAuthors: 22, telegramGrowthSpiky: true },
    },
  },

  // ── 4. 权限未弃（硬否决）───────────────────────────────────────
  {
    key: 'openMint',
    label: 'RISK · 权限未放弃',
    blurb: 'mint authority 仍在，可无限增发稀释你',
    data: {
      token: { mint: 'RiskMint11111111111111111111111111111111111', symbol: 'RISK', name: 'Risk Token', supply: 1_000_000_000, priceUsd: 0.00012, marketCapUsd: 120_000, createdAt: Date.now() - 86_400_000 * 2 },
      contract: { mintAuthority: 'DevWallet444444444444444444444444444444444', freezeAuthority: null, lp: { exists: true, locked: true, unlockAt: '2027-01-01', locker: 'Streamflow' }, isMutableMetadata: true },
      liquidity: { graduated: true, realSolReserves: 44, lpLockedOrBurned: true, buyVolumeSol: 88, sellVolumeSol: 52, buyCount: 640, sellCount: 380, sniperHoldPct: 12, holderCount: 890, holderGrowth24h: 64, liquidityUsd: 41_000, poolAddresses: ['RaydiumPoolV4yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'] },
      holders: [
        holder('RaydiumPoolV4yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy', 24.0, { isPool: true, label: 'Raydium AMM Pool' }),
        holder('DevWallet444444444444444444444444444444444', 9.6),
        holder('Holder2111111111111111111111111111111111111', 3.8),
        holder('Holder3111111111111111111111111111111111111', 3.1),
        holder('Holder4111111111111111111111111111111111111', 2.6),
        holder('Holder5111111111111111111111111111111111111', 2.2),
        holder('Holder6111111111111111111111111111111111111', 1.9),
        holder('Holder7111111111111111111111111111111111111', 1.6),
        holder('Holder8111111111111111111111111111111111111', 1.3),
        holder('Holder9111111111111111111111111111111111111', 1.1),
        holder('HolderA1111111111111111111111111111111111111', 0.9),
      ],
      developer: { creator: 'DevWallet444444444444444444444444444444444', priorTokens: [{ mint: 'Prev311111111111111111111111111111111111111', symbol: 'ABC', rugged: false }], priorRugCount: 0, tokensLast7d: 2, devSoldRatio: 0.1, devHoldingPct: 9.6, linkedWallets: [], twitterAgeDays: 120 },
      social: { mentions24h: 640, mentionGrowthPct: 18, engagementRatio: 0.28, suspectedBotRatio: 0.3, retweetToReplyRatio: 4.1, uniqueAuthors: 210 },
    },
  },

  // ── 5. 蜜罐：买得进卖不出（硬否决）─────────────────────────────
  {
    key: 'honeypot',
    label: 'FREESOL · 蜜罐',
    blurb: '买盘一边倒但卖单笔数＜5% —— 根本卖不出去',
    data: {
      token: { mint: 'FreeSol111111111111111111111111111111111111', symbol: 'FREESOL', name: 'Free SOL', supply: 1_000_000_000, priceUsd: 0.00031, marketCapUsd: 310_000, createdAt: Date.now() - 86_400_000 },
      contract: { mintAuthority: null, freezeAuthority: null, tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', extensions: ['transferHook', 'permanentDelegate'], lp: { exists: true, locked: true }, isMutableMetadata: true },
      liquidity: { graduated: true, realSolReserves: 58, lpLockedOrBurned: true, buyVolumeSol: 240, sellVolumeSol: 7, buyCount: 1180, sellCount: 21, sniperHoldPct: 38, holderCount: 1240, holderGrowth24h: 420, liquidityUsd: 62_000, poolAddresses: ['PumpSwapPool2222222222222222222222222222222'] },
      holders: [
        holder('PumpSwapPool2222222222222222222222222222222', 30.0, { isPool: true, label: 'PumpSwap AMM Pool' }),
        holder('DevWallet555555555555555555555555555555555', 14.2),
        holder('Sniper1111111111111111111111111111111111111', 9.8, { isSniper: true }),
        holder('Sniper2111111111111111111111111111111111111', 7.4, { isSniper: true }),
        holder('Sniper3111111111111111111111111111111111111', 6.2, { isSniper: true }),
        holder('Holder2111111111111111111111111111111111111', 4.1),
        holder('Holder3111111111111111111111111111111111111', 3.2),
        holder('Holder4111111111111111111111111111111111111', 2.6),
        holder('Holder5111111111111111111111111111111111111', 2.2),
        holder('Holder6111111111111111111111111111111111111', 1.8),
        holder('Holder7111111111111111111111111111111111111', 1.5),
      ],
      developer: { creator: 'DevWallet555555555555555555555555555555555', priorTokens: [{ mint: 'Prev411111111111111111111111111111111111111', symbol: 'SCAM1', rugged: true }, { mint: 'Prev511111111111111111111111111111111111111', symbol: 'SCAM2', rugged: true }], priorRugCount: 2, tokensLast7d: 5, devSoldRatio: 0.95, devHoldingPct: 14.2, devFirstSellAgeSec: 1800, linkedWallets: ['Linked2111111111111111111111111111111111111', 'Linked3111111111111111111111111111111111111'], fundedByMixer: true, hopCount: 3, twitterAgeDays: 2 },
      social: { mentions24h: 2200, mentionGrowthPct: 880, engagementRatio: 0.04, suspectedBotRatio: 0.86, retweetToReplyRatio: 14.5, uniqueAuthors: 96, telegramGrowthSpiky: true },
    },
  },

  // ── 6. 经典 rug（多项否决）─────────────────────────────────────
  {
    key: 'classicRug',
    label: 'SAFE MOON · 典型 rug',
    blurb: '撤池 + 清仓 + 高集中 + 前科，全方位的死',
    data: {
      token: { mint: 'SafeMoon11111111111111111111111111111111111', symbol: 'SAFE MOON2', name: 'Safe Moon 2', supply: 1_000_000_000, priceUsd: 0.0000001, marketCapUsd: 100, createdAt: Date.now() - 86_400_000 * 1.2 },
      contract: { mintAuthority: null, freezeAuthority: null, lp: { exists: true, singleHolder: true, holder: 'DevWallet666666666666666666666666666666666' }, isMutableMetadata: true, transferFeeBps: 800 },
      liquidity: { graduated: true, realSolReserves: 1.2, liquidityPulled: true, lpLockedOrBurned: false, buyVolumeSol: 12, sellVolumeSol: 88, buyCount: 180, sellCount: 240, sniperHoldPct: 62, holderCount: 96, holderGrowth24h: -410, liquidityUsd: 900, poolAddresses: ['PumpSwapPool3333333333333333333333333333333'] },
      holders: [
        holder('PumpSwapPool3333333333333333333333333333333', 8.0, { isPool: true, label: 'PumpSwap AMM Pool' }),
        holder('DevWallet666666666666666666666666666666666', 41.0),
        holder('Linked11111111111111111111111111111111111111', 12.5, { isTeamWallet: true }),
        holder('Sniper1111111111111111111111111111111111111', 8.0, { isSniper: true }),
        holder('Holder2111111111111111111111111111111111111', 4.2),
        holder('Holder3111111111111111111111111111111111111', 3.1),
        holder('Holder4111111111111111111111111111111111111', 2.4),
        holder('Holder5111111111111111111111111111111111111', 1.8),
        holder('Holder6111111111111111111111111111111111111', 1.4),
        holder('Holder7111111111111111111111111111111111111', 1.1),
      ],
      developer: { creator: 'DevWallet666666666666666666666666666666666', priorTokens: [{ mint: 'Prev611111111111111111111111111111111111111', symbol: 'RUG1', rugged: true }, { mint: 'Prev711111111111111111111111111111111111111', symbol: 'RUG2', rugged: true }, { mint: 'Prev811111111111111111111111111111111111111', symbol: 'RUG3', rugged: true }], priorRugCount: 3, tokensLast7d: 7, devSoldRatio: 1, devFullyExited: true, pulledLiquidity: true, devFirstSellAgeSec: 900, linkedWallets: ['Linked11111111111111111111111111111111111111'], fundedByMixer: true, hopCount: 4, twitterAgeDays: 1 },
      social: { mentions24h: 42, mentionGrowthPct: -88, engagementRatio: 0.02, suspectedBotRatio: 0.92, retweetToReplyRatio: 22, uniqueAuthors: 8, telegramGrowthSpiky: true },
    },
  },
];

export function getSample(key: string): Sample | undefined {
  return SAMPLES.find((s) => s.key === key);
}

export function sampleScanInput(key: string): ScanInput | undefined {
  const s = getSample(key);
  if (!s) return undefined;
  return { ...s.data, meta: meta(`内置样本 · ${s.label}`) };
}
