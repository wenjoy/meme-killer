'use client';

import { useCallback, useState } from 'react';
import type { ScanReport } from '@/core/types';
import { Report } from '@/components/Report';

interface SampleMeta {
  key: string;
  label: string;
  blurb: string;
}

const SAMPLES: SampleMeta[] = [
  { key: 'healthy', label: 'GOODCAT', blurb: '健康样本 · 各维度干净' },
  { key: 'newLaunch', label: 'FRESH', blurb: '新发币 · 尚无池' },
  { key: 'slowRug', label: 'MOONX', blurb: '缓慢失血 · 抛压主导' },
  { key: 'openMint', label: 'RISK', blurb: '权限未弃 · 硬否决' },
  { key: 'honeypot', label: 'FREESOL', blurb: '蜜罐 · 卖不出去' },
  { key: 'classicRug', label: 'SAFE MOON2', blurb: '典型 rug · 全方位死' },
];

export default function Home() {
  const [mint, setMint] = useState('');
  const [report, setReport] = useState<ScanReport | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (payload: { mint?: string; sample?: string }, label?: string) => {
    setPending(true);
    setError(null);
    setReport(null);
    if (label !== undefined) setMint(label);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
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
      {/* ── 标题 ─────────────────────────────────────────────── */}
      <header className="mb-7">
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

      {/* ── 输入 ─────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mint.trim()) void run({ mint: mint.trim() });
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
            placeholder="例如 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
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

        <div className="mt-3 border-t border-ink-800 pt-3">
          <p className="mb-2 text-xs text-ink-400">
            或加载内置样本（<span className="text-warn">演示数据，非真实链上</span>）
          </p>
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <button
                key={s.key}
                type="button"
                disabled={pending}
                onClick={() => void run({ sample: s.key }, s.label)}
                title={s.blurb}
                className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-1.5 text-left text-xs transition hover:border-accent/50 hover:bg-ink-800 disabled:opacity-40"
              >
                <span className="font-mono font-semibold text-ink-200">{s.label}</span>
                <span className="ml-2 text-ink-400">{s.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      </form>

      {/* ── 状态 ─────────────────────────────────────────────── */}
      {pending && (
        <div className="relative mt-6 overflow-hidden rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
          <div className="scanning-sweep absolute inset-0" />
          <p className="relative text-sm text-ink-300">
            正在采集链上数据与市场数据…（公共 RPC 可能较慢，通常 3–15 秒）
          </p>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3">
          <p className="text-sm font-medium text-danger">扫描失败</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-300">{error}</p>
        </div>
      )}

      {report && (
        <div className="mt-6">
          <Report report={report} />
        </div>
      )}

      {/* ── 空状态 ───────────────────────────────────────────── */}
      {!report && !pending && !error && (
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink-300">怎么用</h2>
            <ol className="space-y-1.5 text-xs leading-relaxed text-ink-400">
              <li>1. 从 Pump.fun / DexScreener 复制代币的 mint 地址</li>
              <li>2. 粘贴到上方输入框，点「开始体检」</li>
              <li>3. 先看有没有<span className="text-danger">硬否决</span>——有就直接放弃</li>
              <li>4. 再看五维明细与仓位建议，注意标注「数据缺失」的维度</li>
            </ol>
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink-300">五个维度</h2>
            <ul className="space-y-1.5 text-xs leading-relaxed text-ink-400">
              <li><span className="text-ink-200">合约安全</span> 30% · 权限是否放弃、Token-2022 作恶扩展、LP 锁定</li>
              <li><span className="text-ink-200">流动性 &amp; 资金流</span> 25% · 抽池、刷量、蜜罐、抛压</li>
              <li><span className="text-ink-200">持币集中度</span> 20% · 剔除池与 burn 后的 Top10 占比</li>
              <li><span className="text-ink-200">开发者历史</span> 15% · 历史 rug、批量发币、dev 清仓</li>
              <li><span className="text-ink-200">社交热度</span> 10% · 提及量、刷量识别（不做否决）</li>
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
