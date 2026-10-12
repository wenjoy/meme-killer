/**
 * 埋点上报端点。
 *
 * POST /api/track  { events: [{ name, mint?, locale?, meta? }] }
 *
 * ── 为什么前端不直接带钱包地址上来 ────────────────────────────────
 * 前端只带会话 token，服务端从 token 里解出钱包地址再哈希。
 * 这样「匿名 ID」的映射规则只存在于服务端，前端拿不到也改不了。
 *
 * ── 为什么支持批量 ───────────────────────────────────────────────
 * tab 切换之类的高频事件攒一起发，减少请求数。
 * 但批大小有上限（50），避免有人拿它当写入放大器。
 */
import { NextResponse } from 'next/server';
import { verifySession } from '@/server/walletAuth';
import { track, type EventName } from '@/server/analytics/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 允许上报的事件名白名单 —— 不在表里的一律丢弃 */
const ALLOWED = new Set<EventName>([
  'scan_start',
  'scan_ok',
  'scan_fail',
  'scan_rate_limited',
  'tab_view',
  'deep_start',
  'deep_ok',
  'deep_fail',
  'holders_load',
  'csv_export',
  'lang_switch',
  'wallet_connect',
  'wallet_sign_ok',
  'wallet_sign_fail',
  'page_view',
  'auth_rejected',
]);

const MAX_BATCH = 50;

/** meta 只接受标量，避免有人塞巨大对象进来撑爆库 */
function sanitizeMeta(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n++ >= 12) break;
    if (typeof k !== 'string' || k.length > 40) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    // 嵌套对象/数组直接丢弃 —— 埋点不需要
  }
  return Object.keys(out).length ? out : undefined;
}

export async function POST(request: Request) {
  let body: { events?: unknown; locale?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const list = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  if (!list.length) return NextResponse.json({ ok: true, stored: 0 });

  // 有 token 就关联到匿名用户，没有也照样记（page_view 等匿名事件）
  //
  // ⚠️ token 允许来自 body：`navigator.sendBeacon` **不能带自定义请求头**，
  // 而页面关闭时正是最重要的事件（「看一眼就走」的用户）。
  // 两条路都认，优先级给 header（正常请求用 header，beacon 用 body）。
  const auth = request.headers.get('authorization');
  const headerToken = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const token =
    headerToken ?? (typeof body.token === 'string' ? body.token.slice(0, 512) : null);
  const wallet = verifySession(token)?.wallet ?? null;

  const locale = typeof body.locale === 'string' ? body.locale.slice(0, 10) : null;

  let stored = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name : '';
    if (!ALLOWED.has(name as EventName)) continue;
    track({
      name: name as EventName,
      wallet,
      mint: typeof e.mint === 'string' ? e.mint.slice(0, 64) : null,
      locale,
      meta: sanitizeMeta(e.meta),
    });
    stored++;
  }

  return NextResponse.json({ ok: true, stored });
}
