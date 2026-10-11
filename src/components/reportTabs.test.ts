/**
 * 报告分区约定的测试。
 *
 * 这些不是「渲染对不对」的测试，而是**约定**的测试：分页最容易犯的错是
 * 把某块内容不小心漏掉（谁都没注意就消失了）或者把关键结论藏进默认不可见的页。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ALWAYS_VISIBLE, DEFAULT_TAB, REPORT_TABS, tabForSection } from './reportTabs.ts';

test('默认 tab 必须是概览 —— 打开就看到雷达图与六维得分', () => {
  assert.equal(DEFAULT_TAB, 'overview');
  assert.equal(REPORT_TABS[0].key, 'overview', '概览应排在第一个');
});

test('tab 的 key 唯一，标签非空', () => {
  const keys = REPORT_TABS.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, 'key 不能重复');
  for (const t of REPORT_TABS) {
    assert.ok(t.label.length > 0, `${t.key} 缺标签`);
    assert.ok(t.sections.length > 0, `${t.key} 是空的 —— 空 tab 会让用户以为内容丢了`);
  }
});

test('【核心约定】每个区块只能属于一个 tab，不能重复出现', () => {
  const seen = new Map<string, string>();
  for (const t of REPORT_TABS) {
    for (const s of t.sections) {
      const prev = seen.get(s);
      assert.equal(prev, undefined, `「${s}」同时出现在 ${prev} 与 ${t.key}`);
      seen.set(s, t.key);
    }
  }
});

test('【核心约定】结论与硬否决必须常驻，不能被分页藏起来', () => {
  // 一票判死的结论如果默认不可见，等于没显示
  assert.ok(
    ALWAYS_VISIBLE.some((s) => s.includes('硬否决')),
    '硬否决必须列在常驻内容里',
  );
  assert.ok(
    ALWAYS_VISIBLE.some((s) => s.includes('建议仓位')),
    '建议仓位是用户最需要一眼看到的结论，必须常驻',
  );
  // 反过来：常驻内容不该同时出现在某个 tab 的区块列表里
  for (const t of REPORT_TABS) {
    for (const s of t.sections) {
      assert.ok(
        !ALWAYS_VISIBLE.includes(s),
        `「${s}」既被标为常驻又放在 ${t.key} 里，会造成重复渲染`,
      );
    }
  }
});

test('所有既有区块都有归属（新增区块时这条会提醒你决定它放哪）', () => {
  const required = [
    '雷达图',
    'Top20 持仓表',
    '全量持币人明细',
    '全量持有人总览',
    '大额卖单明细',
    '钻石手',
    '抛压分布',
    '逐项体检明细',
    '数据来源与局限',
  ];
  for (const s of required) {
    assert.ok(tabForSection(s) !== undefined, `「${s}」没有归属的 tab —— 它会在页面上消失`);
  }
});

test('持仓相关的内容集中在「持仓」tab，行为相关集中在「持仓行为」', () => {
  assert.equal(tabForSection('Top20 持仓表'), 'holders');
  assert.equal(tabForSection('全量持币人明细'), 'holders');
  assert.equal(tabForSection('钻石手'), 'behavior');
  assert.equal(tabForSection('抛压分布'), 'behavior');
  assert.equal(tabForSection('大额卖单明细'), 'flow');
});

test('未知区块返回 undefined 而不是瞎猜一个 tab', () => {
  assert.equal(tabForSection('不存在的区块'), undefined);
});

/**
 * 概览与「逐项体检明细」曾经重复显示同一批数字
 * （概览一份手写的紧凑网格，明细一份完整卡片），实测 Top10 38.22%
 * 之类同时在两处出现。两份数字将来会各自漂移 —— 改了口径只改一处，
 * 用户会看到两个互相矛盾的值。所以概览只保留得分。
 */
test('【防重复】细节数字只能出现在明细里，概览只给得分', () => {
  const overview = REPORT_TABS.find((t) => t.key === 'overview')!;
  const detailTab = tabForSection('逐项体检明细');
  assert.ok(detailTab, '明细必须有归属');

  // 概览的区块清单里不能出现「速览」这种承载细节数字的区块
  for (const s of overview.sections) {
    assert.ok(
      !s.includes('速览'),
      `概览不该再有「${s}」—— 细节数字重复会与明细里的值相互矛盾`,
    );
  }
  assert.ok(
    overview.sections.some((s) => s.includes('得分')),
    '概览应当只展示各维度得分',
  );
  assert.notEqual(detailTab, 'overview', '明细不能放在概览里');
});

test('【防重复】每个区块全局只能出现一次（分 tab 时最容易复制而不是移动）', () => {
  const counts = new Map<string, number>();
  for (const t of REPORT_TABS) {
    for (const s of t.sections) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  for (const [s, n] of counts) {
    assert.equal(n, 1, `「${s}」出现了 ${n} 次 —— 分 tab 时应移动而不是复制`);
  }
});
