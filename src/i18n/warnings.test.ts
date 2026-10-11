/**
 * 采集告警字典的完整性测试。
 *
 * 这批判告警的失败方式同样是**静默**的：漏译不报错，只是英文界面上出现中文。
 * 而且它比 findings 更危险 —— 告警是「数据不完整」的显式证据，
 * 少显示一条会让用户误以为数据是全的。
 *
 * 这里钉住三条：
 * 1. 中英 key 一一对应
 * 2. 占位符同名（否则英文模板里的 {reason} 会渲染不出来）
 * 3. 分析器 `warn(key, params, text)` 的 text 与 `warnings.zh.ts` 逐字一致
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { warningsZh } from './messages/warnings.zh.ts';
import { warningsEn } from './messages/warnings.en.ts';
import { piecesZh } from './messages/pieces.zh.ts';
import { piecesEn } from './messages/pieces.en.ts';

const zhKeys = Object.keys(warningsZh).sort();
const enKeys = Object.keys(warningsEn).sort();

const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('告警字典：中英 key 集合完全一致', () => {
  assert.deepEqual(zhKeys.filter((k) => !enKeys.includes(k)), [], '英文缺少这些 key');
  assert.deepEqual(enKeys.filter((k) => !zhKeys.includes(k)), [], '英文多出这些 key');
});

test('告警字典：占位符中英同名', () => {
  for (const k of zhKeys) {
    assert.deepEqual(ph(warningsZh[k]!), ph(warningsEn[k]!), `${k} 的中英文占位符不一致`);
  }
});

test('告警字典：英文不得为空，也不得照抄中文', () => {
  for (const k of enKeys) {
    assert.ok(warningsEn[k]!.trim().length > 0, `${k} 的英文为空`);
    // engine.scanFailed 只是透传 reason，属于唯一允许相同的形态
    if (k === 'warnings.engine.scanFailed') continue;
    assert.notEqual(warningsEn[k], warningsZh[k], `${k} 的英文与中文相同，疑似漏译`);
  }
});

test('组合句字典（pieces）：中英 key 集合一致且占位符同名', () => {
  const pz = Object.keys(piecesZh).sort();
  const pe = Object.keys(piecesEn).sort();
  assert.deepEqual(pz.filter((k) => !pe.includes(k)), [], '英文缺少这些 key');
  assert.deepEqual(pe.filter((k) => !pz.includes(k)), [], '英文多出这些 key');
  for (const k of pz) {
    assert.deepEqual(ph(piecesZh[k]!), ph(piecesEn[k]!), `${k} 的中英文占位符不一致`);
  }
});

/**
 * 扫描源码里所有 `warn('key', ..., text)`，取出 key 与中文 text。
 *
 * ⚠️ text 可能是多个字符串常量用 `+` 拼起来的（换行处断行）。只取第一个
 * 常量会漏掉后半句 —— 那样这个测试就形同虚设（第一版就踩了这个坑）。
 * 所以这里把 `+` 连接的连续常量全部接起来。
 *
 * 实现上刻意不用正则解析整个表达式：手写扫描更直观，也不会因为转义层数
 * 出错（正则版本踩过两次）。
 */
function collectWarnCalls(): { key: string; text: string; file: string }[] {
  const out: { key: string; text: string; file: string }[] = [];
  const files = [
    ...readdirSync('src/providers')
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => `src/providers/${f}`),
    'src/core/engine.ts',
  ];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    let i = 0;
    while ((i = src.indexOf('warn(', i)) !== -1) {
      const keyMatch = /^warn\(\s*'([^']+)'/.exec(src.slice(i, i + 200));
      if (!keyMatch) { i += 5; continue; }
      // 从 warn( 的右括号处开始，找到第 3 个顶层实参（text）
      const argsStart = i + 5;
      const args = splitTopLevelArgs(src, argsStart);
      if (args.length >= 3) {
        out.push({ key: keyMatch[1]!, text: args[2]!.trim(), file });
      }
      i += 5;
    }
  }
  return out;
}

/** 从 `(` 之后开始，按顶层逗号切分实参；返回 [start,end) 的原始文本 */
function splitTopLevelArgs(src: string, from: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = '';
  let i = from;
  let inStr: string | null = null;
  while (i < src.length) {
    const c = src[i]!;
    if (inStr) {
      cur += c;
      if (c === '\\') { cur += src[i + 1] ?? ''; i += 2; continue; }
      if (c === inStr) inStr = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; cur += c; i += 1; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break; // warn( 的收尾
      depth -= 1;
    }
    if (c === ',' && depth === 0) { args.push(cur); cur = ''; i += 1; continue; }
    cur += c;
    i += 1;
  }
  args.push(cur);
  return args;
}

/** 把 `'a' + `b`` 形式的常量拼成一句话，并把 ${...} 归一成占位符 NUL */
function joinLiterals(raw: string): string {
  return raw
    .split(/\s*\+\s*/)
    .map((part) => part.trim().slice(1, -1).replace(/\\\$/g, '$'))
    .join('')
    .replace(/\$\{[^}]*\}/g, '\u0000');
}

/**
 * text 里内嵌了模板/三元的少数调用：手写扫描器无法完美还原成一句话。
 * 这里显式列出，并对它们做「前缀必须一致」的弱断言 —— 至少保证没换措辞。
 */
const NESTED_TEXT_KEYS = new Set(['warnings.rugcheck.riskItem']);

/**
 * text 直接透传变量（而不是中文字面量）的调用：没有中文可比。
 * `engine.scanFailed` 传的是上游给的 reason，字典里就是 `{reason}`。
 * 这类只断言「字典里确实有 {reason} 占位符」，保证透传语义没丢。
 */
const PASSTHROUGH_KEYS: Record<string, string> = {
  'warnings.engine.scanFailed': 'reason',
};

test('【防漂移】分析器里的 warn() 中文必须与字典逐字一致', () => {
  const calls = collectWarnCalls();
  assert.ok(calls.length >= 50, `扫描到的 warn() 调用太少（${calls.length}），正则可能失效`);
  const problems: string[] = [];
  for (const { key, text, file } of calls) {
    const zh = warningsZh[key];
    if (zh === undefined) {
      problems.push(`${file} 的 ${key} 不在字典里`);
      continue;
    }
    const literal = joinLiterals(text);
    const target = zh.replace(/\{\w+\}/g, '\u0000');
    if (PASSTHROUGH_KEYS[key]) {
      const phName = PASSTHROUGH_KEYS[key]!;
      if (!target.includes('\u0000')) {
        problems.push(`${key}: 字典里应有 {${phName}} 占位符，实际是 ${JSON.stringify(zh)}`);
      }
      continue;
    }
    if (NESTED_TEXT_KEYS.has(key)) {
      // 取源码字面量与字典的**公共前缀**，要求至少 8 个字符一致
      let n = 0;
      while (n < literal.length && n < target.length && literal[n] === target[n]) n += 1;
      if (n < 8) {
        problems.push(`${key}: 源码与字典的前缀就对不上（只相同 ${n} 个字符）`);
      }
      continue;
    }
    if (literal !== target) {
      problems.push(`${key}:\n     源码=${JSON.stringify(literal)}\n     字典=${JSON.stringify(target)}`);
    }
  }
  assert.deepEqual(problems, [], `以下告警的中文与字典不一致：\n${problems.join('\n')}`);
});
