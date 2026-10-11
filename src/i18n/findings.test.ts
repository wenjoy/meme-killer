/**
 * 结论字典的完整性测试。
 *
 * 这批文案是「漏译会静默上线」的典型风险点：如果某个 id 忘了写英文，
 * 英文用户看到的就会是中文（回退逻辑正常工作，所以不会报错）。
 * 所以必须有测试把「两种语言的 key 必须一一对应」这条铁律钉死。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findingsZh } from './messages/findings.zh.ts';
import { findingsEn } from './messages/findings.en.ts';

const zhKeys = Object.keys(findingsZh).sort();
const enKeys = Object.keys(findingsEn).sort();

/** 从 `findings.<维度>.<结论>` 里取结论 id */
function titleKeys(keys: string[]): string[] {
  return keys.filter((k) => !k.endsWith('.detail'));
}

test('中英文 key 集合完全一致（漏译必须失败，不能静默回退）', () => {
  const missingEn = zhKeys.filter((k) => !enKeys.includes(k));
  const extraEn = enKeys.filter((k) => !zhKeys.includes(k));
  assert.deepEqual(missingEn, [], `英文缺少这些 key：${missingEn.join(', ')}`);
  assert.deepEqual(extraEn, [], `英文多出这些 key：${extraEn.join(', ')}`);
});

test('每条结论都有标题，且标题数 = 详情数（122 条）', () => {
  const titles = titleKeys(zhKeys);
  const details = zhKeys.filter((k) => k.endsWith('.detail'));
  assert.equal(titles.length, 122, '结论标题数应为 122');
  assert.equal(details.length, 122, '结论详情数应为 122');
});

test('英文标题不得留空，也不得原样照抄中文', () => {
  for (const k of titleKeys(enKeys)) {
    const v = findingsEn[k]!;
    assert.ok(v.trim().length > 0, `${k} 的英文为空`);
    // 纯符号/缩写标题（如 "Token-2022"）允许与中文相同，其余不允许
    if (/^[\x00-\x7F]+$/.test(findingsZh[k]!)) continue;
    assert.notEqual(v, findingsZh[k], `${k} 的英文与中文完全相同，疑似漏译`);
  }
});

test('占位符在同一条结论的中英文之间必须同名', () => {
  const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of zhKeys) {
    assert.deepEqual(
      ph(findingsZh[k]!),
      ph(findingsEn[k]!),
      `${k} 的中英文占位符不一致`,
    );
  }
});

test('中文文案不得出现未替换的 ${...} 模板残留', () => {
  for (const k of zhKeys) {
    assert.ok(!findingsZh[k]!.includes('${'), `${k} 残留了模板字符串语法`);
    assert.ok(!findingsEn[k]!.includes('${'), `${k} 残留了模板字符串语法`);
  }
});
