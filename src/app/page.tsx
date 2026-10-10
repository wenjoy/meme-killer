'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ScanReport } from '@/core/types';
import { Report } from '@/components/Report';

interface Capability {
  rpcHost: string;
  enhancedApi: boolean;
  note: string;
}

export default function Home() {
  const [mint, setMint] = useState('');
  const [report, setReport] = useState<ScanReport | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cap, setCap] = useState<Capability | null>(null);

  // 启动时自检数据源，明确告诉用户哪些维度能真正生效
  useEffect(() => {
    fetch('/api/scan')
      .then((r) => r.json())
      .then(setCap)
      .catch(() => setCap(null));
  }, []);

  const run = useCallback(async (address: string) => {
    setPending(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mint: address }),
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

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-accent/40 bg-accent/10 font-mono text-lg text-accent">
            ◎
          </span>
          <div>
            <h1 className="text-lg font-bold text-ink-200">Meme Radar</h1>
            <p className="text-xs text-ink-400">Pump.fun 买入风险体检 · 五维链上风控</p>
          </div>
        </div>
      </header>

      {/* 数据源能力自检 */}
      {cap && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            cap.enhancedApi
              ? 'border-safe/30 bg-safe/5 text-ink-300'
              : 'border-warn/40 bg-warn/5 text-warn'
          }`}
        >
          <span className="font-mono">{cap.rpcHost}</span>
          {cap.enhancedApi && <span className="ml-2 text-safe">· Enhanced API 已启用</span>}
          <p className="mt-0.5">{cap.note}</p>
        </div>
      )}

      {/* 输入 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mint.trim()) void run(mint.trim());
        }}
        className="rounded-xl border border-ink-700 bg-ink-900/60 p-4"
      >
        <label htmlFor="mint" className="mb-2 block text-xs text-ink-400">
          输入 Solana mint 地址（代币合约地址）
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
        <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
          全部结论来自实时链上与市场数据，无模拟数据。标注「未采集」的维度不参与评分 ——
          未知不等于安全。
        </p>
      </form>

      {pending && (
        <div className="relative mt-6 overflow-hidden rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
          <div className="scanning-sweep absolute inset-0" />
          <p className="relative text-sm text-ink-300">
            正在采集链上数据与市场数据…（含多次 RPC 与 API 往返，通常 3–15 秒）
          </p>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3">
          <p className="text-sm font-medium text-danger">扫描失败</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-300">{error}</p>
          <p className="mt-2 text-[11px] text-ink-400">
            若为 401/403，请检查 HELIUS_API_KEY；若为超时，请确认 SOLANA_RPC_URL 可用（公共节点限流严重）。
          </p>
        </div>
      )}

      {report && (
        <div className="mt-6">
          <Report report={report} />
        </div>
      )}

      {!report && !pending && !error && (
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink-300">怎么用</h2>
            <ol className="space-y-1.5 text-xs leading-relaxed text-ink-400">
              <li>1. 从 Pump.fun / DexScreener 复制代币的 mint 地址</li>
              <li>2. 粘贴到上方输入框，点「开始体检」</li>
              <li>
                3. 先看有没有<span className="text-danger">硬否决</span>——有就直接放弃
              </li>
              <li>4. 再看五维明细与仓位建议，注意标注「未采集」的维度</li>
            </ol>
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink-300">五个维度</h2>
            <ul className="space-y-1.5 text-xs leading-relaxed text-ink-400">
              <li>
                <span className="text-ink-200">合约安全</span> 30% · 权限是否放弃、Token-2022 作恶扩展、LP 锁定
              </li>
              <li>
                <span className="text-ink-200">流动性 &amp; 资金流</span> 25% · 抽池、刷量、蜜罐、抛压
              </li>
              <li>
                <span className="text-ink-200">持币集中度</span> 20% · 剔除池与 burn 后的 Top10 占比
              </li>
              <li>
                <span className="text-ink-200">开发者历史</span> 15% · 历史发币、dev 卖出、资金来源（需 Helius Enhanced API）
              </li>
              <li>
                <span className="text-ink-200">社交热度</span> 10% · 需第三方社交数据源（未接入则不计分）
              </li>
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
