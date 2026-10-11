/**
 * 限流测试 —— 重点是「绕不过去」，而不只是「正常情况能限住」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __resetRateLimit, consume, peek, type RateSpec } from './rateLimit.ts';

const SPEC: RateSpec = { burst: 1, refillMs: 1000 };

test('第一次放行，紧接着的第二次被拒', () => {
  __resetRateLimit();
  assert.equal(consume('W1', 'scan', SPEC).allowed, true);
  const second = consume('W1', 'scan', SPEC);
  assert.equal(second.allowed, false, '连发第二次必须被拒 —— 这是需求的核心');
  assert.ok(second.retryAfterSec >= 1, '要告诉用户还要等多久');
});

test('不同钱包互不影响（限额按地址而不是全局）', () => {
  __resetRateLimit();
  assert.equal(consume('WA', 'scan', SPEC).allowed, true);
  // WA 用完额度不该影响 WB —— 否则一个用户能拖垮所有人
  assert.equal(consume('WB', 'scan', SPEC).allowed, true);
  assert.equal(consume('WA', 'scan', SPEC).allowed, false);
});

test('同一钱包的 scan 与 deep 额度互相独立', () => {
  __resetRateLimit();
  assert.equal(consume('W1', 'scan', SPEC).allowed, true);
  // 扫过之后仍然可以发起深度分析（两类额度分开算）
  assert.equal(consume('W1', 'deep', SPEC).allowed, true);
});

test('被拒的请求不消耗额度 —— 否则会「越试等越久」', () => {
  __resetRateLimit();
  consume('W1', 'scan', SPEC);
  // 连续被拒 5 次
  for (let i = 0; i < 5; i++) assert.equal(consume('W1', 'scan', SPEC).allowed, false);
  // 记录被拒请求的时刻，等满 refillMs 后应当恢复
  const t0 = Date.now();
  while (Date.now() - t0 < SPEC.refillMs + 30) {
    /* 忙等：这个测试要真实时间流逝 */
  }
  assert.equal(
    consume('W1', 'scan', SPEC).allowed,
    true,
    '被拒不该重置恢复进度，等够时间就要能再用',
  );
});

test('额度按时间线性恢复', () => {
  __resetRateLimit();
  consume('W1', 'scan', SPEC);
  const r = peek('W1', 'scan', SPEC);
  assert.equal(r.allowed, false);
  // 剩余等待时间不该超过一个完整周期
  assert.ok(r.retryAfterMs <= SPEC.refillMs + 50, `等待时间 ${r.retryAfterMs}ms 超过周期`);
});

test('burst > 1 时允许连发，用完后进入恢复', () => {
  __resetRateLimit();
  const spec: RateSpec = { burst: 3, refillMs: 10_000 };
  assert.equal(consume('W1', 'scan', spec).allowed, true);
  assert.equal(consume('W1', 'scan', spec).allowed, true);
  assert.equal(consume('W1', 'scan', spec).allowed, true);
  assert.equal(consume('W1', 'scan', spec).allowed, false);
});

test('从未请求过的钱包 peek 是放行状态', () => {
  __resetRateLimit();
  assert.equal(peek('NEW', 'scan', SPEC).allowed, true);
});

test('大量不同地址不会撑爆内存（含淘汰逻辑）', () => {
  __resetRateLimit();
  // 超过 MAX_BUCKETS(10000) 时触发淘汰；这里只验证不抛异常且仍能正常工作
  for (let i = 0; i < 12_000; i++) consume(`addr${i}`, 'scan', SPEC);
  // 淘汰之后仍能正常判定
  const r = consume('addr-after', 'scan', SPEC);
  assert.equal(r.allowed, true);
});
