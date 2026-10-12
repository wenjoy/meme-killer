#!/usr/bin/env node
/**
 * 埋点查看脚本 —— 在终端打印汇总。
 *
 *   npm run stats            最近 7 天
 *   npm run stats -- 30      最近 30 天
 *   npm run stats -- 1       只看今天
 *
 * 直接读 SQLite，不需要启动服务。
 */
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dbPath = process.env.ANALYTICS_DB ?? resolve(process.cwd(), 'data', 'analytics.db');

if (!existsSync(dbPath)) {
  console.log(`\n还没有埋点数据（数据库不存在）：\n  ${dbPath}\n\n去网站上扫一次就会自动创建。\n`);
  process.exit(0);
}

const days = Math.max(1, Number(process.argv[2] ?? 7) || 7);
const db = new Database(dbPath, { readonly: true });

const since = Date.now() - days * 86400_000;
const p = (n) => String(n).padStart(2, '0');
const dayOf = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const sinceDay = dayOf(since);

const q = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);

/** 打印一个标题 */
const H = (s) => console.log(`\n\x1b[1m\x1b[36m${s}\x1b[0m`);
const num = (n) => `\x1b[1m${n}\x1b[0m`;

console.log(`\n\x1b[1mMeme Killer 埋点汇总\x1b[0m  最近 ${num(days)} 天（自 ${sinceDay}）`);

// ── 1. 总览 ──
const pv = one(`SELECT COUNT(*) c FROM events WHERE name='page_view' AND ts>=?`, since).c;
const uv = one(
  `SELECT COUNT(DISTINCT wallet) c FROM events WHERE wallet IS NOT NULL AND ts>=?`,
  since,
).c;
const scans = one(
  `SELECT COUNT(*) c FROM events WHERE name IN ('scan_ok','scan_fail') AND ts>=?`,
  since,
).c;
const ok = one(`SELECT COUNT(*) c FROM events WHERE name='scan_ok' AND ts>=?`, since).c;
const uniqMints = one(
  `SELECT COUNT(DISTINCT mint) c FROM events WHERE mint IS NOT NULL AND ts>=?`,
  since,
).c;
const wallets = one(
  `SELECT COUNT(DISTINCT wallet) c FROM events WHERE name='wallet_sign_ok' AND ts>=?`,
  since,
).c;

H('总览');
console.log(`  页面浏览 (PV)     ${num(pv)}`);
console.log(`  独立用户 (UV)     ${num(uv)}      ← 按匿名钱包去重`);
console.log(`  连接过钱包的人    ${num(wallets)}`);
console.log(`  扫描次数          ${num(scans)}   （成功 ${ok} / 失败 ${scans - ok}）`);
console.log(`  查过的不同代币    ${num(uniqMints)}`);

// ── 2. 每日趋势 ──
const daily = q(
  `SELECT day,
          SUM(name='page_view')  pv,
          COUNT(DISTINCT CASE WHEN wallet IS NOT NULL THEN wallet END) uv,
          SUM(name='scan_ok')    ok,
          SUM(name='scan_fail')  fail
   FROM events WHERE ts>=? GROUP BY day ORDER BY day`,
  since,
);
if (daily.length) {
  H('每日趋势');
  console.log('  日期          PV    UV   扫描成功  扫描失败');
  for (const r of daily) {
    const d = r.day.replace(/^\d\d(\d\d)-/, '$1-');
    console.log(
      `  ${d.padEnd(12)} ${String(r.pv).padStart(4)}  ${String(r.uv).padStart(4)}  ` +
        `${String(r.ok).padStart(8)}  ${String(r.fail).padStart(8)}`,
    );
  }
}

// ── 3. 扫描耗时与得分 ──
const perf = q(
  `SELECT meta FROM events WHERE name='scan_ok' AND ts>=? AND meta IS NOT NULL`,
  since,
).map((r) => { try { return JSON.parse(r.meta); } catch { return {}; } });
if (perf.length) {
  const ms = perf.map((x) => x.ms).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const scores = perf.map((x) => x.score).filter((x) => typeof x === 'number');
  H('扫描性能与结果');
  if (ms.length) {
    const at = (f) => (ms[Math.min(ms.length - 1, Math.floor(ms.length * f))] / 1000).toFixed(1);
    console.log(`  耗时 中位数 ${num(at(0.5) + 's')}   p90 ${num(at(0.9) + 's')}   最慢 ${num((ms[ms.length-1]/1000).toFixed(1) + 's')}`);
  }
  if (scores.length) {
    const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    console.log(`  风险分 平均 ${num(avg)}   最低 ${num(Math.min(...scores))}   最高 ${num(Math.max(...scores))}`);
  }
}

// ── 4. 功能使用 ──
const feats = q(
  `SELECT name, COUNT(*) c FROM events
   WHERE name IN ('tab_view','deep_start','deep_ok','holders_load','csv_export','lang_switch')
     AND ts>=?
   GROUP BY name ORDER BY c DESC`,
  since,
);
if (feats.length) {
  H('功能使用（次数）');
  const label = {
    tab_view: '切 tab', deep_start: '发起深度分析', deep_ok: '深度分析完成',
    holders_load: '加载全量持有人', csv_export: '导出 CSV', lang_switch: '切换语言',
  };
  for (const r of feats) console.log(`  ${(label[r.name] ?? r.name).padEnd(18)} ${num(r.c)}`);
}

// tab 分布单独看，因为「哪个 tab 没人看」比总数更有用
const tabs = q(
  `SELECT json_extract(meta,'$.tab') tab, COUNT(*) c FROM events
   WHERE name='tab_view' AND ts>=? GROUP BY tab ORDER BY c DESC`,
  since,
);
if (tabs.length) {
  H('Tab 浏览分布');
  const total = tabs.reduce((a, b) => a + b.c, 0);
  for (const r of tabs) {
    const pct = ((r.c / total) * 100).toFixed(0);
    const bar = '█'.repeat(Math.round((r.c / total) * 30));
    console.log(`  ${String(r.tab ?? '?').padEnd(12)} ${String(r.c).padStart(5)}  ${pct.padStart(3)}%  ${bar}`);
  }
}

// ── 5. 热门代币（这里能看出用户关心什么）──
const mints = q(
  `SELECT mint, COUNT(*) c,
          SUM(name='scan_ok') ok,
          MAX(day) last
   FROM events WHERE mint IS NOT NULL AND ts>=?
   GROUP BY mint ORDER BY c DESC LIMIT 15`,
  since,
);
if (mints.length) {
  H('被查最多的代币（前 15）');
  for (const r of mints) console.log(`  ${r.mint}  ${num(r.c)} 次   成功 ${r.ok}   最近 ${r.last}`);
}

// ── 6. 语言分布 ──
const langs = q(
  `SELECT locale, COUNT(*) c FROM events WHERE locale IS NOT NULL AND ts>=?
   GROUP BY locale ORDER BY c DESC`,
  since,
);
if (langs.length) {
  H('语言分布');
  for (const r of langs) console.log(`  ${String(r.locale).padEnd(6)} ${num(r.c)}`);
}

// ── 7. 失败原因与异常 ──
const fails = q(
  `SELECT name, json_extract(meta,'$.reason') reason, COUNT(*) c FROM events
   WHERE name IN ('scan_fail','deep_fail','wallet_sign_fail') AND ts>=?
   GROUP BY name, reason ORDER BY c DESC LIMIT 10`,
  since,
);
if (fails.length) {
  H('失败原因（前 10）');
  for (const r of fails) console.log(`  [${r.name}] ${String(r.reason ?? '—').slice(0, 70)}  ×${r.c}`);
}

const rl = one(`SELECT COUNT(*) c FROM events WHERE name='scan_rate_limited' AND ts>=?`, since).c;
const ar = one(`SELECT COUNT(*) c FROM events WHERE name='auth_rejected' AND ts>=?`, since).c;
H('安全相关');
console.log(`  被限流次数        ${num(rl)}   ${rl > 0 ? '← 有脚本刷的迹象，或用户点太急' : ''}`);
console.log(`  无凭证访问 API    ${num(ar)}   ${ar > 0 ? '← 有人在直接打接口（不是正常用户）' : '（正常）'}`);

// ── 8. 回访 ──
const ret = q(
  `SELECT wallet, COUNT(DISTINCT day) d FROM events
   WHERE wallet IS NOT NULL AND ts>=? GROUP BY wallet HAVING d > 1 ORDER BY d DESC LIMIT 5`,
  since,
);
const active = one(
  `SELECT COUNT(DISTINCT wallet) c FROM events WHERE wallet IS NOT NULL AND ts>=?`,
  since,
).c;
if (active > 0) {
  const returning = one(
    `SELECT COUNT(*) c FROM (SELECT wallet FROM events WHERE wallet IS NOT NULL AND ts>=?
       GROUP BY wallet HAVING COUNT(DISTINCT day) > 1)`,
    since,
  ).c;
  H('留存');
  console.log(`  回访用户          ${num(returning)} / ${active}  (${((returning / active) * 100).toFixed(0)}%)`);
  if (ret.length) {
    console.log('  最活跃的匿名用户（哈希前缀）:');
    for (const r of ret) console.log(`    ${r.wallet.slice(0, 12)}…  ${r.d} 天`);
  }
}

console.log('');
db.close();
