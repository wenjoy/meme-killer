/**
 * 深度持仓分析 —— 对前 N 名持有人逐地址拉完整历史，算出真实成本。
 *
 * 为什么是「任务 + 轮询」而不是一个普通请求：
 * 实测 50 个地址要 38 秒（3809 笔历史，并发固定 3 —— 并发 8 时 45/50 被限流）。
 * 一个 38 秒的同步请求在浏览器、代理、Serverless 三处都会超时，
 * 而且失败后用户完全看不到进度、不知道该不该等。
 *
 * 所以：
 *   POST /api/deep  { mint }        → 启动任务，立刻返回 { id }
 *   GET  /api/deep?id=xxx           → 查进度 / 取结果
 *
 * 任务状态放在模块级 Map 里（单实例部署够用）；进程重启会丢，
 * 那时返回「任务不存在，请重新发起」，而不是假装还在跑。
 */
import { NextResponse } from 'next/server';
import { getDeepJob, startDeepJob } from '@/providers/deepJobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: { mint?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const mint = typeof body.mint === 'string' ? body.mint.trim() : '';
  if (!mint) return NextResponse.json({ error: '缺少 mint' }, { status: 400 });

  try {
    const job = await startDeepJob(mint);
    return NextResponse.json({
      id: job.id,
      state: job.state,
      progress: job.progress,
      ...(job.state === 'queued' && job.queuePosition !== undefined
        ? { queuePosition: job.queuePosition, etaSec: job.etaSec }
        : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 需要先做一次普通扫描（深度模式复用枚举结果，不重复枚举 9446 个账户）
    const status = msg.includes('NEED_SCAN') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
  const job = getDeepJob(id);
  if (!job) {
    return NextResponse.json(
      { error: '任务不存在或已过期（服务重启会清空任务），请重新发起。' },
      { status: 404 },
    );
  }
  return NextResponse.json({
    id: job.id,
    state: job.state,
    progress: job.progress,
    // 排队信息：让用户知道「还要等多久、前面有几个」，而不是干等一个 0% 的进度条
    ...(job.state === 'queued' && job.queuePosition !== undefined
      ? { queuePosition: job.queuePosition, etaSec: job.etaSec }
      : {}),
    ...(job.state === 'done' ? { result: job.result, warnings: job.warnings } : {}),
    ...(job.state === 'error' ? { error: job.error } : {}),
  });
}
