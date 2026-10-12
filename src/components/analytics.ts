'use client';

/**
 * 前端埋点。
 *
 * ── 设计要点 ─────────────────────────────────────────────────────
 *
 * 1. **永不阻塞交互。** `track()` 只是把事件推进内存队列，立刻返回。
 *    真正的网络请求由定时器批量发出 —— 不会因为埋点让按钮点下去卡一下。
 *
 * 2. **失败静默。** 埋点请求失败不重试、不提示、不报错。
 *    用户不需要知道我们在统计，更不该看到「上报失败」这种噪音。
 *
 * 3. **页面关闭也要发出去。** 用 `navigator.sendBeacon` 在
 *    `visibilitychange`/`pagehide` 时冲刷队列 —— 否则「用户看一眼就走」
 *    这类最有价值的事件全部丢失（他们正是最可能不触发定时器的）。
 *
 * 4. **不采集任何个人信息。** 只发事件名、mint 地址、语言。
 *    钱包地址由服务端从 token 解出后哈希，前端从不发送原文。
 */
import { sessionToken } from './WalletGate';

type EventName =
  | 'scan_start' | 'scan_ok' | 'scan_fail' | 'scan_rate_limited'
  | 'tab_view' | 'deep_start' | 'deep_ok' | 'deep_fail'
  | 'holders_load' | 'csv_export' | 'lang_switch'
  | 'wallet_connect' | 'wallet_sign_ok' | 'wallet_sign_fail'
  | 'page_view' | 'auth_rejected';

interface QueuedEvent {
  name: EventName;
  mint?: string;
  meta?: Record<string, unknown>;
}

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** 攒 3 秒再发：一次交互往往连着好几个事件（scan_start + tab_view） */
const FLUSH_MS = 3000;
const MAX_QUEUE = 40;

function currentLocale(): string {
  if (typeof document === 'undefined') return 'zh';
  return document.documentElement.lang?.startsWith('en') ? 'en' : 'zh';
}

function payload(events: QueuedEvent[]): string {
  return JSON.stringify({ events, locale: currentLocale() });
}

function flushNow(): void {
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  if (timer) { clearTimeout(timer); timer = null; }

  const body = payload(batch);
  const token = sessionToken();

  // sendBeacon 在页面卸载时也能发出（fetch 会被取消）
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      // ⚠️ sendBeacon 不能带自定义头（包括 authorization），
      // 所以 token 只能放在 body 里由服务端读取。
      const blob = new Blob([JSON.stringify({ ...JSON.parse(body), token })], {
        type: 'application/json',
      });
      if (navigator.sendBeacon('/api/track', blob)) return;
    } catch {
      /* 落到 fetch */
    }
  }

  void fetch('/api/track', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
    keepalive: true,
  }).catch(() => {
    /* 埋点失败静默 */
  });
}

/** 记录一个事件。同步返回，绝不阻塞。 */
export function track(name: EventName, mint?: string, meta?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  queue.push({ name, ...(mint ? { mint } : {}), ...(meta ? { meta } : {}) });
  // 队列过长立刻发，避免长时间停留的页面攒太多
  if (queue.length >= MAX_QUEUE) { flushNow(); return; }
  if (!timer) timer = setTimeout(flushNow, FLUSH_MS);
}

/** 应用启动时挂一次：页面卸载前把队列冲出去 */
export function installFlushOnExit(): void {
  if (typeof window === 'undefined') return;
  const flush = () => flushNow();
  // pagehide 比 unload 可靠（移动端 Safari 不触发 unload）
  window.addEventListener('pagehide', flush);
  // 切到后台也发：用户可能再也不回来了
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
