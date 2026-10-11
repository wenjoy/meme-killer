/**
 * 维度名与 UI 的对应关系测试。
 *
 * 分析器返回的 `label` 是中文（`社交热度`），UI 靠 `dimensions.<key>` 查表覆盖它。
 * 这条链路最容易出的问题是**新增了维度但忘了加译文** —— 那样英文界面上会
 * 冒出一个中文维度名，而且不会报任何错。所以在这里钉死。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { zh } from './messages/zh.ts';
import { en } from './messages/en.ts';
import { DIMENSION_ORDER } from '../core/constants.ts';

test('每个维度都有中英文名（新增维度忘了加译文会在这里失败）', () => {
  for (const key of DIMENSION_ORDER) {
    const z = (zh.dimensions as Record<string, string>)[key];
    const e = (en.dimensions as Record<string, string>)[key];
    assert.ok(z && z.length > 0, `维度 ${key} 缺中文名`);
    assert.ok(e && e.length > 0, `维度 ${key} 缺英文名`);
  }
});

test('英文维度名不得与中文相同（防止复制粘贴后忘改）', () => {
  for (const key of Object.keys(zh.dimensions)) {
    const z = (zh.dimensions as Record<string, string>)[key];
    const e = (en.dimensions as Record<string, string>)[key];
    if (z === undefined) continue;
    assert.notEqual(e, z, `维度 ${key} 的英文与中文相同`);
  }
});

test('tab key 与字典 tabs.* 一一对应', () => {
  for (const [k, v] of Object.entries(zh.tabs)) {
    assert.ok(v.length > 0, `tab ${k} 缺中文`);
    assert.ok((en.tabs as Record<string, string>)[k], `tab ${k} 缺英文`);
  }
});
