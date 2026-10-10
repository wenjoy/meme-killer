/**
 * 扫描 API —— 只接受真实 mint 地址，没有模拟数据。
 *
 * POST /api/scan  { mint: string }   → 采集真实链上 + 市场数据并分析
 * GET  /api/scan                     → 返回当前数据源能力自检
 *
 * 用 POST 而非 GET：mint 不进 URL 日志，且扫描是一次昂贵的采集操作。
 */
import { NextResponse } from 'next/server';
import { capabilityReport, collectAndScan } from '@/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 链上采集含多次 RPC + REST 往返，给足时间
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json(capabilityReport());
}

export async function POST(request: Request) {
  let body: { mint?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const mint = typeof body.mint === 'string' ? body.mint.trim() : '';
  if (!mint) {
    return NextResponse.json({ error: '请提供 mint 地址' }, { status: 400 });
  }

  try {
    const report = await collectAndScan(mint);
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 输入类错误 400；数据源问题 502（可重试）
    const isInputError = /合法|base58|请提供/.test(message);
    return NextResponse.json({ error: message }, { status: isInputError ? 400 : 502 });
  }
}
