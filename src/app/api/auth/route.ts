/**
 * 钱包认证 API —— 限额的凭证入口。
 *
 * POST /api/auth  { wallet }                                  → 返回挑战 nonce
 * POST /api/auth  { wallet, nonce, signature }                → 返回会话 token
 *
 * 两步都是 POST：钱包地址不进 URL 日志。
 */
import { NextResponse } from 'next/server';
import { issueChallenge, verifyAndIssue } from '@/server/walletAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Solana 地址是 32 字节的 base58，长度落在 32–44 之间 */
function looksLikeSolanaAddress(v: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';
  if (!wallet || !looksLikeSolanaAddress(wallet)) {
    return NextResponse.json({ error: '钱包地址不合法' }, { status: 400 });
  }

  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';

  // 第一步：只要地址 → 发挑战
  if (!nonce || !signature) {
    const c = issueChallenge(wallet);
    return NextResponse.json({ nonce: c.nonce, expiresAt: c.expiresAt });
  }

  // 第二步：地址 + 挑战 + 签名 → 验证并签发会话
  const r = verifyAndIssue(wallet, nonce, signature);
  if (!r.ok || !r.token) {
    // 原因不细分返回，避免给攻击者调试信息；只在服务端日志留痕
    console.warn(`[auth] 签名验证失败 wallet=${wallet.slice(0, 6)}… reason=${r.reason}`);
    return NextResponse.json(
      { error: '签名验证失败', code: 'BAD_SIGNATURE' },
      { status: 401 },
    );
  }

  return NextResponse.json({ token: r.token, wallet, expiresAt: r.expiresAt });
}
