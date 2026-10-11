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
