/**
 * 埋点存储测试。
 *
 * 重点不是「能写进去」，而是：
 * - 钱包地址**不能**以原文入库（隐私）
 * - 同一地址必须得到同一个匿名 ID（否则 UV 算不准）
 * - 埋点失败**不能**影响调用方（可用性）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANALYTICS_DB = ':memory:';
process.env.AUTH_SECRET = 'test-secret-for-analytics';

const { __db, __close, anonWallet, localDay, track } = await import('./store.ts');

function rows(sql: string, ...args: unknown[]): Record<string, unknown>[] {
  return __db()!.prepare(sql).all(...args) as Record<string, unknown>[];
}

test('事件能写入并读回', () => {
  __close();
  track({ name: 'scan_ok', mint: 'MintAAA', locale: 'zh', meta: { ms: 1234, score: 34.9 } });
  const r = rows('SELECT * FROM events WHERE name = ?', 'scan_ok');
  assert.equal(r.length, 1);
  assert.equal(r[0].mint, 'MintAAA');
  assert.equal(r[0].locale, 'zh');
  assert.deepEqual(JSON.parse(r[0].meta as string), { ms: 1234, score: 34.9 });
});

test('【隐私】钱包地址不得以原文入库', () => {
  __close();
  const wallet = '9raUVuzeWUk53co63M4WXLWPWE4Xc6Lpn7RS9dnkpump';
  track({ name: 'wallet_sign_ok', wallet });
  const r = rows('SELECT wallet FROM events WHERE name = ?', 'wallet_sign_ok');
  assert.equal(r.length, 1);
  assert.notEqual(r[0].wallet, wallet, '⚠️ 地址原文进库了 —— 这是隐私泄漏');
  // 也不能是裸 SHA256（地址空间小且全公开，裸哈希可被反查）
  assert.equal(String(r[0].wallet).length, 32);
});

test('同一地址得到同一个匿名 ID（否则 UV 会算成两个用户）', () => {
  const w = 'SomeWalletAddress1234567890abcdefghij';
  assert.equal(anonWallet(w), anonWallet(w));
  assert.notEqual(anonWallet(w), anonWallet(w + 'x'));
});

test('不同地址得到不同匿名 ID', () => {
  assert.notEqual(anonWallet('AAA'), anonWallet('BBB'));
});

test('day 字段是按本地日的 YYYY-MM-DD', () => {
  __close();
  track({ name: 'page_view' });
  const r = rows(`SELECT day FROM events WHERE name='page_view'`);
  assert.match(String(r[0].day), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r[0].day, localDay());
});

test('【可用性】埋点写入失败不得抛异常给调用方', () => {
  __close();
  // 故意传一个无法序列化的 meta（循环引用）
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.doesNotThrow(() => {
    track({ name: 'scan_start', meta: circular });
  }, '埋点失败必须被吞掉 —— 不能让它搞挂扫描');
});

test('按天与事件名聚合的查询可用（stats 脚本依赖这些模式）', () => {
  __close();
  track({ name: 'page_view' });
  track({ name: 'page_view' });
  track({ name: 'scan_ok', mint: 'M1' });
  const byName = rows(`SELECT name, COUNT(*) c FROM events GROUP BY name ORDER BY name`);
  const map = Object.fromEntries(byName.map((r) => [r.name, r.c]));
  assert.equal(map.page_view, 2);
  assert.equal(map.scan_ok, 1);

  const byDay = rows(`SELECT day, COUNT(*) c FROM events GROUP BY day`);
  assert.equal(byDay.length, 1, '同一天的事件应聚合成一行');
  assert.equal(byDay[0].c, 3);
});

test('mint 用于排行，不同代币分开计数', () => {
  __close();
  track({ name: 'scan_ok', mint: 'AAA' });
  track({ name: 'scan_ok', mint: 'AAA' });
  track({ name: 'scan_ok', mint: 'BBB' });
  const r = rows(
    `SELECT mint, COUNT(*) c FROM events WHERE mint IS NOT NULL GROUP BY mint ORDER BY c DESC`,
  );
  assert.equal(r[0].mint, 'AAA');
  assert.equal(r[0].c, 2);
  assert.equal(r[1].mint, 'BBB');
});

test('JSON 字段可被 json_extract 查询（tab 分布依赖它）', () => {
  __close();
  track({ name: 'tab_view', meta: { tab: 'holders' } });
  track({ name: 'tab_view', meta: { tab: 'holders' } });
  track({ name: 'tab_view', meta: { tab: 'overview' } });
  const r = rows(
    `SELECT json_extract(meta,'$.tab') tab, COUNT(*) c FROM events
     WHERE name='tab_view' GROUP BY tab ORDER BY c DESC`,
  );
  assert.equal(r[0].tab, 'holders');
  assert.equal(r[0].c, 2);
});
