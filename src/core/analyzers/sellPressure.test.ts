/**
 * 抛压分布测试。
 *
 * 锁的是四类「算错了会给出完全错误结论」的地方：
 * 1. 铸造型交易被当成买入 → 假成本 1e-7 → 报出「浮盈 +54771%」（真出现过）；
 * 2. 已卖光的钱包仍被算成抛压；
 * 3. 配对率用错分母 → 永远 100% → 最关键的警告永不出现（真出现过）；
 * 4. 现价太旧时硬给盈亏结论。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aggregateCostBasis, analyzeSellPressure, mergeTradeSources } from './sellPressure.ts';
import type { ScanInput, SellPressureInfo, SellPressureWallet } from '../types.ts';

const DAY = 86_400;
const NOW = 1_800_000_000;

type T = {
  trader: string;
  side: 'buy' | 'sell';
  sol: number;
  tokenAmount: number;
  ts?: number;
  mintLike?: true;
};

function input(over: {
  trades: T[];
  windowTrades?: number;
  circulatingTokens?: number;
  holderBalances?: Map<string, number>;
  deepTrades?: T[];
  deepAddresses?: number;
}): ScanInput {
  return {
    token: { mint: 'M', symbol: 'T', supply: 1_000_000 },
    sellPressure: {
      trades: over.trades,
      windowTrades: over.windowTrades ?? over.trades.length,
      nowSec: NOW,
      circulatingTokens: over.circulatingTokens ?? 1_000_000,
      ...(over.holderBalances ? { holderBalances: over.holderBalances } : {}),
      ...(over.deepTrades ? { deepTrades: over.deepTrades } : {}),
      ...(over.deepAddresses !== undefined ? { deepAddresses: over.deepAddresses } : {}),
    },
  };
}

const info = (r: ReturnType<typeof analyzeSellPressure>) => r.metrics as unknown as SellPressureInfo;

test('没有可配对的成交时是「无法计算」，不是「没有抛压」', () => {
  const r = analyzeSellPressure({ token: { mint: 'M' } });
  assert.equal(r.metrics!.available, 0);
  assert.ok(r.findings[0].detail.includes('不是「没有抛压」'));
});

test('【回归】铸造/创建拿到的代币不能算买入成本（会算出假浮盈）', () => {
  // 实测 pump.fun 的 CREATE 交易：铸 10 亿枚给 curve，转 35.7 万枚给创建者，
  // 创建者只付 0.036 SOL 手续费 —— 当成买入会得到 1e-7 SOL/枚 的假成本。
  const r = analyzeSellPressure(
    input({
      trades: [
        { trader: 'creator', side: 'buy', sol: 0.036, tokenAmount: 357_547, ts: NOW - 400 * DAY, mintLike: true },
        // buyer：0.05 SOL / 1000 枚 = 5e-5 SOL/枚
        { trader: 'buyer', side: 'buy', sol: 0.05, tokenAmount: 1_000, ts: NOW - 1 * DAY },
        // 现价来源：刚刚成交，1e-4 SOL/枚（买方浮盈 +100%）
        { trader: 'recent', side: 'buy', sol: 0.01, tokenAmount: 100, ts: NOW - 600 },
      ],
      circulatingTokens: 10_000,
    }),
  );
  const m = info(r);
  assert.equal(m.mintedWallets, 1, '铸造型地址要单列');
  assert.ok(m.mintedUnsoldTokens > 0);
  assert.ok(
    !m.topHoldersAtProfit.some((w) => w.address === 'creator'),
    '铸造获得的筹码没有买入价，不能出现在「浮盈持仓」里',
  );
  assert.ok(
    r.findings.some((f) => f.title.includes('铸造/创建获得')),
    '必须有一条 finding 说明这些筹码无买入价',
  );
  // 正常买入的钱包仍然要正常算。creator 绝不能出现；
  // recent 是给现价定锚的那一笔，成本恰等于现价（pnl=0），所以也不该在「浮盈」里。
  const addrs = m.topHoldersAtProfit.map((w) => w.address);
  assert.deepEqual(addrs, ['buyer']);
  assert.equal(m.walletsAnalyzed, 2, 'creator 与 buyer 都还有未卖筹码（recent 的仓位也算）');
});

test('aggregateCostBasis 把铸造型交易隔离开，不参与加权', () => {
  const { wallets, minted } = aggregateCostBasis([
    { trader: 'a', side: 'buy', sol: 1, tokenAmount: 100 },
    { trader: 'a', side: 'buy', sol: 0.01, tokenAmount: 1_000_000, mintLike: true },
    { trader: 'a', side: 'buy', sol: 1, tokenAmount: 100 },
  ]);
  const w = wallets.get('a')!;
  assert.equal(w.boughtTokens, 200, '铸造的 100 万枚不能进买入量');
  assert.equal(w.boughtSol, 2);
  assert.ok(Math.abs(w.boughtSol / w.boughtTokens - 0.01) < 1e-9, '成本应是 0.01 而不是被拉到 1e-8');
  assert.equal(minted.get('a'), 1_000_000);
});

test('【回归】配对率的分母是窗口内全部成交，不是配对后的子集', () => {
  const trades: T[] = [
    { trader: 'a', side: 'buy', sol: 1, tokenAmount: 100, ts: NOW - DAY },
  ];
  // 窗口里其实有 100 笔，只有 1 笔能配对 → 配对率 1%，不是 100%
  const r = analyzeSellPressure(input({ trades, windowTrades: 100 }));
  assert.equal(info(r).attributionPct, 1);
  assert.ok(
    r.findings.some((f) => f.title.includes('能配对出成本')),
    '配对率过低必须给警告，否则「只覆盖一小部分筹码」永远不会被说出来',
  );
});

test('已卖光的钱包不再构成抛压，哪怕它赚了很多', () => {
  const r = analyzeSellPressure(
    input({
      trades: [
        { trader: 'exited', side: 'buy', sol: 1, tokenAmount: 1000, ts: NOW - 10 * DAY },
        { trader: 'exited', side: 'sell', sol: 5, tokenAmount: 1000, ts: NOW - 1 * DAY },
        { trader: 'holder', side: 'buy', sol: 1, tokenAmount: 1000, ts: NOW - 10 * DAY },
      ],
      circulatingTokens: 100_000,
    }),
  );
  const m = info(r);
  assert.equal(m.exitedWallets, 1);
  assert.equal(m.walletsAnalyzed, 1, '只有还持有的那个算抛压');
  assert.equal(m.totalUnsoldTokens, 1000);
});

test('卖了一半的按剩余部分折算', () => {
  const r = analyzeSellPressure(
    input({
      trades: [
        { trader: 'half', side: 'buy', sol: 2, tokenAmount: 1000, ts: NOW - 10 * DAY },
        { trader: 'half', side: 'sell', sol: 1, tokenAmount: 500, ts: NOW - 1 * DAY },
      ],
      circulatingTokens: 100_000,
    }),
  );
  const w = info(r).topHoldersAtProfit[0] ?? info(r).buckets;
  assert.ok(w, '卖了一半的钱包仍要有记录');
  assert.equal(info(r).totalUnsoldTokens, 500, '只算剩下的一半');
  assert.equal(info(r).distributingWallets, 1);
});

test('窗口估算的未卖量高于实际余额时取余额（保守）', () => {
  const r = analyzeSellPressure(
    input({
      // 窗口内只看到买了 1000 枚，但它现在余额只有 100（缺口中卖了 900）
      trades: [{ trader: 'sneaky', side: 'buy', sol: 1, tokenAmount: 1000, ts: NOW - 10 * DAY }],
      circulatingTokens: 100_000,
      holderBalances: new Map([['sneaky', 100]]),
    }),
  );
  assert.equal(info(r).totalUnsoldTokens, 100, '窗口没覆盖的卖出看不到，必须用余额兜底');
});

test('现价太旧时停用盈亏分桶，改给成本价分布', () => {
  const old = NOW - 30 * DAY;
  const r = analyzeSellPressure(
    input({
      trades: [
        { trader: 'a', side: 'buy', sol: 1, tokenAmount: 1000, ts: old },
        { trader: 'b', side: 'buy', sol: 5, tokenAmount: 1000, ts: old - DAY },
      ],
      circulatingTokens: 100_000,
    }),
  );
  const m = info(r);
  assert.equal(m.priceSol, undefined, '30 天前的价格不能当现价');
  assert.ok(
    r.findings.some((f) => f.title.includes('隐含现价不可靠')),
    '必须说明盈亏一栏为什么是空的',
  );
  assert.ok((m.costBuckets ?? []).length > 0, '现价不可靠时要给成本价分布作为替代视图');
  assert.equal(m.buckets.every((b) => b.wallets === 0), true, '盈亏分桶应为空，不能硬凑');
});

test('盈亏分桶互斥且覆盖全部未卖持仓', () => {
  const trades: T[] = [];
  // 一笔成交定出现价，其余钱包成本各不相同
  trades.push({ trader: 'price', side: 'buy', sol: 1, tokenAmount: 10_000, ts: NOW - 100 });
  for (const [i, cost] of [1e-6, 5e-5, 1e-4, 4e-5].entries()) {
    trades.push({ trader: `w${i}`, side: 'buy', sol: cost * 1000, tokenAmount: 1000, ts: NOW - 200 - i });
  }
  const r = analyzeSellPressure(input({ trades, circulatingTokens: 100_000 }));
  const m = info(r);
  const bucketSum = m.buckets.reduce((s, b) => s + b.unsoldTokens, 0);
  assert.ok(
    Math.abs(bucketSum - m.totalUnsoldTokens) < 1e-6,
    `分桶合计 ${bucketSum} 必须等于未卖总量 ${m.totalUnsoldTokens}（不能有筹码掉在桶外）`,
  );
  const wallets = m.buckets.reduce((s, b) => s + b.wallets, 0);
  assert.equal(wallets, m.walletsAnalyzed);
});

test('逐行证据里带着可以核对的字段', () => {
  const r = analyzeSellPressure(
    input({
      trades: [
        // w 花 1 SOL 买 1000 枚 = 0.001 SOL/枚
        { trader: 'w', side: 'buy', sol: 1, tokenAmount: 1000, ts: NOW - 5 * DAY },
        // 现价 0.002 SOL/枚（刚刚成交）→ w 浮盈 +100%
        { trader: 'pricer', side: 'buy', sol: 0.02, tokenAmount: 10, ts: NOW - 300 },
      ],
      circulatingTokens: 100_000,
    }),
  );
  const row: SellPressureWallet = info(r).topHoldersAtProfit.find((x) => x.address === 'w')!;
  assert.ok(row, 'w 应该出现在浮盈持仓里');
  assert.ok(row.avgCostSol > 0);
  assert.equal(row.boughtTokens, 1000);
  assert.equal(row.soldPct, 0);
  assert.equal(row.unsoldTokens, 1000);
  assert.equal(row.costSol, 1);
  assert.ok(Math.abs(row.pnlPct - 100) < 1e-6, `w 应是 +100% 浮盈，实际 ${row.pnlPct}`);
  assert.ok(row.lastTs !== undefined, '要能看出这是什么时候买的');
});

// ── 深度模式（逐地址完整历史）──────────────────────────────────────

test('【回归】深度数据必须**替换**而不是叠加同一地址的窗口成交', () => {
  // 同一个地址在两个数据源里都有：叠加会把同期买入算两遍，加权成本直接失真。
  const { trades, deepAddresses } = mergeTradeSources(
    [
      { trader: 'a', side: 'buy', sol: 1, tokenAmount: 100 },
      { trader: 'b', side: 'buy', sol: 1, tokenAmount: 100 },
    ],
    [{ trader: 'a', side: 'buy', sol: 5, tokenAmount: 100 }],
  );
  assert.ok(deepAddresses.has('a'));
  assert.equal(trades.filter((t) => t.trader === 'a').length, 1, 'a 只能有一条（深度那条）');
  assert.equal(trades.find((t) => t.trader === 'a')!.sol, 5, '留下的应该是深度数据');
  assert.equal(trades.filter((t) => t.trader === 'b').length, 1, '没被深度覆盖的地址仍用窗口数据');
});

test('深度模式覆盖的地址：成本来自完整历史，行上标 deep', () => {
  const r = analyzeSellPressure(
    input({
      // 窗口里只看到它买了 100 枚（缺口期间的买入看不到）
      trades: [{ trader: 'whale', side: 'buy', sol: 1, tokenAmount: 100, ts: NOW - 300 }],
      // 深度历史告诉我们在缺口里它还买了 900 枚
      deepTrades: [
        { trader: 'whale', side: 'buy', sol: 1, tokenAmount: 100, ts: NOW - 300 },
        { trader: 'whale', side: 'buy', sol: 18, tokenAmount: 900, ts: NOW - 200 },
        // 现价锚（0.001）：whale 的真实成本 0.019 远高于它 → 浮亏
        { trader: 'pricer', side: 'buy', sol: 0.1, tokenAmount: 100, ts: NOW - 60 },
      ],
      deepAddresses: 2,
      circulatingTokens: 100_000,
    }),
  );
  const m = info(r);
  assert.equal(m.deepWallets, 2);
  assert.equal(m.deepAddresses, 2);
  assert.ok(
    m.buckets.some((b) => b.wallets > 0),
    'whale 必须被计入某个盈亏分桶（它是浮亏，不在「浮盈持仓」名单里）',
  );
  assert.ok(
    r.findings.some((f) => f.title.includes('完整历史')),
    '必须有一条 finding 说明有多少钱包用上了真实成本',
  );
  // 关键：真实成本用的是完整 1000 枚，不是窗口里的 100 枚。
  // 合计 = whale 1000 枚 + 定价锚 pricer 100 枚 = 1100。
  assert.equal(m.totalUnsoldTokens, 1100, 'whale 必须按完整历史的 1000 枚计入，不是窗口的 100 枚');
  assert.ok(
    Math.abs(m.totalCostSol - 19.1) < 1e-9,
    `成本合计应为 19.1 SOL（whale 1+18，pricer 0.1），实际 ${m.totalCostSol}`,
  );
});

test('【回归】现价必须从**合并后**的成交反推（深度数据里有更新的成交）', () => {
  // 只用窗口成交会拿到一个陈旧价格：这里窗口最新成交是 300 天前（0.01），
  // 而深度数据里 1 分钟前有一笔 0.001 —— 现价必须取后者。
  const r = analyzeSellPressure(
    input({
      trades: [{ trader: 'a', side: 'buy', sol: 1, tokenAmount: 100, ts: NOW - 300 * DAY }],
      deepTrades: [
        { trader: 'a', side: 'buy', sol: 1, tokenAmount: 100, ts: NOW - 300 * DAY },
        { trader: 'fresh', side: 'buy', sol: 0.1, tokenAmount: 100, ts: NOW - 60 },
      ],
      deepAddresses: 2,
      circulatingTokens: 100_000,
    }),
  );
  const m = info(r);
  assert.ok(Math.abs((m.priceSol ?? 0) - 0.001) < 1e-9, `现价应为 0.001，实际 ${m.priceSol}`);
});

test('没有深度数据时行为不变（不能因为加了新路径就改变旧口径）', () => {
  const r = analyzeSellPressure(
    input({
      trades: [
        { trader: 'a', side: 'buy', sol: 1, tokenAmount: 1000, ts: NOW - 100 },
        // 现价锚：a 的成本 0.001，现价 0.002 → 浮盈
        { trader: 'pricer', side: 'buy', sol: 0.2, tokenAmount: 100, ts: NOW - 60 },
      ],
      circulatingTokens: 100_000,
    }),
  );
  const m = info(r);
  assert.equal(m.deepWallets, 0);
  assert.equal(m.deepAddresses, 0);
  assert.equal(m.topHoldersAtProfit.find((x) => x.address === 'a')!.source, 'window');
  assert.ok(!r.findings.some((f) => f.title.includes('完整历史')));
});
