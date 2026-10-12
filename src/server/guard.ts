/**
 * API 守卫 —— 「必须先连钱包，且不能刷」的统一入口。
 *
 * 三个消耗 Helius 额度的端点（/api/scan、/api/deep、/api/holders）都走这里，
 * 保证规则只有一份：漏掉任何一处都等于留了个免费后门。
 *
 * ── 检查顺序（有讲究）────────────────────────────────────────────
 *
 * 1. **验签**（这是谁）—— 失败直接 401，不消耗任何额度。
 * 2. **限流**（他能做吗）—— 失败 429，同样不消耗额度。
 *
 * 顺序不能反：如果先限流再验签，攻击者用伪造地址就能把
 * 真实用户的额度「挤掉」（虽然这里是按地址分桶，但先验签语义更清晰，
 * 且能让 401 的请求完全不进入限流表，省内存）。
 *
 * ── 为什么 401 与 429 要分开 ─────────────────────────────────────
 * 前端要对两者做不同的事：
 * - 401 → 弹钱包连接/签名（用户能自己解决）
 * - 429 → 显示倒计时（用户只能等）
 * 混成一个错误码会让前端无法区分，最后只能显示「出错了」。
 */
import { NextResponse } from 'next/server';
import { verifySession } from './walletAuth';
import { consume, DEEP_RATE, SCAN_RATE, type RateSpec } from './rateLimit';
import { track } from './analytics/store';

export type GuardKind = 'scan' | 'deep';

const SPECS: Record<GuardKind, RateSpec> = {
  scan: SCAN_RATE,
  deep: DEEP_RATE,
};

/** 从请求头取会话 token */
function tokenFrom(request: Request): string | null {
  const h = request.headers.get('authorization');
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

export interface GuardOk {
  ok: true;
  wallet: string;
}

export interface GuardFail {
  ok: false;
  response: NextResponse;
}

/**
 * 校验并消耗额度。返回 `{ ok: true, wallet }` 或一个可直接返回的响应。
 *
 * 用法：
 * ```ts
 * const g = guard(request, 'scan');
 * if (!g.ok) return g.response;
 * // … 正常处理，g.wallet 是已验证的钱包地址
 * ```
 */
export function guard(request: Request, kind: GuardKind): GuardOk | GuardFail {
  const session = verifySession(tokenFrom(request));
  if (!session) {
    // 记一笔「没带有效凭证就来打 API」—— 这是探测/攻击的早期信号
    track({ name: 'auth_rejected', meta: { path: new URL(request.url).pathname } });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: '需要连接钱包并签名后才能使用',
          code: 'WALLET_REQUIRED',
        },
        { status: 401 },
      ),
    };
  }

  const decision = consume(session.wallet, kind, SPECS[kind]);
  if (!decision.allowed) {
    track({
      name: 'scan_rate_limited',
      wallet: session.wallet,
      meta: { kind, retryAfterSec: decision.retryAfterSec },
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            kind === 'deep'
              ? `深度分析每 5 分钟只能发起一次，请等待 ${decision.retryAfterSec} 秒`
              : `扫描每 60 秒只能发起一次，请等待 ${decision.retryAfterSec} 秒`,
          code: 'RATE_LIMITED',
          retryAfterSec: decision.retryAfterSec,
          kind,
        },
        {
          status: 429,
          // 标准头：让中间层/客户端也能正确重试
          headers: { 'Retry-After': String(decision.retryAfterSec) },
        },
      ),
    };
  }

  return { ok: true, wallet: session.wallet };
}
