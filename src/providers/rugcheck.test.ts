/**
 * RugCheck 映射的测试。
 *
 * 这个映射修的是一个**结构性 bug**：`contract.lp.locked/burned` 与
 * `liquidity.lpLockedOrBurned` 之前没有任何 provider 写过，
 * 分析器里「LP 已销毁 / 已锁定 / 未锁定」全部分支都是死代码。
 * 所以这里锁住的重点是：
 *   1. 真实响应形状能正确变成三态结论（锁定 / 销毁 / 未锁）
 *   2. **bonding curve 市场绝不能被当成 AMM 池**（它也会报 lpLockedPct: 100）
 *   3. 拿不到信息时留空（undefined），不得编一个结论
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapRugCheckReport, type RugReport } from './rugcheck.ts';

const BURN = '1nc1nerator11111111111111111111111111111111';

/** 一个真实的 pump_fun_amm 市场：LP 100% 锁定 */
function lockedAmmReport(): RugReport {
  return {
    markets: [
      {
        pubkey: 'BJdDc4B7j7wrdNWv4EhT1mUVF4CtPtG3zGrZtwXk4tBo',
        marketType: 'pump_fun_amm',
        mintLP: 'DfXVUynpSwoWtKuWymobpoCUnsaP4WcmD9ELKtafxnRo',
        liquidityA: 'ff8wS35n4AqJcuAWbejyPVSLoPLt8wehAnMBwx3Xy1Y',
        liquidityB: 'DSFZVZgxVjyJLXpBjiaS4hNRdDG8i4beNScv8fnC3WwR',
        lp: { lpLockedPct: 100, baseUSD: 12296, quoteUSD: 12229, holders: [] },
      },
    ],
    totalHolders: 748,
    totalMarketLiquidity: 24524,
    knownAccounts: {},
    risks: [{ name: 'Low amount of LP Providers', level: 'warn' }],
  };
}

test('LP 锁定比例 100% → locked=true 并带上比例依据', () => {
  const r = mapRugCheckReport(lockedAmmReport());
  assert.equal(r.hasAmmMarket, true);
  assert.equal(r.lp?.locked, true);
  assert.equal(r.lp?.burned, undefined, '没有依据就不能说「已销毁」');
  assert.equal(r.lp?.lockedPct, 100);
  assert.equal(r.liquidity?.holderCount, 748, 'totalHolders 应变成 holderCount');
  assert.ok(r.warnings.some((w) => w.includes('Low amount of LP Providers')));
});

test('未锁定的 LP，单一地址持有 100% → locked=false + singleHolder，不冒充「未知」', () => {
  const r = mapRugCheckReport({
    markets: [
      {
        pubkey: 'Pool1111111111111111111111111111111111111111',
        marketType: 'pump_fun_amm',
        mintLP: 'LPMintUnlocked111111111111111111111111111111',
        liquidityA: 'VaultA11111111111111111111111111111111111111',
        liquidityB: 'VaultB11111111111111111111111111111111111111',
        lp: {
          lpLockedPct: 0.0000041,
          baseUSD: 61019,
          quoteUSD: 61446,
          holders: [{ owner: 'CreatorWallet1111111111111111111111111111111', pct: 100 }],
        },
      },
    ],
    totalHolders: 51,
    knownAccounts: { CreatorWallet1111111111111111111111111111111: { name: 'Creator', type: 'CREATOR' } },
  });
  assert.equal(r.lp?.locked, false);
  assert.equal(r.lp?.singleHolder, true);
  assert.equal(r.lp?.holder, 'CreatorWallet1111111111111111111111111111111');
});

test('LP 凭证在销毁地址里 → burned=true，即使 RugCheck 没给 lpBurnedPct', () => {
  const r = mapRugCheckReport({
    markets: [
      {
        pubkey: 'Pool2222222222222222222222222222222222222222',
        marketType: 'raydium',
        mintLP: 'LPMintBurned11111111111111111111111111111111',
        lp: { lpLockedPct: 0, holders: [{ owner: BURN, pct: 99.9 }] },
      },
    ],
  });
  assert.equal(r.lp?.burned, true);
  assert.equal(r.lp?.locked, false, '已销毁时不再说「已锁定」');
  assert.equal(r.lp?.lockedPct, 100);
});

test('bonding curve 市场（marketType=pump_fun）绝不能被当成 AMM 池的 LP 锁定', () => {
  // 实测真实数据：未毕业代币的曲线市场也会报 lpLockedPct: 100。
  // 把它当「LP 已锁定」，等于给还没毕业的代币发一张安全证明。
  const r = mapRugCheckReport({
    markets: [
      {
        pubkey: '4NxXAa8EyNM9nqxPcCY6fGf1tA22vnDQjmjje88XDYJr',
        marketType: 'pump_fun',
        liquidityA: '4RMrDe3Lp87jCzD8vU6eieckmGnT5JV1cSzqeDtDHJUE',
        lp: { lpLockedPct: 100, baseUSD: 2439, quoteUSD: 101 },
      },
    ],
    totalHolders: 3,
    totalMarketLiquidity: 2540,
  });
  assert.equal(r.hasAmmMarket, false);
  assert.equal(r.stillOnCurve, true);
  assert.equal(r.lp, undefined, '曲线市场不能产出任何 LP 锁定结论');
  // 但曲线的深度与金库地址仍然有用：金库要能用于持仓剔除
  assert.ok(r.liquidity?.liquidityUsd === 2540);
  assert.ok(r.poolAddresses.includes('4RMrDe3Lp87jCzD8vU6eieckmGnT5JV1cSzqeDtDHJUE'));
});

test('摘要端点（没有 markets）只能判定锁定比例，其余留空', () => {
  const r = mapRugCheckReport({ lpLockedPct: 80.8, totalHolders: 100, risks: [] });
  assert.equal(r.lp?.locked, false);
  assert.equal(r.lp?.lockedPct, 80.8);
  assert.equal(r.lp?.singleHolder, undefined, '没有持有者明细就不能说单一持有');
  assert.equal(r.hasAmmMarket, false);
  assert.equal(r.liquidity?.holderCount, 100, '摘要端点的 totalHolders 仍然可用');
  assert.equal(r.liquidity?.liquidityUsd, undefined, '摘要端点没有池深度数据，不得编一个');
  assert.ok(r.warnings.some((w) => w.includes('汇总数据')));
});

test('多池时按成交深度取主池，不被小额池带偏', () => {
  const r = mapRugCheckReport({
    markets: [
      {
        marketType: 'meteora',
        pubkey: 'SmallPool1111111111111111111111111111111111',
        mintLP: 'LPMintSmall111111111111111111111111111111111',
        lp: { lpLockedPct: 100, baseUSD: 10, quoteUSD: 10 },
      },
      {
        marketType: 'pump_fun_amm',
        pubkey: 'MainPool11111111111111111111111111111111111',
        mintLP: 'LPMintMain1111111111111111111111111111111111',
        lp: { lpLockedPct: 0, baseUSD: 90000, quoteUSD: 90000, holders: [] },
      },
    ],
  });
  assert.equal(r.lp?.locked, false, '主池未锁定才是真正可撤走的流动性');
});

test('RugCheck 判定 rug 时只写 true，不用 false 产出任何积极信号', () => {
  const rugged = mapRugCheckReport({ markets: [], rugged: true });
  assert.equal(rugged.liquidity?.rugged, true);
  const clean = mapRugCheckReport({ markets: [], rugged: false });
  assert.equal(clean.liquidity?.rugged, undefined);
});

test('LP mint 还是零地址（索引未完成）时，整体按未知处理，不得据此判可撤池', () => {
  // 实测形状：新币的 AMM 市场刚被索引到、LP mint 还没填，
  // 但 RugCheck 已经给出了 lpLockedPct≈0 与一个「LP 持有者」。
  // 照单全收会得到「LP 未锁定 + 单一地址持有」，而事实是 LP 尚未建立。
  const r = mapRugCheckReport({
    markets: [
      {
        pubkey: 'Pool3333333333333333333333333333333333333333',
        marketType: 'pump_fun_amm',
        mintLP: '11111111111111111111111111111111',
        lp: { lpLockedPct: 0.0000041, holders: [{ owner: 'CreatorWallet111', pct: 100 }] },
      },
    ],
  });
  assert.equal(r.hasAmmMarket, true, '池确实存在');
  assert.equal(r.lp?.locked, undefined, '但不能说「已确认未锁定」');
  assert.equal(r.lp?.singleHolder, undefined);
  assert.ok(r.warnings.some((w) => w.includes('索引未完成')));
});

test('部分锁定（62.9%）时要同时给出「未锁占比」与 LP 持有者明细', () => {
  // 用户实际看到的场景：lpLockedPct = 62.9%。
  // 这条结论不能只有一句「未锁定也未销毁」——必须能核对「没锁的那 37.1% 在谁手里」。
  const r = mapRugCheckReport({
    markets: [
      {
        pubkey: 'Pool4444444444444444444444444444444444444444',
        marketType: 'meteora',
        mintLP: 'LPMintPartial111111111111111111111111111111',
        lp: {
          lpLockedPct: 62.9,
          lpLocked: 629_000_000n as unknown as number,
          lpUnlocked: 371_000_000n as unknown as number,
          lpTotalSupply: 1_000_000_000n as unknown as number,
          baseUSD: 50000,
          quoteUSD: 50000,
          holders: [
            { owner: 'LockerAccount111111111111111111111111111111', pct: 62.9 },
            { owner: 'CreatorWallet1111111111111111111111111111111', pct: 37.1 },
          ],
        },
      },
    ],
    knownAccounts: {
      LockerAccount111111111111111111111111111111: { name: 'Streamflow', type: 'LOCKER' },
      CreatorWallet1111111111111111111111111111111: { name: 'Creator', type: 'CREATOR' },
    },
  });

  assert.equal(r.lp?.locked, false, '62.9% 未达 95% 阈值 → 未锁定');
  assert.equal(r.lp?.burned, undefined, '没有销毁依据就不能说已销毁');
  assert.equal(r.lp?.lockedPct, 62.9);
  assert.ok(
    Math.abs((r.lp?.unlockedPct ?? 0) - 37.1) < 1e-6,
    `未锁占比应由 lpUnlocked/lpTotalSupply 精确算出，实际 ${r.lp?.unlockedPct}`,
  );
  assert.deepEqual(
    r.lp?.lpHolders?.map((h) => [h.owner.slice(0, 6), h.pct, h.label]),
    [
      ['Locker', 62.9, 'Streamflow'],
      ['Creato', 37.1, 'Creator'],
    ],
  );
});

test('拿不到 lpUnlocked 时用比例相减兜底，仍然给出未锁占比', () => {
  const r = mapRugCheckReport({
    markets: [
      {
        pubkey: 'Pool5555555555555555555555555555555555555555',
        marketType: 'raydium',
        mintLP: 'LPMintPartial222222222222222222222222222222',
        lp: { lpLockedPct: 62.9, holders: [] },
      },
    ],
  });
  assert.ok(Math.abs((r.lp?.unlockedPct ?? 0) - 37.1) < 1e-6);
  assert.equal(r.lp?.lpHolders, undefined, '没有持有者明细就不写明细');
});

// ── 真实案例：未锁的 LP 其实躺在 Streamflow 线性解锁合约里 ──────────
// 两个真实代币（AVKpeeWa…pump 锁 68.3%、BdzaE3T7…pump 锁 50.6%）的「未锁」部分
// 全部由 Streamflow Vault 持有。把这段算成「随时可撤池」是冤枉项目方，
// 因此必须按持有人身份再拆成「锁仓托管」与「可自由提走」。
const STREAMFLOW = 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m';

test('未锁部分由锁仓合约持有时，要拆出 lockerPct / withdrawablePct', () => {
  const r = mapRugCheckReport({
    markets: [
      {
        pubkey: 'Pool6666666666666666666666666666666666666666',
        marketType: 'pump_fun_amm',
        mintLP: 'LPMintStreamflow11111111111111111111111111',
        lp: {
          lpLockedPct: 68.34,
          lpLocked: 4193388288181,
          lpUnlocked: 1942656566183,
          lpTotalSupply: 6136044854364,
          baseUSD: 21983,
          quoteUSD: 21983,
          holders: [
            { owner: 'StreamflowVault66666666666666666666666666666', pct: 31.5 },
            { owner: 'RandomWallet777777777777777777777777777777', pct: 0.157 },
          ],
        },
      },
    ],
    knownAccounts: {
      StreamflowVault66666666666666666666666666666: { name: 'Streamflow Vault', type: 'LOCKER' },
    },
    lockers: {
      'Contract11111111111111111111111111111111111': {
        programID: STREAMFLOW,
        tokenAccount: 'StreamflowVault66666666666666666666666666666',
        owner: STREAMFLOW,
        unlockDate: 1822366800,
        type: 'streamflow',
      },
    },
  });

  assert.equal(r.lp?.locked, false, '68.34% 未达 95% → 未达「已锁定」口径');
  assert.ok(Math.abs((r.lp?.unlockedPct ?? 0) - 31.66) < 0.01);
  assert.ok(Math.abs((r.lp?.lockerPct ?? 0) - 31.5) < 1e-6, '锁仓合约持有 31.5%');
  assert.ok(
    Math.abs((r.lp?.withdrawablePct ?? 0) - 0.16) < 0.01,
    `真正可自由提走的只有约 0.16%，实际 ${r.lp?.withdrawablePct}`,
  );
  assert.equal(r.lp?.lpHolders?.[0].isLocker, true);
  assert.equal(r.lp?.lpHolders?.[0].label, 'Streamflow Vault');
  assert.equal(
    r.lp?.lpHolders?.[0].unlockAt,
    new Date(1822366800 * 1000).toISOString().slice(0, 10),
    '解锁时间要透出来，否则用户无从判断什么时候能撤',
  );
  assert.equal(r.lp?.lpHolders?.[1].isLocker, undefined, '普通钱包不标记为锁仓');
});

test('LP 全在锁仓合约里时，不能判成「单一地址可随时撤池」', () => {
  const r = mapRugCheckReport({
    markets: [
      {
        pubkey: 'Pool7777777777777777777777777777777777777777',
        marketType: 'pump_fun_amm',
        mintLP: 'LPMintAllLocked111111111111111111111111111',
        lp: {
          lpLockedPct: 50,
          lpLocked: 50,
          lpUnlocked: 50,
          lpTotalSupply: 100,
          holders: [{ owner: 'StreamflowVault66666666666666666666666666666', pct: 50 }],
        },
      },
    ],
    knownAccounts: {
      StreamflowVault66666666666666666666666666666: { name: 'Streamflow Vault', type: 'LOCKER' },
    },
  });
  assert.equal(r.lp?.singleHolder, undefined, '锁仓账户不能算「随时可撤池」的那个地址');
});

test('未锁部分全在普通钱包且集中在一个地址 → 仍然是 singleHolder 否决', () => {
  const r = mapRugCheckReport({
    markets: [
      {
        pubkey: 'Pool8888888888888888888888888888888888888888',
        marketType: 'pump_fun_amm',
        mintLP: 'LPMintFreeSingle11111111111111111111111111',
        lp: {
          lpLockedPct: 0,
          lpLocked: 0,
          lpUnlocked: 100,
          lpTotalSupply: 100,
          holders: [{ owner: 'CreatorWallet1111111111111111111111111111111', pct: 100 }],
        },
      },
    ],
    knownAccounts: {
      CreatorWallet1111111111111111111111111111111: { name: 'Creator', type: 'CREATOR' },
    },
  });
  assert.equal(r.lp?.singleHolder, true);
  assert.equal(r.lp?.holder, 'CreatorWallet1111111111111111111111111111111');
  assert.equal(r.lp?.withdrawablePct, 100);
});

// ── 真实案例：RugCheck 的「锁定比例」其实就是「已销毁比例」 ──────────
// 9raUVuze…pump：历史铸造 6,670,716,023,992，链上供应 2,477,306,894,096，
// 差额 4,193,409,129,896（62.86%）已销毁。旧实现按字面读成「未锁定也未销毁」。
const LIVE_MINT = '3HWyWwRPBrAn5T2fFdiWizQqE3ktQ48BTJkuj7jdkZQ2';
const realReport = () => ({
  markets: [
    {
      pubkey: 'CtxHhwboVTtRf1kC4Zwfz8Zf8bNW78N2uuR3oZX5VFKb',
      marketType: 'pump_fun_amm',
      mintLP: LIVE_MINT,
      lp: {
        lpLockedPct: 62.86295376409249,
        lpLocked: 4_193_409_129_896,
        lpUnlocked: 2_477_306_894_096,
        lpTotalSupply: 6_670_716_023_992,
        baseUSD: 124_961,
        quoteUSD: 124_547,
        holders: [
          { owner: 'A6QVMEvCH8xQ4o7nx2tkob42MsYGuPcKE4hwx5Zvj9kj', pct: 12.361220436821114 },
          { owner: '4JBz4tAKgAmxjDPHHi9HRLj14RsCQJyuCkCFKnpz7B9s', pct: 10.794012646413076 },
          { owner: 'DdGV4neesEuQUS5cX3x9A9An5i6BBJkPhHEN6PA3aRkf', pct: 7.168123853814549 },
          { owner: 'GAbtMqB9P9Cz4vjXKLtfv4q74ctCTpGBDAjpWSFSJtGu', pct: 1.0957772808811095 },
          { owner: 'HEz4TSDqvehgf8PJRJMPiZLL4CJ2CUxeJhJiRbSqQfbm', pct: 0.4431277363731988 },
        ],
      },
    },
  ],
});

test('链上 LP 供应量差额 = 已销毁比例（62.86%），不再是「未锁定也未销毁」', () => {
  const r = mapRugCheckReport(realReport(), { liveLpSupply: 2_477_306_894_096 });
  assert.ok(Math.abs((r.lp?.burnedPct ?? 0) - 62.86295376409249) < 1e-6, `实际 ${r.lp?.burnedPct}`);
  assert.deepEqual(r.lp?.lpAudit, {
    everMinted: 6_670_716_023_992,
    live: 2_477_306_894_096,
    burned: 4_193_409_129_896,
  });
  assert.equal(r.lp?.locked, false, '62.86% 不到 95%，不构成「整体已锁定」');
  assert.equal(r.lp?.burned, undefined, '没到 95% 就不整体判成已销毁');
  assert.equal(r.lp?.lpMint, LIVE_MINT, 'LP mint 要透出来，用户才能自己去链上核对');
  // 集中度必须按**流通量**算：最大持有者占全量 12.36%，占流通量则是 33.3%
  assert.equal(r.lp?.circulatingHolderCount, 5);
  assert.ok(
    Math.abs((r.lp?.topCirculatingHolderPct ?? 0) - 33.29) < 0.5,
    `最大持有者占流通量应约 33.3%，实际 ${r.lp?.topCirculatingHolderPct}`,
  );
});

test('销毁比例 ≥95% → 判为「已销毁」（比「已锁定」更硬）', () => {
  const r = mapRugCheckReport(
    {
      markets: [
        {
          pubkey: 'Pool9999999999999999999999999999999999999999',
          marketType: 'pump_fun_amm',
          mintLP: 'LPMintBurned111111111111111111111111111111',
          lp: { lpLockedPct: 100, lpLocked: 1000, lpUnlocked: 0, lpTotalSupply: 1000, holders: [] },
        },
      ],
    },
    { liveLpSupply: 0 },
  );
  assert.equal(r.lp?.burned, true);
  assert.equal(r.lp?.locked, false);
  assert.equal(r.lp?.burnedPct, 100);
});

test('拿不到链上供应量时不得声称已销毁（只留 RugCheck 口径）', () => {
  const r = mapRugCheckReport(realReport());
  assert.equal(r.lp?.burnedPct, undefined);
  assert.equal(r.lp?.lpAudit, undefined);
  assert.equal(r.lp?.topCirculatingHolderPct, undefined, '没有流通量分母就不得算集中度');
  assert.equal(r.lp?.lockedPct, 62.86295376409249, 'RugCheck 的原始比例仍然保留');
});

test('creator 持有流通 LP 的比例要单独算出来', () => {
  const r = mapRugCheckReport(
    {
      markets: [
        {
          pubkey: 'PoolAAAA000000000000000000000000000000000000',
          marketType: 'pump_fun_amm',
          mintLP: 'LPMintCreator11111111111111111111111111111',
          lp: {
            lpLockedPct: 50,
            lpLocked: 50,
            lpUnlocked: 50,
            lpTotalSupply: 100,
            holders: [
              { owner: 'CreatorWallet1111111111111111111111111111111', pct: 20 },
              { owner: 'RandomWallet11111111111111111111111111111111', pct: 30 },
            ],
          },
        },
      ],
      knownAccounts: {
        CreatorWallet1111111111111111111111111111111: { name: 'Creator', type: 'CREATOR' },
      },
    },
    { liveLpSupply: 50 },
  );
  assert.ok(
    Math.abs((r.lp?.creatorLpPct ?? 0) - 40) < 1e-6,
    `creator 占流通 LP 的 40%（20/50），实际 ${r.lp?.creatorLpPct}`,
  );
});
