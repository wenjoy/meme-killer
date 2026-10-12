/**
 * 埋点存储 —— 本地 SQLite。
 *
 * ── 设计原则 ─────────────────────────────────────────────────────
 *
 * 1. **埋点绝不能拖慢或搞挂主流程。**
 *    所有写入都是「尽力而为」：出错只记日志，不抛给调用方。
 *    一个统计功能让扫描失败是不可接受的 —— 埋点是副产品，不是主业务。
 *
 * 2. **钱包地址默认哈希存储。**
 *    我们只关心「有多少独立用户、回访几次」，不需要知道他们是谁。
 *    用 HMAC-SHA256（带服务端密钥）而不是裸 SHA256 ——
 *    因为 Solana 地址空间有限且全是公开的，裸哈希可以被人拿全量地址表反查。
 *    哈希后仍然能精确算 UV（同地址同哈希），但无法反推地址。
 *    ⚠️ 代币地址（mint）存原文：链上本来就公开，且「哪些币被查过」
 *    是这个工具最核心的分析价值。
 *
 * 3. **同步写入（better-sqlite3 是同步 API）。**
 *    单条 insert 在本地文件上是微秒级，比异步排队的复杂度更划算。
 *    如果以后写入量大了（每秒上千），再改成批量提交。
 *
 * 4. **表结构用「宽表 + JSON 详情」，不做过早规范化。**
 *    埋点是探索性分析，字段还会变。`meta` 存 JSON 可以随时加字段
 *    而不需要迁移；核心维度（时间、钱包、mint、事件类型）才建索引。
 */
import Database from 'better-sqlite3';
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 事件类型 —— 用联合类型而不是 string，避免写错事件名（写错会静默丢失数据） */
export type EventName =
  // ── 扫描行为 ──
  | 'scan_start'
  | 'scan_ok'
  | 'scan_fail'
  | 'scan_rate_limited'
  // ── 功能使用 ──
  | 'tab_view'
  | 'deep_start'
  | 'deep_ok'
  | 'deep_fail'
  | 'holders_load'
  | 'csv_export'
  | 'lang_switch'
  // ── 用户维度 ──
  | 'wallet_connect'
  | 'wallet_sign_ok'
  | 'wallet_sign_fail'
  | 'page_view'
  // ── 异常 ──
  | 'auth_rejected';

export interface EventInput {
  name: EventName;
  /** 钱包地址原文 —— 入库前会哈希 */
  wallet?: string | null;
  /** 代币地址，存原文 */
  mint?: string | null;
  locale?: string | null;
  /** 任意附加字段，存 JSON */
  meta?: Record<string, unknown>;
}

/** 数据库路径：可用 ANALYTICS_DB 覆盖（测试用 :memory:） */
function dbPath(): string {
  if (process.env.ANALYTICS_DB) return process.env.ANALYTICS_DB;
  return resolve(process.cwd(), 'data', 'analytics.db');
}

let db: Database.Database | null = null;

function secret(): string {
  // 复用 AUTH_SECRET：已经有一个服务端密钥，没必要引入第二个
  return process.env.AUTH_SECRET ?? 'mk-analytics-dev-secret';
}

/** 钱包地址 -> 稳定匿名 ID。同一地址永远得到同一个值，但无法反推。 */
export function anonWallet(wallet: string): string {
  return createHmac('sha256', secret()).update(wallet).digest('hex').slice(0, 32);
}

function open(): Database.Database | null {
  if (db) return db;
  try {
    const path = dbPath();
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    db = new Database(path);
    // WAL：读写并发更好，且崩溃后不易损坏
    if (path !== ':memory:') db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        ts      INTEGER NOT NULL,          -- 毫秒时间戳
        day     TEXT    NOT NULL,          -- YYYY-MM-DD（本地日，便于按天聚合）
        name    TEXT    NOT NULL,
        wallet  TEXT,                      -- 匿名哈希，不是原文
        mint    TEXT,
        locale  TEXT,
        meta    TEXT                       -- JSON
      );
      -- 索引按实际查询模式建：按天聚合、按事件名筛、按 mint 排行、按钱包算 UV
      CREATE INDEX IF NOT EXISTS idx_events_day    ON events(day);
      CREATE INDEX IF NOT EXISTS idx_events_name   ON events(name, day);
      CREATE INDEX IF NOT EXISTS idx_events_mint   ON events(mint);
      CREATE INDEX IF NOT EXISTS idx_events_wallet ON events(wallet);
    `);
    return db;
  } catch (e) {
    // 打不开就算了 —— 埋点坏了不能让站点坏
    console.error('[analytics] 无法打开数据库，埋点已禁用：', e);
    return null;
  }
}

/** 本地日期 YYYY-MM-DD。用本地时区而不是 UTC —— 看报表的人按自己的日子理解「今天」。 */
export function localDay(ts: number = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let insertStmt: Database.Statement | null = null;

/**
 * 记录一个事件。**永不抛异常**。
 *
 * 调用方不需要 try/catch —— 这是刻意的：埋点的失败不应该
 * 让调用方多写一行防御代码，更不应该影响主流程。
 */
export function track(e: EventInput): void {
  try {
    const database = open();
    if (!database) return;
    insertStmt ??= database.prepare(
      `INSERT INTO events (ts, day, name, wallet, mint, locale, meta)
       VALUES (@ts, @day, @name, @wallet, @mint, @locale, @meta)`,
    );
    const ts = Date.now();
    insertStmt.run({
      ts,
      day: localDay(ts),
      name: e.name,
      wallet: e.wallet ? anonWallet(e.wallet) : null,
      mint: e.mint ?? null,
      locale: e.locale ?? null,
      meta: e.meta ? JSON.stringify(e.meta) : null,
    });
  } catch (err) {
    console.error('[analytics] 写入失败（已忽略）：', err);
  }
}

/** 测试用：拿原始 db 句柄与重置 */
export function __db(): Database.Database | null {
  return open();
}
export function __close(): void {
  db?.close();
  db = null;
  insertStmt = null;
}
