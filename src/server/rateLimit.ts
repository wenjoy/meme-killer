/**
 * 按钱包地址限流 —— 保护 Helius 额度不被刷爆。
 *
 * ── 设计要点 ─────────────────────────────────────────────────────
 *
 * 1. **按钱包地址而不是 IP。** IP 限流在真实场景里很弱：攻击者换 IP 成本极低，
 *    而多个用户共用一个出口 IP（公司 NAT、手机基站）会被误伤。
 *    钱包地址是「谁在花钱」的真实身份，也是我们唯一能验证的凭证。
 *
 * 2. **必须验证签名，不能只信客户端传来的地址。**
 *    如果只是「前端把地址放在请求头里」，攻击者直接伪造一个地址头就绕过了 ——
 *    限流形同虚设。所以地址来自**服务端验证过的签名**（见 walletAuth.ts）。
 *
 * 3. **额度按时长消耗，而不是「上次请求时间」。**
 *    记录「上次请求时间」会有个漏洞：连续请求时窗口不断被推后，
 *    但更糟的是实现上容易写成「距上次 > 60s 就放行」，
 *    于是一个脚本每 61 秒能稳定刷一次。
 *    这里用**令牌桶**：额度按时间线性恢复，突发被平滑掉。
 *
 * 4. **内存存储是刻意的选择，但有代价。**
 *    单实例部署下足够（本项目就是 `npm run dev` / 单进程）。
 *    ⚠️ 多实例部署时每个实例各算一份，实际额度会翻倍 ——
 *    那种场景必须换成 Redis。这一点写在注释里，避免以后误以为它是全局的。
 *
 * 5. **进程重启即清零。** 对「防滥用」够用（重启不频繁），
 *    对「计费」不够用。这里的目标是前者。
 *
 * ── 为什么不做的更复杂 ────────────────────────────────────────────
 * 没上 Redis / 没做分布式锁：这个站点的威胁模型是「有人写个脚本刷我的额度」，
 * 不是「有组织的 DDoS」。令牌桶 + 签名验证已经让脚本刷的成本高于收益。
 * 过度设计会引入新的失败模式（Redis 挂了整个站点不可用）。
 */

/** 一次请求消耗的额度与恢复速率 */
export interface RateSpec {
  /** 桶容量（允许的突发次数） */
  burst: number;
  /** 恢复 1 次额度需要的毫秒数 */
  refillMs: number;
}

/**
 * 扫描：60 秒 1 次，允许 1 次突发。
 *
 * `burst: 1` 意味着「不能连发」—— 用户点第一次后必须等 60 秒。
 * 这与需求「一定时间内重复提交请求也是不允许的」直接对应。
 */
export const SCAN_RATE: RateSpec = { burst: 1, refillMs: 60_000 };

/**
 * 深度分析：5 分钟 1 次。
 *
 * 为什么单独更严：一次深度分析要拉 100+ 次分页请求、耗时约 2 分钟，
 * 真实消耗是普通扫描的几十倍。共用扫描的额度等于让最贵的操作享受最便宜的价。
 */
export const DEEP_RATE: RateSpec = { burst: 1, refillMs: 300_000 };

interface Bucket {
  /** 当前可用额度（可为小数，表示恢复中的进度） */
  tokens: number;
  /** 上次结算时间 */
  updatedAt: number;
}

/** key = `${wallet}:${kind}`，避免两类额度互相影响 */
const buckets = new Map<string, Bucket>();

/** 上限：防止被大量不同钱包地址撑爆内存（每个地址两条记录） */
const MAX_BUCKETS = 10_000;

function now(): number {
  return Date.now();
}

/**
 * 清理过期条目。
 *
 * 一个额度完全恢复的桶与「从未请求过」等价，可以安全丢弃 ——
 * 所以不需要 TTL 定时器，扫描时顺手删即可。
 */
function evictIfNeeded(spec: RateSpec): void {
  if (buckets.size < MAX_BUCKETS) return;
  const t = now();
  for (const [k, b] of buckets) {
    const recovered = b.tokens + (t - b.updatedAt) / spec.refillMs;
    if (recovered >= spec.burst) buckets.delete(k);
  }
  // 极端情况（全是活跃地址）：直接清空，宁可放宽也不能让内存无限增长
  if (buckets.size >= MAX_BUCKETS) buckets.clear();
}

export interface RateDecision {
  allowed: boolean;
  /** 被拒时：还要等多少毫秒 */
  retryAfterMs: number;
  /** 被拒时：还要等多少秒（向上取整，给用户看） */
  retryAfterSec: number;
}

/**
 * 尝试消耗一次额度。
 *
 * 返回 `allowed: false` 时**不消耗**额度 ——
 * 否则被拒的请求也会重置恢复进度，形成「越试越久」的死锁。
 */
export function consume(wallet: string, kind: string, spec: RateSpec): RateDecision {
  evictIfNeeded(spec);
  const key = `${wallet}:${kind}`;
  const t = now();
  const b = buckets.get(key) ?? { tokens: spec.burst, updatedAt: t };

  // 按经过的时间线性恢复，上限为桶容量
  const elapsed = t - b.updatedAt;
  const tokens = Math.min(spec.burst, b.tokens + elapsed / spec.refillMs);

  if (tokens < 1) {
    // 不放行：把结算结果写回（恢复进度要保留），但不扣减
    buckets.set(key, { tokens, updatedAt: t });
    const needMs = (1 - tokens) * spec.refillMs;
    return {
      allowed: false,
      retryAfterMs: Math.ceil(needMs),
      retryAfterSec: Math.ceil(needMs / 1000),
    };
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: t });
  return { allowed: true, retryAfterMs: 0, retryAfterSec: 0 };
}

/** 只读查询：还要等多久（用于 UI 提前显示按钮禁用状态） */
export function peek(wallet: string, kind: string, spec: RateSpec): RateDecision {
  const b = buckets.get(`${wallet}:${kind}`);
  if (!b) return { allowed: true, retryAfterMs: 0, retryAfterSec: 0 };
  const tokens = Math.min(spec.burst, b.tokens + (now() - b.updatedAt) / spec.refillMs);
  if (tokens >= 1) return { allowed: true, retryAfterMs: 0, retryAfterSec: 0 };
  const needMs = (1 - tokens) * spec.refillMs;
  return {
    allowed: false,
    retryAfterMs: Math.ceil(needMs),
    retryAfterSec: Math.ceil(needMs / 1000),
  };
}

/** 测试用：清空所有额度 */
export function __resetRateLimit(): void {
  buckets.clear();
}
