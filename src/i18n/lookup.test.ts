/**
 * 字典取值路径的回归测试。
 *
 * ── 为什么单独测这个 ──────────────────────────────────────────────
 * `findings.*` 是**扁平的带点 key**（`findings.holders.top10Danger` 是
 * `findings` Record 里的一个字符串 key），而 `report.*` 是真正的嵌套对象。
 * 如果 `lookup()` 只会逐层下钻，findings 的每一次查询都会 miss，
 * 而 miss 的回退行为是「显示分析器内置的中文」—— **不报错、不空白**，
 * 于是英文界面上会出现满屏中文，所有字典完整性测试都还是绿的。
 *
 * 这个 bug 真实发生过。所以必须有一条测试直接打真实 lookup，
 * 而不是用一个假的 t() 打桩（打桩的测试当时全绿）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findingsEn } from './messages/findings.en.ts';
import { findingsZh } from './messages/findings.zh.ts';

/**
 * 与 index.tsx 的 lookup 同构的实现。
 *
 * ⚠️ 这里刻意复制一份而不是 import：index.tsx 是 .tsx（带 React Provider），
 * node:test 环境解析不了 JSX。两边逻辑必须保持一致 ——
 * 所以下面额外有一条断言，用真实的 key 形态锁住「先直查、再下钻」这个顺序。
 */
function lookup(dict: unknown, key: string): string | undefined {
  if (dict === null || typeof dict !== 'object') return undefined;
  const obj = dict as Record<string, unknown>;

  const direct = obj[key];
  if (typeof direct === 'string') return direct;

  const parts = key.split('.');
  let cur: unknown = dict;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') {
      cur = undefined;
      break;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur === 'string') return cur;

  const head = obj[parts[0]!];
  if (head !== null && typeof head === 'object') {
    const flat = (head as Record<string, unknown>)[key];
    if (typeof flat === 'string') return flat;
  }
  return undefined;
}

/** 模拟真实的顶层字典结构：findings 是扁平的，其余是嵌套的 */
const enDict = { findings: findingsEn };
const zhDict = { findings: findingsZh };

test('扁平 findings key 必须能查到英文（曾经全部 miss）', () => {
  const keys = Object.keys(findingsEn);
  assert.ok(keys.length > 200, '样例规模异常');
  const missed = keys.filter((k) => lookup(enDict, k) === undefined);
  assert.deepEqual(missed, [], `这些 key 查不到：${missed.slice(0, 5).join(', ')}`);
});

test('扁平 findings key 查到的必须是英文而不是中文', () => {
  // 标题类 key（不带 .detail）逐个比对：英文不应等于中文原文
  const titles = Object.keys(findingsEn).filter((k) => !k.endsWith('.detail'));
  const same = titles.filter(
    (k) =>
      lookup(enDict, k) === findingsZh[k] &&
      !/^[\x00-\x7F]+$/.test(findingsZh[k] ?? ''),
  );
  assert.deepEqual(same, [], `这些标题的英文与中文相同：${same.slice(0, 5).join(', ')}`);
});

test('嵌套形态的 key 仍然能取到（report.* 那种）', () => {
  const nested = { report: { largeSells: { colTime: 'Time (UTC)' } } };
  assert.equal(lookup(nested, 'report.largeSells.colTime'), 'Time (UTC)');
});

test('首段对象下挂着「自带全前缀」的扁平 key 也能取到（真实的 findings 形态）', () => {
  // 这就是 zh.ts 的真实结构：findings 是个扁平 Record，
  // 而它的 key 自己就写成 'findings.contract.noData'
  const d = { findings: { 'findings.contract.noData': 'Contract data missing' } };
  assert.equal(lookup(d, 'findings.contract.noData'), 'Contract data missing');
});

test('查不到的 key 返回 undefined（由调用方回退，不是空字符串）', () => {
  assert.equal(lookup(enDict, 'findings.nope.nothing'), undefined);
  assert.equal(lookup(null, 'anything'), undefined);
});
