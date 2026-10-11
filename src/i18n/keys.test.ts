/**
 * 字典结构测试 —— 防止「key 写错层级」导致的字面 key 泄漏到界面。
 *
 * ── 这个测试为什么必须有 ──────────────────────────────────────────
 * 真实事故：holderKinds 的短名被写成**扁平带点**的 key：
 *
 *   holderKinds: { pool: '流动性池', 'pool.short': '池' }
 *
 * 看起来对，但 lookup() 是按 `.` 分层的，`holderKinds.pool.short` 会被
 * 解析成 holderKinds → pool → short；而 pool 是个字符串，下钻失败。
 * 结果是页面上直接显示出 `report.common.holderKinds.pool.short` 这串字。
 *
 * 而且它**不报错**：缺 key 时 t() 返回 key 本身（刻意的设计，为了让漏译
 * 显眼），所以类型检查、构建、其它测试全部通过。
 *
 * 所以这里做两件事：
 * 1. 任何 key 里含 `.` 的（扁平带点写法）一律禁止 —— 必须写成嵌套。
 * 2. 界面上会用到的关键路径必须能查到，且值与中文不同（英文真的翻了）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { zh } from './messages/zh.ts';
import { en } from './messages/en.ts';
import { HOLDER_KIND_LABELS } from '../core/constants.ts';

/**
 * 允许「扁平带点」的命名空间。
 *
 * 这三个是**刻意的**扁平 Record：key 自带全前缀，lookup() 有专门分支
 * 从首段对象里按整条 key 取。所以它们豁免。
 * （findings = 分析器结论，warnings = 采集告警，pieces = 组合句片段）
 */
const FLAT_NAMESPACES = new Set(['findings', 'pieces', 'warnings']);

/** 递归收集「字符串 key 里带点」的违规项（跳过豁免命名空间） */
function flatDottedKeys(obj: unknown, path = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [];
  const bad: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    // 豁免可以出现在任意层级（pieces 挂在 report 下面）
    if (FLAT_NAMESPACES.has(k)) continue;
    if (k.includes('.')) bad.push(`${path}${k}`);
    else bad.push(...flatDottedKeys(v, `${path}${k}.`));
  }
  return bad;
}

test('字典里不得出现「扁平带点」的 key（必须写成嵌套对象）', () => {
  assert.deepEqual(flatDottedKeys(zh as never), [], 'zh.ts 有扁平带点的 key');
  assert.deepEqual(flatDottedKeys(en as never), [], 'en.ts 有扁平带点的 key');
});

test('每个 holder kind 的长名与短名都能查到（英文且确实翻了）', () => {
  for (const kind of Object.keys(HOLDER_KIND_LABELS)) {
    const longKey = `report.common.holderKinds.${kind}`;
    const shortKey = `report.common.holderKinds.short.${kind}`;
    // 用一个最小的 lookup 复刻实现的三条路径
    const get = (dict: unknown, key: string): unknown => {
      let cur: unknown = dict;
      for (const p of key.split('.')) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[p];
      }
      return cur;
    };
    const enLong = get(en, longKey);
    const enShort = get(en, shortKey);
    const zhLong = get(zh, longKey);
    assert.equal(typeof enLong, 'string', `${longKey} 查不到 —— 界面上会显示这串 key`);
    assert.equal(typeof enShort, 'string', `${shortKey} 查不到 —— 窄列会显示这串 key`);
    assert.notEqual(enLong, zhLong, `${longKey} 的英文与中文相同，疑似漏译`);
  }
});

test('【防串语言】中文字典里不得出现成串英文界面词', async () => {
  // 真实事故：pieces.zh.ts 的 poolLabels 被从 en 复制过来，
  // 于是中文界面显示 'pump.fun bonding curve'、'observed pool'。
  // 「能查到」类测试查不出这个 —— 它能查到，只是语言错了。
  const { piecesZh } = await import('./messages/pieces.zh.ts');
  const { piecesEn } = await import('./messages/pieces.en.ts');

  // 允许出现英文的情形：专有名词/品牌/缩写/地址/单位
  const ALLOWED = /^(?:RugCheck|DexScreener|PumpSwap|Meteora DLMM|Raydium|Orca Whirlpool|pump\.fun|SOL|LP|ATA|UTC|HTTP|PDA|DAS|Helius|Jupiter Lock|Squads)/i;

  for (const k of Object.keys(piecesZh) as string[]) {
    const zhV = (piecesZh as Record<string, string>)[k];
    const enV = (piecesEn as Record<string, string>)[k];
    if (zhV === undefined || enV === undefined) continue;
    // 纯 ASCII 且与英文完全相同 → 极可能是漏改（而不是「专有名词就该一样」）
    //
    // 例外：完全由占位符/标点/单位组成的「数据模板」（如 `{sol} SOL @ {time}`）——
    // 它没有任何自然语言，两边本就该一样。
    // 去掉占位符、标点与**单位词**后应当什么都不剩（"SOL" 这类是单位，不是文案）
    const stripped = zhV
      .replace(/\{\w+\}/g, '')
      .replace(/\b(?:SOL|USD|LP|ATA|UTC|PDA|DAS|HTTP)\b/g, '')
      .replace(/[\s@%\-–—,.:;()[\]/]/g, '');
    const isPureDataTemplate = stripped.length === 0;
    if (isPureDataTemplate) continue;
    if (/^[\x20-\x7E]+$/.test(zhV) && zhV === enV && !ALLOWED.test(zhV)) {
      assert.fail(`pieces.zh.ts 的 ${k} 与英文完全相同（"${zhV}"）—— 疑似从 en 复制后忘改`);
    }
  }
});
