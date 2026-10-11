/**
 * 钱包签名验证 —— 限流的地基。
 *
 * ── 为什么不能只信客户端传来的地址 ────────────────────────────────
 *
 * 最省事的做法是「前端把钱包地址放进请求头，服务端按它限流」。
 * 但这**完全没有防护作用**：攻击者根本不用连钱包，直接
 * `curl -H 'x-wallet: <随便一个地址>'` 每次换一个地址即可 ——
 * 而且换地址是零成本的（生成一个 Solana 地址不需要任何东西）。
 *
 * 所以限额必须挂在**用户无法伪造的身份**上，而唯一能证明
 * 「我控制这个私钥」的方式就是**签名**。
 *
 * ── 采用的方式：挑战 — 应答（challenge-response）────────────────
 *
 * 1. 客户端 `POST /api/auth` 带上地址 → 服务端返回一段随机 nonce（挑战）
 * 2. 客户端用钱包对该 nonce 签名
 * 3. 客户端 `POST /api/auth` 带上地址 + nonce + 签名 → 服务端用
 *    `nacl.sign.detached.verify` 验证「这个签名确实是这个地址、对这段内容签的」
 * 4. 验证通过后签发一个**服务端签名的会话 token**（HMAC），后续请求带它
 *
 * ⚠️ 为什么第 4 步不直接把 nonce 当 token 用：
 * nonce 是客户端可见的，如果它本身就是凭证，那攻击者可以自己造一个
 * 没用过的 nonce 再编个签名 —— 必须由服务端用**自己才知道的密钥**签发。
 *
 * ── 安全性边界（诚实说明）────────────────────────────────────────
 *
 * - 这不是「登录」：没有账户体系，token 只是一个「地址已被验证」的凭证。
 * - token 有有效期（默认 24 小时），过期要重新签。
 * - nonce 一次性使用，防止重放。
 * - ⚠️ 不依赖数据库：nonce 与已用记录都在内存里，
 *   多实例部署时需换共享存储（与 rateLimit 同一个前提）。
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

/** 会话有效期：24 小时。到期重新签名（钱包弹一次窗）。 */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** 挑战有效期：5 分钟。够用户点一次钱包确认，过期要重新取。 */
const NONCE_TTL_MS = 5 * 60 * 1000;

/**
 * 签名密钥。
 *
 * ⚠️ 生产环境必须通过环境变量注入固定值 —— 否则进程重启后
 * 所有用户都要重新签名（不致命，但体验差）；更要紧的是多实例部署时
 * 各实例密钥不同，用户会在实例间「随机掉登录」。
 */
function secret(): string {
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (!fallbackSecret) {
    fallbackSecret = randomBytes(32).toString('hex');
    // 只在第一次生成时提醒一次，避免刷日志
    console.warn(
      '[auth] 未设置 AUTH_SECRET，已生成临时密钥。进程重启后会话失效；多实例部署必须显式设置。',
    );
  }
  return fallbackSecret;
}
let fallbackSecret: string | null = null;

/** 待验证的挑战：nonce -> { wallet, expiresAt } */
const pendingNonces = new Map<string, { wallet: string; expiresAt: number }>();
/** 已用过的 nonce（防重放）。存到过期为止即可。 */
const usedNonces = new Map<string, number>();

const MAX_NONCES = 10_000;

function now(): number {
  return Date.now();
}

function sweep(): void {
  const t = now();
  for (const [k, v] of pendingNonces) if (v.expiresAt < t) pendingNonces.delete(k);
  for (const [k, exp] of usedNonces) if (exp < t) usedNonces.delete(k);
  if (pendingNonces.size > MAX_NONCES) pendingNonces.clear();
}

/**
 * 生成挑战。
 *
 * nonce 里包含地址，这样验证时能确认「这段挑战本来就是发给这个地址的」，
 * 而不是把别人地址的签名拿来用。
 */
export function issueChallenge(wallet: string): { nonce: string; expiresAt: number } {
  sweep();
  const nonce = `meme-killer:${wallet}:${randomBytes(16).toString('hex')}`;
  const expiresAt = now() + NONCE_TTL_MS;
  pendingNonces.set(nonce, { wallet, expiresAt });
  return { nonce, expiresAt };
}

/** base64 签名 -> Uint8Array；非法输入返回 null 而不是抛异常 */
function decodeSignature(sig: string): Uint8Array | null {
  try {
    const buf = Buffer.from(sig, 'base64');
    if (buf.length !== 64) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** base58 公钥 -> 32 字节 */
function decodePublicKey(addr: string): Uint8Array | null {
  try {
    const decoded = bs58.decode(addr);
    if (decoded.length !== 32) return null;
    return decoded;
  } catch {
    return null;
  }
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  token?: string;
  expiresAt?: number;
}

/**
 * 验证签名并签发会话 token。
 *
 * 失败一律返回模糊原因（不告诉调用方「是 nonce 错了还是签名错了」），
 * 避免给攻击者提供调试信息。日志里也不记签名内容。
 */
export function verifyAndIssue(wallet: string, nonce: string, signature: string): VerifyResult {
  sweep();

  const pending = pendingNonces.get(nonce);
  if (!pending) return { ok: false, reason: 'challenge_invalid' };
  if (pending.wallet !== wallet) return { ok: false, reason: 'challenge_wallet_mismatch' };
  if (pending.expiresAt < now()) {
    pendingNonces.delete(nonce);
    return { ok: false, reason: 'challenge_expired' };
  }
  if (usedNonces.has(nonce)) return { ok: false, reason: 'challenge_reused' };

  const pubkey = decodePublicKey(wallet);
  const sig = decodeSignature(signature);
  if (!pubkey || !sig) return { ok: false, reason: 'malformed' };

  const message = new TextEncoder().encode(nonce);
  let valid = false;
  try {
    valid = nacl.sign.detached.verify(message, sig, pubkey);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };

  // 一次性：消费掉挑战
  pendingNonces.delete(nonce);
  usedNonces.set(nonce, pending.expiresAt);

  const expiresAt = now() + SESSION_TTL_MS;
  return { ok: true, token: signSession(wallet, expiresAt), expiresAt };
}

/** 会话 token = base64url(payload).hmac —— 无状态，服务端可独立校验 */
function signSession(wallet: string, expiresAt: number): string {
  const payload = `${wallet}|${expiresAt}`;
  const mac = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${mac}`;
}

export interface Session {
  wallet: string;
  expiresAt: number;
}

/**
 * 校验会话 token。
 *
 * 用 `timingSafeEqual` 比较 HMAC —— 普通字符串比较会因为提前返回
 * 而泄漏「前几个字节对了」的信息，理论上可被逐字节爆破。
 */
export function verifySession(token: string | null | undefined): Session | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  const payloadB64 = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const sep = payload.lastIndexOf('|');
  if (sep <= 0) return null;
  const wallet = payload.slice(0, sep);
  const expiresAt = Number(payload.slice(sep + 1));
  if (!Number.isFinite(expiresAt) || expiresAt < now()) return null;

  return { wallet, expiresAt };
}

/** 测试用 */
export function __resetWalletAuth(): void {
  pendingNonces.clear();
  usedNonces.clear();
  fallbackSecret = null;
}
