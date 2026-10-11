/**
 * 结论本地化的测试。
 *
 * 重点是**回退行为**：迁移过程中会有一段时间「部分结论有译文、部分没有」，
 * 这时绝不能出现空文案 —— 页面上悄悄少一句话，谁都不会注意到。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { localizeFinding } from './finding.ts';
import type { Finding } from '../core/types.ts';

/** 假的 t()：模拟真实实现的「缺 key 返回 key 本身」 */
function makeT(dict: Record<string, string>) {
  return (key: string, params?: Record<string, string | number>) => {
    const raw = dict[key];
    if (raw === undefined) return key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (w, name: string) =>
      params[name] === undefined ? w : String(params[name]),
    );
  };
}

const base: Finding = {
  severity: 'high',
  id: 'holders.top10Danger',
  title: '中文标题',
  detail: '中文详情',
  params: { pct: 38.2, threshold: 25 },
};

test('有译文时用译文，并正确插值参数', () => {
  const t = makeT({
    'findings.holders.top10Danger': 'Top10 holds {pct}% of float (limit {threshold}%)',
    'findings.holders.top10Danger.detail': 'A few addresses can dump.',
  });
  const out = localizeFinding(base, t);
  assert.equal(out.title, 'Top10 holds 38.2% of float (limit 25%)');
  assert.equal(out.detail, 'A few addresses can dump.');
  assert.equal(out.severity, 'high');
});

test('【回退】没有译文时用分析器给的中文，绝不留空', () => {
  const t = makeT({});
  const out = localizeFinding(base, t);
  assert.equal(out.title, '中文标题');
  assert.equal(out.detail, '中文详情');
});

test('【回退】只有标题有译文、详情没有 —— 两者各自独立回退', () => {
  const t = makeT({ 'findings.holders.top10Danger': 'Top10 is concentrated' });
  const out = localizeFinding(base, t);
  assert.equal(out.title, 'Top10 is concentrated');
  assert.equal(out.detail, '中文详情', '详情缺译文时必须回退到中文，而不是显示 key');
});

test('保留 veto 标记（一票判死不能被本地化过程丢掉）', () => {
  const t = makeT({});
  const out = localizeFinding({ ...base, veto: true }, t);
  assert.equal(out.veto, true);
});

test('缺参数时保留占位符可见，而不是渲染成 undefined', () => {
  const t = makeT({ 'findings.holders.top10Danger': 'Limit is {threshold}%' });
  const out = localizeFinding({ ...base, params: {} }, t);
  assert.equal(out.title, 'Limit is {threshold}%', '缺参数应显式可见，便于发现漏传');
});

test('【防漏】派生的可选后缀占位符必须被本地化层填充，不能裸露', () => {
  // 这些后缀自带前置标点，空值时必须整体消失（不能留下孤立的逗号/括号）
  const t = (key: string, params?: Record<string, string | number>) => {
    const dict: Record<string, string> = {
      'findings.contract.lpLockedByLocker': 'Held by {locker}{unlockAtText}{lockPctText}',
      'findings.contract.lpBurned': 'Burned ({lockPct}).{auditTextTail}',
    };
    const raw = dict[key];
    if (raw === undefined) return key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (w, n: string) =>
      params[n] === undefined ? w : String(params[n]),
    );
  };

  // 没有任何可选值时：后缀必须消失，且不留标点
  const bare = localizeFinding(
    { severity: 'good', id: 'contract.lpLockedByLocker', title: 'x', detail: 'y', params: { locker: 'ABC' } },
    t,
  );
  assert.equal(bare.title, 'Held by ABC');
  assert.ok(!bare.title.includes('{'), '不得出现裸露占位符');

  // 有值时：连标点一起出现
  const full = localizeFinding(
    {
      severity: 'good',
      id: 'contract.lpLockedByLocker',
      title: 'x',
      detail: 'y',
      params: { locker: 'ABC', firstUnlockAt: '2026-10-01', lockerPct: '72%' },
    },
    t,
  );
  assert.equal(full.title, 'Held by ABC，锁定至 2026-10-01（72%）');
});

test('【防漏】派生值不得覆盖分析器显式给的 params', () => {
  // 分析器如果自己传了 auditTextTail，派生层不能把它盖掉
  const t = makeT({ 'findings.contract.lpBurned': 'Burned.{auditTextTail}' });
  const out = localizeFinding(
    {
      severity: 'good',
      id: 'contract.lpBurned',
      title: 'x',
      detail: 'y',
      params: { auditTextTail: ' 已通过审计。' },
    },
    t,
  );
  assert.equal(out.title, 'Burned. 已通过审计。');
});
