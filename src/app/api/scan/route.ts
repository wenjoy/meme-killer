/**
 * 扫描 API。
 *
 * POST /api/scan  { mint: string }        → 真实链上采集 + 分析
 * POST /api/scan  { sample: string }      → 内置样本（离线演示）
 * GET  /api/scan                          → 列出可用样本
 *
 * 为什么是 POST：mint 地址不进 URL 日志；且扫描是一次有副作用的昂贵操作。
 */
import { NextResponse } from 'next/server';
import { collectAndScan } from '@/providers';
import { SAMPLES } from '@/providers/sample';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 链上采集可能较慢（公共 RPC 限流），给足时间
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({
    samples: SAMPLES.map(({ key, label, blurb }) => ({ key, label, blurb })),
  });
}

export async function POST(request: Request) {
  let body: { mint?: unknown; sample?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const sample = typeof body.sample === 'string' ? body.sample.trim() : '';
  const mint = typeof body.mint === 'string' ? body.mint.trim() : '';

  if (!sample && !mint) {
    return NextResponse.json({ error: '请提供 mint 地址或 sample 名称' }, { status: 400 });
  }

  try {
    const report = await collectAndScan(mint, sample ? { sample } : {});
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 输入类错误给 400，其余给 502（数据源问题，值得重试）
    const isInputError = /未知样本|合法|base58/.test(message);
    return NextResponse.json({ error: message }, { status: isInputError ? 400 : 502 });
  }
}
