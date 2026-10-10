/**
 * 测试夹具 —— **仅供单元测试使用，不是产品数据**。
 *
 * 项目本身不提供任何模拟数据：`src/providers` 下全部是真实数据源，
 * 页面与 API 也只走真实链路。
 *
 * 但分析器是纯函数，要验证判定逻辑（池剔除、蜜罐、刷量、降级行为）
 * 就必须能构造输入。这些夹具的作用仅此而已 —— 它们的形状模仿
 * 真实 provider 的输出，用来锁住行为，不参与任何运行时路径。
 *
 * 刻意的设计：夹具按「健康 / 蜜罐 / 典型 rug」三个极端构造，
 * 用于验证模型**区分度**——如果模型对这三者给出相近分数，那它没有价值。
 */
import type { RawHolder, ScanInput } from './types';

const ZERO = '11111111111111111111111111111111';

function h(address: string, pct: number, extra: Partial<RawHolder> = {}): RawHolder {
  return { address, pct, amount: pct * 10_000_000, ...extra };
}

export const TEST_META = {
  source: 'test-fixture',
  live: true,
  fetchedAt: '2024-01-01T00:00:00.000Z',
  origins: {},
  warnings: [],
};

/** 健康：权限已弃、LP 已销毁、持仓分散、dev 未卖出、无硬否决 */
export function healthyInput(): ScanInput {
  return {
    token: {
      mint: 'HealthyMint111111111111111111111111111111111',
      symbol: 'GOODCAT',
      name: 'Good Cat',
      supply: 1_000_000_000,
      decimals: 6,
    },
    contract: {
      mintAuthority: null,
      freezeAuthority: null,
      lp: { exists: true, burned: true },
      isMutableMetadata: false,
    },
    liquidity: {
      graduated: true,
      realSolReserves: 82,
      lpLockedOrBurned: true,
      buyVolumeSol: 210,
      sellVolumeSol: 168,
      buyCount: 1420,
      sellCount: 860,
      sniperHoldPct: 4,
      holderCount: 2380,
      holderGrowth24h: 180,
      poolAddresses: ['RaydiumPoolV4xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'],
    },
    holders: [
      h('RaydiumPoolV4xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 28.4, { isPool: true }),
      h(ZERO, 12.0, { isBurn: true }),
      h('DevWalletHealthy111111111111111111111111111111', 3.2),
      ...Array.from({ length: 10 }, (_, i) => h(`Holder${i}Healthy11111111111111111111111111`, 1.2)),
    ],
    developer: {
      creator: 'DevWalletHealthy111111111111111111111111111111',
      priorTokens: [{ mint: 'Prev1111111111111111111111111111111111111111', rugged: false }],
      priorRugCount: 0,
      tokensLast7d: 1,
      devSoldRatio: 0,
      devHoldingPct: 3.2,
      linkedWallets: [],
    },
    social: {
      mentions24h: 1840,
      mentionGrowthPct: 62,
      engagementRatio: 0.38,
      suspectedBotRatio: 0.12,
      uniqueAuthors: 640,
    },
    meta: TEST_META,
  };
}

/** 蜜罐：买盘一边倒但卖单笔数极少 + 作恶扩展 */
export function honeypotInput(): ScanInput {
  return {
    token: { mint: 'HoneypotMint1111111111111111111111111111111', symbol: 'FREESOL', supply: 1_000_000_000 },
    contract: {
      mintAuthority: null,
      freezeAuthority: null,
      tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      extensions: ['transferHook', 'permanentDelegate'],
      lp: { exists: true, locked: true },
    },
    liquidity: {
      graduated: true,
      realSolReserves: 58,
      lpLockedOrBurned: true,
      buyVolumeSol: 240,
      sellVolumeSol: 7,
      buyCount: 1180,
      sellCount: 21,
      sniperHoldPct: 38,
      holderCount: 1240,
      poolAddresses: ['PumpSwapPool2222222222222222222222222222222'],
    },
    holders: [
      h('PumpSwapPool2222222222222222222222222222222', 30, { isPool: true }),
      h('DevWalletHoneypot1111111111111111111111111111', 14.2),
      h('SniperHoneypot11111111111111111111111111111', 9.8, { isSniper: true }),
      ...Array.from({ length: 8 }, (_, i) => h(`H${i}Honeypot111111111111111111111111111111`, 3)),
    ],
    developer: {
      creator: 'DevWalletHoneypot1111111111111111111111111111',
      priorTokens: [{ mint: 'S1', rugged: true }, { mint: 'S2', rugged: true }],
      priorRugCount: 2,
      tokensLast7d: 5,
      devSoldRatio: 0.95,
      devFirstSellAgeSec: 1800,
      fundedByMixer: true,
      hopCount: 3,
    },
    social: { mentions24h: 2200, suspectedBotRatio: 0.86, engagementRatio: 0.04, uniqueAuthors: 96 },
    meta: TEST_META,
  };
}

/** 典型 rug：撤池 + dev 清仓 + 高集中 + 转移税 */
export function rugInput(): ScanInput {
  return {
    token: { mint: 'RugMint111111111111111111111111111111111111', symbol: 'SAFEMOON2', supply: 1_000_000_000 },
    contract: {
      mintAuthority: null,
      freezeAuthority: null,
      lp: { exists: true, singleHolder: true, holder: 'DevWalletRug11111111111111111111111111111111' },
      transferFeeBps: 800,
    },
    liquidity: {
      graduated: true,
      realSolReserves: 1.2,
      liquidityPulled: true,
      lpLockedOrBurned: false,
      buyVolumeSol: 12,
      sellVolumeSol: 88,
      buyCount: 180,
      sellCount: 240,
      holderGrowth24h: -410,
      poolAddresses: ['PumpSwapPool3333333333333333333333333333333'],
    },
    holders: [
      h('PumpSwapPool3333333333333333333333333333333', 8, { isPool: true }),
      h('DevWalletRug11111111111111111111111111111111', 41),
      h('LinkedRug1111111111111111111111111111111111', 12.5, { isTeamWallet: true }),
      ...Array.from({ length: 7 }, (_, i) => h(`R${i}Rug11111111111111111111111111111111111`, 2)),
    ],
    developer: {
      creator: 'DevWalletRug11111111111111111111111111111111',
      priorRugCount: 3,
      priorTokens: [{ mint: 'X1', rugged: true }, { mint: 'X2', rugged: true }, { mint: 'X3', rugged: true }],
      tokensLast7d: 7,
      devSoldRatio: 1,
      devFullyExited: true,
      pulledLiquidity: true,
      fundedByMixer: true,
      hopCount: 4,
    },
    social: { mentions24h: 42, mentionGrowthPct: -88, suspectedBotRatio: 0.92, uniqueAuthors: 8 },
    meta: TEST_META,
  };
}

/** 权限未放弃：其余维度都干净，用于验证「仅一项否决」的分数一致性 */
export function openMintInput(): ScanInput {
  return {
    token: { mint: 'OpenMint11111111111111111111111111111111111', symbol: 'RISK', supply: 1_000_000_000 },
    contract: {
      mintAuthority: 'DevWalletOpen1111111111111111111111111111111',
      freezeAuthority: null,
      lp: { exists: true, locked: true },
    },
    liquidity: {
      graduated: true,
      realSolReserves: 44,
      lpLockedOrBurned: true,
      buyVolumeSol: 88,
      sellVolumeSol: 52,
      buyCount: 640,
      sellCount: 380,
      holderCount: 890,
      poolAddresses: ['RaydiumPoolV4yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'],
    },
    holders: [
      h('RaydiumPoolV4yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy', 24, { isPool: true }),
      ...Array.from({ length: 10 }, (_, i) => h(`O${i}Open11111111111111111111111111111111111`, 1.5)),
    ],
    developer: { creator: 'DevWalletOpen1111111111111111111111111111111', priorRugCount: 0, tokensLast7d: 2, devSoldRatio: 0.1 },
    social: { mentions24h: 640, suspectedBotRatio: 0.3, engagementRatio: 0.28, uniqueAuthors: 210 },
    meta: TEST_META,
  };
}

/** 全部维度数据缺失：用于验证「数据不足时拒绝给结论」 */
export function emptyInput(): ScanInput {
  return {
    token: { mint: 'EmptyMint1111111111111111111111111111111111' },
    contract: null,
    liquidity: null,
    holders: [],
    developer: null,
    social: null,
    meta: TEST_META,
  };
}
