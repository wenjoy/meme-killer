/**
 * 全量持有人枚举的聚合逻辑测试。
 *
 * 这里锁的都是**会算错就会误导**的地方：
 * owner 合并（一个人多个账户）、零余额账户（不等于持有人）、
 * 剔除池/锁仓后再算曲线、以及「含池锁仓」与「剔除后」两条口径必须都在。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateOwners,
  buildBuckets,
  buildCurve,
  buildHolderOverview,
  ownersFor,
  type OverviewContext,
  type RawTokenAccount,
} from './holderList.ts';
import { BURN_ADDRESSES } from '../core/constants.ts';

const DECIMALS = 6;
const SUPPLY_UI = 1_000; // 1000 枚（UI 单位）
const raw = (ui: number) => BigInt(Math.round(ui * 10 ** DECIMALS));

function ctx(over: Partial<OverviewContext> = {}): OverviewContext {
  return {
    decimals: DECIMALS,
    supplyUi: SUPPLY_UI,
    knownHolders: [],
    poolAddresses: [],
    ...over,
  };
}

function acc(owner: string, ui: number, account = `ata-${owner}-${ui}`): RawTokenAccount {
  return { account, owner, amount: raw(ui) };
}

test('同一个人多个账户要合并成一个持有人', () => {
  const owners = aggregateOwners(
    [acc('alice', 100, 'a1'), acc('alice', 50, 'a2'), acc('bob', 10)],
    ctx(),
  );
  assert.equal(owners.length, 2, '两个地址 → 两个持有人');
  const alice = owners.find((o) => o.owner === 'alice')!;
  assert.equal(alice.amount, 150);
  assert.equal(alice.accounts, 2, '名下账户数要如实记录');
  assert.equal(alice.pct, 15);
});

test('零余额账户仍算账户，但不算有余额的持有人', () => {
  const enumeration = {
    source: 'rpc' as const,
    truncated: false,
    warnings: [],
    accounts: [acc('alice', 100), acc('emptied', 0)],
  };
  const { overview } = buildHolderOverview(enumeration, ctx());
  assert.equal(overview.accountsTotal, 2);
  assert.equal(overview.accountsWithBalance, 1);
  assert.equal(overview.ownersTotal, 2);
  assert.equal(overview.ownersWithBalance, 1, '清空账户不是持有人');
});

test('池与锁仓要从流通盘里剔除，两条曲线的分母不同', () => {
  const ctx2 = ctx({
    // 池持有 50%，普通持有人分掉剩下的 40%（还有 10% 没枚举到）
    poolAddresses: ['poolowner'],
  });
  const enumeration = {
    source: 'rpc' as const,
    truncated: false,
    warnings: [],
    accounts: [
      acc('poolowner', 500),
      ...Array.from({ length: 10 }, (_, i) => acc(`holder${i}`, 40)),
    ],
  };
  const { overview } = buildHolderOverview(enumeration, ctx2);
  assert.equal(overview.circulatingOwners, 10, '池不算持有人');
  assert.ok(Math.abs(overview.excludedPct - 50) < 1e-9, `剔除项应为 50%，实际 ${overview.excludedPct}`);
  assert.ok(Math.abs(overview.coveredPct - 90) < 1e-9, '枚举到的持仓合计 90%');

  const top10 = overview.curve.find((c) => c.top === 10)!;
  // 含池锁仓的 Top10 = 池 50% + 9 个散户 × 4% = 86%
  assert.ok(Math.abs(top10.cumPctAll - 86) < 1e-9, `含池锁仓 Top10 是 86%，实际 ${top10.cumPctAll}`);
  // 剔除后只剩 10 个散户，Top10 就是全部流通盘 = 100%
  assert.ok(
    Math.abs(top10.cumPctCirculating - 100) < 1e-9,
    `剔除后 10 个持有人分掉全部流通盘 = 100%，实际 ${top10.cumPctCirculating}`,
  );
  // 剔除后只剩散户：Top10 就是 10 个散户 × 4% = 40%（占总供应）
  assert.ok(
    Math.abs(top10.cumPctCounted - 40) < 1e-9,
    `剔除后占总供应是 40%，实际 ${top10.cumPctCounted}`,
  );
  assert.ok(
    top10.cumPctCirculating > top10.cumPctCounted,
    '换成分母=流通盘后，同一个 Top10 的占比必须更大',
  );
});

test('达到 50% / 80% 的持有人数只按流通盘算', () => {
  const owners = aggregateOwners(
    [acc('whale', 400), ...Array.from({ length: 10 }, (_, i) => acc(`h${i}`, 20))],
    ctx({ supplyUi: 600 }),
  );
  // 流通盘 600：whale 400（66.7%）→ 1 个人就到 50%；到 80% 需要 whale + 4 个 20（480/600=80%）
  assert.equal(ownersFor(owners, 50), 1);
  assert.equal(ownersFor(owners, 80), 5);
});

test('分桶覆盖全部持有人，且合计等于总量占比', () => {
  const owners = aggregateOwners(
    [acc('a', 100), acc('b', 10), acc('c', 1), acc('d', 0.0001)],
    ctx({ supplyUi: 1000 }),
  );
  const buckets = buildBuckets(owners);
  assert.equal(
    buckets.reduce((s, b) => s + b.owners, 0),
    owners.length,
    '每个持有人必须落进恰好一个桶',
  );
  const sum = buckets.reduce((s, b) => s + b.pct, 0);
  const expect = owners.reduce((s, o) => s + o.pct, 0);
  assert.ok(Math.abs(sum - expect) < 1e-9, '分桶合计必须等于持仓合计');
});

test('曲线必须同时给两条口径，且累计单调不减', () => {
  const owners = aggregateOwners(
    [
      acc('pool', 500),
      ...Array.from({ length: 1000 }, (_, i) => acc(`h${i}`, 0.4)),
    ],
    ctx({ poolAddresses: ['pool'] }),
  );
  const curve = buildCurve(owners);
  assert.ok(curve.length >= 2, '至少要能给出两个点（Top10、Top50…）');
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].cumPctAll >= curve[i - 1].cumPctAll, '累计不能回落');
    assert.ok(curve[i].cumPctCounted >= curve[i - 1].cumPctCounted, '累计不能回落');
    assert.ok(curve[i].cumPctCirculating >= curve[i - 1].cumPctCirculating, '累计不能回落');
  }
  const top10 = curve.find((c) => c.top === 10)!;
  assert.ok(top10.cumPctAll > top10.cumPctCounted, '含池锁仓的口径必须更大 —— 这正是那个 84% vs 8% 的差别');
});

test('burn 地址被识别为销毁，不算流通持有人', () => {
  const burn = [...BURN_ADDRESSES][0];
  const owners = aggregateOwners([acc(burn, 100), acc('real', 50)], ctx({ supplyUi: 150 }));
  const b = owners.find((o) => o.owner === burn)!;
  assert.equal(b.kind, 'burn');
  assert.equal(b.counted, false);
  assert.equal(ownersFor(owners, 100), 1, '只剩 real 一个流通持有人');
});

test('DAS 兜底与未取全的状态要如实带出来', () => {
  const { overview } = buildHolderOverview(
    { source: 'das', truncated: true, warnings: ['达到上限'], accounts: [acc('a', 100)] },
    ctx(),
    { reportedHolders: 50_000 },
  );
  assert.equal(overview.source, 'das');
  assert.equal(overview.truncated, true, '未取全必须标出来，不能假装是全量');
  assert.equal(overview.reportedHolders, 50_000, '口径对照要保留 RugCheck 的数字');
});
