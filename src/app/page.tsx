'use client';

import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '@/i18n';

import { installFlushOnExit, track } from '@/components/analytics';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { WalletButton } from '@/components/WalletButton';
import {
  sessionToken,
  useWalletGate,
  WALLET_BTN_PRIMARY,
} from '@/components/WalletGate';
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
  const { t } = useI18n();
  const gate = useWalletGate();
  // 页面浏览一次（组件挂载即记一次）+ 挂上退出前的队列冲刷
  useEffect(() => {
    track('page_view');
    installFlushOnExit();
  }, []);
  // 没签名就不能扫 —— 前端拦一道给即时反馈，服务端还有一道（那才是真的）
  const canScan = gate.state === 'ready';

  const run = useCallback(async (address: string, opts?: { forceOverview?: boolean }) => {
    setPending(true);
    setError(null);
    setReport(null);
    const t0 = Date.now();
    track(opts?.forceOverview ? 'holders_load' : 'scan_start', address);
    try {
      const token = sessionToken();
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mint: address, ...(opts?.forceOverview ? { forceOverview: true } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) {
        // 429 带上剩余秒数，让用户知道要等多久而不是「出错了」
        if (res.status === 429) {
          track('scan_rate_limited', address, { retryAfterSec: json.retryAfterSec ?? 60 });
          throw new Error(t('wallet.rateLimited', { sec: json.retryAfterSec ?? 60 }));
        }
        if (res.status === 401) throw new Error(t('wallet.required'));
        throw new Error(json.error ?? `请求失败（${res.status}）`);
      }
      setReport(json as ScanReport);
      // 记录耗时与得分：这两个字段最能反映「工具好不好用」
      track('scan_ok', address, { ms: Date.now() - t0, score: json.score });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      track('scan_fail', address, { ms: Date.now() - t0, reason: msg.slice(0, 120) });
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
      const t0 = Date.now();
      track('deep_start', address);
      try {
        const token = sessionToken();
        const start = await fetch('/api/deep', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ mint: address }),
        });
        const started = await start.json();
        if (!start.ok) {
          if (start.status === 429) {
            throw new Error(t('wallet.rateLimited', { sec: started.retryAfterSec ?? 300 }));
          }
          if (start.status === 401) throw new Error(t('wallet.required'));
          throw new Error(started.error ?? `启动失败（${start.status}）`);
        }
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
        const msg = err instanceof Error ? err.message : String(err);
        setDeepError(msg);
        // 限流与其它失败分开记：前者是产品策略生效，后者才是 bug
        track(
          /太频繁|Too many/.test(msg) ? 'scan_rate_limited' : 'deep_fail',
          address,
          { ms: Date.now() - t0, reason: msg.slice(0, 120) },
        );
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
            <h1 className="text-lg font-bold text-ink-200">{t('app.name')}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            <WalletButton />
          </div>
        </div>
      </header>

      {/* 输入 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // 没签名不发请求：服务端也会拒，但没必要白跑一趟网络
          if (!canScan) return;
          if (mint.trim()) void run(mint.trim());
        }}
        className="rounded-xl border border-ink-700 bg-ink-900/60 p-4"
      >
        <label htmlFor="mint" className="mb-2 block text-xs text-ink-400">
          {t('app.inputLabel')}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="mint"
            value={mint}
            onChange={(e) => setMint(e.target.value)}
            placeholder={t('app.inputPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 font-mono text-sm text-ink-200 outline-none transition placeholder:text-ink-600 focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="submit"
            disabled={pending || !mint.trim() || !canScan}
            className="shrink-0 rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? t('app.scanning') : t('app.submit')}
          </button>
        </div>

        {/* 未连钱包时的说明：讲清楚「为什么」以及「签名不会花钱」，
            否则用户看到钱包弹窗会以为要转账，直接关掉页面 */}
        {!canScan && (
          <div className="mt-3 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2">
            <p className="text-xs font-medium text-amber-300">{t('wallet.needsWallet')}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{t('wallet.howTo')}</p>
            <button
              type="button"
              onClick={() => void gate.connect()}
              disabled={gate.state === 'signing'}
              className={`mt-2 ${WALLET_BTN_PRIMARY}`}
            >
              {gate.state === 'signing' ? t('wallet.signing') : t('wallet.connect')}
            </button>
          </div>
        )}
      </form>

      {pending && (
        <div className="relative mt-6 overflow-hidden rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
          <div className="scanning-sweep absolute inset-0" />
          <p className="relative text-sm text-ink-300">
            {t('app.scanning')}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3">
          <p className="text-sm font-medium text-danger">{t('app.scanFailed')}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-300">{error}</p>
          <p className="mt-2 text-[11px] text-ink-400">
            {t('app.scanFailedHint')}
          </p>
        </div>
      )}

      {deep && (
        <div className="mt-4 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3">
          {deep.state === 'queued' ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="text-ink-200">
                  {t('app.deepQueued', { n: Math.max(0, (deep.queuePosition ?? 1) - 1) })}
                </span>
                {deep.etaSec !== undefined && (
                  <span className="font-mono text-ink-300">
                    {t('app.deepEta', { min: Math.max(1, Math.ceil(deep.etaSec / 60)) })}
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
                {t('app.deepQueuedNote')}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-ink-200">
                  {t('app.deepRunning')}
                </span>
                <span className="font-mono text-ink-300">
                  {t('app.deepProgress', { pct: deep.pct, done: deep.done, total: deep.total })}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-ink-800">
                <div className="h-full bg-accent transition-all" style={{ width: `${deep.pct}%` }} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
                {t('app.deepRunningNote')}
              </p>
            </>
          )}
        </div>
      )}

      {deepError && (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-xs text-ink-300">
          {t('app.deepFailed', { msg: deepError })}
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
