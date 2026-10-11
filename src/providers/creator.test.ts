/**
 * 部署者三级来源的解析顺序测试。
 *
 * 这个顺序错了，整个「开发者历史」维度都在追错人 —— 实测 `9raUVuze…pump`
 * 上创建交易付款方（4JBz4tAK…）与曲线里的 creator（Fpi4NERk…）完全不同。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCreator } from './creator.ts';

test('curve 程序状态优先于 metadata 与创建交易付款方', () => {
  const r = resolveCreator({
    curveCreator: 'CurveCreator111',
    metadataCreator: 'MetadataCreator1',
    launchWallet: 'LaunchWallet111',
  });
  assert.equal(r.creator, 'CurveCreator111');
  assert.equal(r.source, 'curve');
  assert.equal(r.launchWallet, 'LaunchWallet111', '付款方不同要带出来单独展示');
  assert.ok(
    r.warnings.some((w) => w.text.includes('不是同一个地址')),
    '两者不同必须有告警，否则读者会以为 dev 就是付款方',
  );
});

test('没有 curve 时用 metadata，都没有才回退到付款方并标为推断值', () => {
  const md = resolveCreator({ metadataCreator: 'MetadataCreator1', launchWallet: 'LaunchWallet111' });
  assert.equal(md.creator, 'MetadataCreator1');
  assert.equal(md.source, 'metadata');

  const tx = resolveCreator({ launchWallet: 'LaunchWallet111' });
  assert.equal(tx.creator, 'LaunchWallet111');
  assert.equal(tx.source, 'create-tx');
  assert.ok(
    tx.warnings.some((w) => w.text.includes('推断值')),
    '用付款方推断时必须写明这是推断值',
  );
  assert.equal(tx.launchWallet, undefined, 'creator 就是付款方时不必重复展示');
});

test('三级都拿不到 → 明确未知，不编一个地址出来', () => {
  const r = resolveCreator({});
  assert.equal(r.creator, undefined);
  assert.equal(r.source, undefined);
  assert.ok(r.warnings.some((w) => w.text.includes('未能确定部署者地址')));
});

test('pump.fun 实测案例：付款方 ≠ creator，两处都要能被报告读到', () => {
  const r = resolveCreator({
    curveCreator: 'Fpi4NERkYPwCJmy9h1mC3LiLqnkvM9wCQ4o8QLVN3HYW',
    launchWallet: '4JBz4tAKgAmxjDPHHi9HRLj14RsCQJyuCkCFKnpz7B9s',
  });
  assert.equal(r.creator, 'Fpi4NERkYPwCJmy9h1mC3LiLqnkvM9wCQ4o8QLVN3HYW');
  assert.equal(r.launchWallet, '4JBz4tAKgAmxjDPHHi9HRLj14RsCQJyuCkCFKnpz7B9s');
});
