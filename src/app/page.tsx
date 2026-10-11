'use client';

import { useCallback, useState } from 'react';
import type { ScanReport } from '@/core/types';
import { Report } from '@/components/Report';

export default function Home() {
  const [mint, setMint] = useState('');
  const [report, setReport] = useState<ScanReport | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 深度任务：跑起来后轮询进度，完成后自动重扫（真实成本替换窗口估算） */
  const [deep, setDeep] = useState<{
    pct: number;
    done: number;
    total: number;
    /** 排队中：前面还有几个任务、预计等多久 */
    queuePosition?: number;
    etaSec?: number;
    state?: string;
  } | null>(null);
  const [deepError, setDeepError] = useState<string | null>(null);

  const run = useCallback(async (address: string, opts?: { forceOverview?: boolean }) => {
    setPending(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mint: address, ...(opts?.forceOverview ? { forceOverview: true } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `请求失败（${res.status}）`);
      setReport(json as ScanReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, []);

  /**
   * 深度分析：逐地址拉完整历史算出**真实成本**。
   *
   * 实测 50 个地址 = 121 秒（11685 笔历史 / 133 页），所以必须
   * 「启动任务 → 轮询进度 → 完成后自动重扫」，而不是一个同步请求。
   */
  const runDeep = useCallback(
    async (address: string) => {
      setDeepError(null);
      setDeep({ pct: 0, done: 0, total: 0 });
      try {
        const start = await fetch('/api/deep', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mint: address }),
        });
        const started = await start.json();
        if (!start.ok) throw new Error(started.error ?? `启动失败（${start.status}）`);
        const id: string = started.id;
        setDeep({
          ...(started.progress ?? { pct: 0, done: 0, total: 0 }),
          state: started.state,
          ...(started.queuePosition !== undefined ? { queuePosition: started.queuePosition } : {}),
          ...(started.etaSec !== undefined ? { etaSec: started.etaSec } : {}),
        });

        // 轮询直到完成。间隔 3 秒：任务是 121 秒量级，再密就是浪费。
        for (;;) {
          await new Promise((r) => setTimeout(r, 3000));
          const res = await fetch(`/api/deep?id=${id}`);
          const job = await res.json();
          if (!res.ok) throw new Error(job.error ?? `查询失败（${res.status}）`);
          setDeep({
            ...job.progress,
            state: job.state,
            ...(job.queuePosition !== undefined ? { queuePosition: job.queuePosition } : {}),
            ...(job.etaSec !== undefined ? { etaSec: job.etaSec } : {}),
          });
          if (job.state === 'done') break;
          if (job.state === 'error') throw new Error(job.error ?? '深度分析失败');
        }
        // 深度结果已缓存，重扫一次即可让报告用上真实成本
        await run(address);
      } catch (err) {
        setDeepError(err instanceof Error ? err.message : String(err));
      } finally {
        setDeep(null);
      }
    },
    [run],
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-accent/40 bg-accent/10 font-mono text-lg text-accent">
            ◎
          </span>
          <div>
            <h1 className="text-lg font-bold text-ink-200">Meme Killer</h1>
          </div>
        </div>
      </header>

      {/* 输入 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mint.trim()) void run(mint.trim());
        }}
        className="rounded-xl border border-ink-700 bg-ink-900/60 p-4"
      >
        <label htmlFor="mint" className="mb-2 block text-xs text-ink-400">
          输入 Solana mint 地址
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="mint"
            value={mint}
            onChange={(e) => setMint(e.target.value)}
            placeholder="粘贴 mint 地址，例如 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 font-mono text-sm text-ink-200 outline-none transition placeholder:text-ink-600 focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="submit"
            disabled={pending || !mint.trim()}
            className="shrink-0 rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? '扫描中…' : '开始体检'}
          </button>
        </div>
      </form>

      {pending && (
        <div className="relative mt-6 overflow-hidden rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
          <div className="scanning-sweep absolute inset-0" />
          <p className="relative text-sm text-ink-300">
            正在采集链上数据…
          </p>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3">
          <p className="text-sm font-medium text-danger">扫描失败</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-300">{error}</p>
          <p className="mt-2 text-[11px] text-ink-400">
            请稍后重试。若持续失败，可能是数据源暂时不可用。
          </p>
        </div>
      )}

      {deep && (
        <div className="mt-4 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3">
          {deep.state === 'queued' ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="text-ink-200">
                  已排队 —— 前面有 {Math.max(0, (deep.queuePosition ?? 1) - 1)} 个深度任务在跑
                </span>
                {deep.etaSec !== undefined && (
                  <span className="font-mono text-ink-300">
                    预计等待约 {Math.max(1, Math.ceil(deep.etaSec / 60))} 分钟
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
                一次只跑一个深度任务，避免触发数据源限流导致结果不完整。可以离开这一页。
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-ink-200">
                  深度分析进行中 —— 逐地址拉取完整历史，算出真实成本（不是窗口估算）
                </span>
                <span className="font-mono text-ink-300">
                  {deep.pct}%（{deep.done}/{deep.total}）
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-ink-800">
                <div className="h-full bg-accent transition-all" style={{ width: `${deep.pct}%` }} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
                前 50 名持有人约需 <span className="text-ink-300">2 分钟</span>，完成后自动重新生成报告。
              </p>
            </>
          )}
        </div>
      )}

      {deepError && (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-xs text-ink-300">
          深度分析失败：{deepError}
        </div>
      )}

      {report && (
        <div className="mt-6">
          <Report
            report={report}
            onForceOverview={() => void run(report.token.mint, { forceOverview: true })}
            forcing={pending}
            onRunDeep={() => void runDeep(report.token.mint)}
            deepPending={deep !== null}
          />
        </div>
      )}

    </main>
  );
}
