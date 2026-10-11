'use client';

import { DIMENSION_ORDER, SEVERITY_ORDER } from '@/core/constants';
import type { CustodyMetric, DimensionResult, Finding, ScanReport } from '@/core/types';
import { RadarChart, SEVERITY_STYLE, ScoreRing, TONE } from './visuals';

function FindingRow({ f }: { f: Finding }) {
  const s = SEVERITY_STYLE[f.severity];
  return (
    <li className={`flex gap-2.5 rounded-md border px-3 py-2 ${s.border} ${s.bg}`}>
      <span className={`mt-0.5 shrink-0 font-mono text-xs ${s.text}`}>{s.mark}</span>
      <div className="min-w-0">
        <p className={`text-[13px] font-medium ${s.text}`}>
          {f.title}
          {f.veto && (
            <span className="ml-2 rounded bg-danger/20 px-1.5 py-0.5 font-mono text-[10px] text-danger">
              硬否决
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-300">{f.detail}</p>
      </div>
    </li>
  );
}

function DimensionCard({ d }: { d: DimensionResult }) {
  const unavailable = d.metrics?.available === 0;
  const findings = [...d.findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink-200">{d.label}</h3>
          {d.error && (
            <span className="rounded bg-danger/15 px-1.5 py-0.5 font-mono text-[10px] text-danger">
              执行失败
            </span>
          )}
          {!d.error && unavailable && (
            <span className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
              数据缺失
            </span>
          )}
          {d.vetoed && (
            <span className="rounded bg-danger/20 px-1.5 py-0.5 font-mono text-[10px] text-danger">
              否决
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(2, d.score)}%`,
                background:
                  d.score >= 45
                    ? 'var(--color-danger)'
                    : d.score >= 25
                      ? 'var(--color-warn)'
                      : 'var(--color-safe)',
              }}
            />
          </div>
          <span className="w-8 text-right font-mono text-sm text-ink-200">
            {unavailable ? '—' : d.score.toFixed(0)}
          </span>
        </div>
      </header>
      <ul className="space-y-1.5">
        {findings.map((f, i) => (
          <FindingRow key={`${f.title}-${i}`} f={f} />
        ))}
      </ul>
    </section>
  );
}

/** 数据来源与可信度条 —— 让用户分清「链上事实」与「推算/缺失」 */
function Provenance({ report }: { report: ScanReport }) {
  const { meta } = report;
  const ORIGIN_LABEL: Record<string, { text: string; tone: string }> = {
    onchain: { text: '链上', tone: 'text-safe' },
    dexscreener: { text: 'DexScreener', tone: 'text-accent' },
    rugcheck: { text: 'RugCheck', tone: 'text-accent' },
    heuristic: { text: '推算', tone: 'text-warn' },
    unavailable: { text: '未采集', tone: 'text-ink-400' },
  };

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold text-ink-300">数据来源</span>
        <span className="font-mono text-xs text-ink-200">{meta.source}</span>
        {!meta.live && (
          <span className="rounded border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] text-warn">
            数据源异常 · 结果不完整
          </span>
        )}
        {meta.elapsedMs !== undefined && (
          <span className="font-mono text-[11px] text-ink-400">耗时 {meta.elapsedMs}ms</span>
        )}
        <span className="ml-auto font-mono text-[11px] text-ink-400">
          覆盖率 {report.coverage}%
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {Object.entries(meta.origins).map(([field, origin]) => {
          const l = ORIGIN_LABEL[origin] ?? { text: origin, tone: 'text-ink-400' };
          return (
            <span
              key={field}
              className="rounded border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-[10px] text-ink-400"
            >
              {field} <span className={l.tone}>{l.text}</span>
            </span>
          );
        })}
      </div>

      {meta.warnings.length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs text-warn hover:text-warn/80">
            采集告警 {meta.warnings.length} 条 —— 这些是「未知」，不等于「安全」
          </summary>
          <ul className="mt-2 space-y-1">
            {meta.warnings.map((w, i) => (
              <li key={i} className="border-l-2 border-warn/40 pl-2 text-xs leading-relaxed text-ink-300">
                {w}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function Report({ report }: { report: ScanReport }) {
  const tone = TONE[report.band.tone];
  const scores: Record<string, number> = {};
  const missing: Record<string, boolean> = {};
  for (const key of DIMENSION_ORDER) {
    const d = report.dimensions[key];
    scores[key] = d?.score ?? 0;
    missing[key] = d?.metrics?.available === 0;
  }

  const t = report.token;

  return (
    <div className="fade-up space-y-4">
      {/* ── 结论 ─────────────────────────────────────────────── */}
      <section className={`rounded-xl border ${tone.border} ${tone.bg} p-5`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ScoreRing score={report.score} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-xl font-bold text-ink-200">
                {t.symbol ?? '未知代币'}
                {t.name && t.name !== t.symbol && (
                  <span className="ml-2 text-sm font-normal text-ink-400">{t.name}</span>
                )}
              </h2>
              <span className={`rounded-md border ${tone.border} px-2.5 py-1 text-sm font-semibold ${tone.text}`}>
                {report.band.label} · {report.band.verdict}
              </span>
            </div>

            <p className="mt-2 font-mono text-[11px] break-all text-ink-400">{t.mint}</p>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-xs text-ink-400">建议仓位</span>
              <span className={`font-mono text-2xl font-bold ${tone.text}`}>{report.advice.size}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-300">{report.advice.text}</p>

            {(t.priceUsd !== undefined || t.marketCapUsd !== undefined) && (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-ink-400">
                {t.priceUsd !== undefined && (
                  <span>
                    价格 <span className="text-ink-200">${t.priceUsd.toPrecision(4)}</span>
                  </span>
                )}
                {t.marketCapUsd !== undefined && (
                  <span>
                    市值 <span className="text-ink-200">${(t.marketCapUsd / 1000).toFixed(0)}K</span>
                  </span>
                )}
                {t.supply !== undefined && (
                  <span>
                    供应量 <span className="text-ink-200">{(t.supply / 1e9).toFixed(2)}B</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 硬否决单独置顶 —— 它是最需要被看到的结论 */}
        {report.vetoes.length > 0 && (
          <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3">
            <p className="mb-2 text-sm font-semibold text-danger">
              命中 {report.vetoes.length} 项硬否决 —— 一票判死，与其它维度表现无关
            </p>
            <ul className="space-y-1.5">
              {report.vetoes.map((v, i) => (
                <li key={i} className="text-xs leading-relaxed text-ink-200">
                  <span className="mr-1.5 rounded bg-danger/20 px-1.5 py-0.5 font-mono text-[10px] text-danger">
                    {v.dimension}
                  </span>
                  <span className="font-medium">{v.title}</span>
                  <span className="text-ink-300"> —— {v.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── 雷达图 + 维度速览 ────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col items-center justify-center rounded-xl border border-ink-700 bg-ink-900/60 p-4">
          <RadarChart scores={scores} missing={missing} />
          <p className="mt-1 text-center text-[11px] leading-relaxed text-ink-400">
            半径越大风险越高 · 灰色「无数据」表示该维度未采集
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {DIMENSION_ORDER.map((key) => {
            const d = report.dimensions[key];
            if (!d) return null;
            const m = d.metrics ?? {};
            return (
              <div
                key={key}
                className="flex flex-col justify-between rounded-xl border border-ink-700 bg-ink-900/60 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-400">{d.label}</span>
                  <span
                    className="font-mono text-lg font-semibold"
                    style={{
                      color: d.metrics?.available === 0 ? 'var(--color-ink-400)' : d.score >= 45 ? 'var(--color-danger)' : d.score >= 25 ? 'var(--color-warn)' : 'var(--color-safe)',
                    }}
                  >
                    {d.metrics?.available === 0 ? '—' : d.score.toFixed(0)}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-ink-400">
                  {key === 'holders' && (
                    <>
                      <div className="flex justify-between">
                        <dt>Top10</dt>
                        <dd className="text-ink-200">{num(m.top10Pct)}%</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>剔除项</dt>
                        <dd className="text-ink-200">{num(m.excludedPct)}%</dd>
                      </div>
                      {Number(m.timelockPct) > 0 && (
                        <div className="flex justify-between">
                          <dt>锁仓</dt>
                          <dd className="text-safe">{num(m.timelockPct)}%</dd>
                        </div>
                      )}
                      {Number(m.otherCustodyPct) > 0 && (
                        <div className="flex justify-between">
                          <dt>托管</dt>
                          <dd className="text-warn">{num(m.otherCustodyPct)}%</dd>
                        </div>
                      )}
                    </>
                  )}
                  {key === 'liquidity' && (
                    <>
                      <div className="flex justify-between">
                        <dt>阶段</dt>
                        <dd className="text-ink-200">
                          {Number(m.graduated) === 1 ? '已毕业(AMM)' : Number(m.graduated) === 0 ? '曲线中' : '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>curve SOL</dt>
                        <dd className="text-ink-200">{num(m.realSolReserves)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>净流入 SOL</dt>
                        <dd className="text-ink-200">{num(m.netInflowSol)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>卖单额</dt>
                        <dd className="text-ink-200">{num(m.sellSharePct)}%</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>持有人</dt>
                        <dd className="text-ink-200">{num(m.holderCount)}</dd>
                      </div>
                    </>
                  )}
                  {key === 'developer' && (
                    <>
                      <div className="flex justify-between">
                        <dt>历史发币</dt>
                        <dd className="text-ink-200" title="只统计发币数量；这些代币的结局（是否 rug）本工具不回溯，因此不判定">
                          {num(m.priorTokenCount)} 个
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>dev 卖出</dt>
                        <dd className="text-ink-200">
                          {m.devSoldRatio === undefined ? '—' : `${(Number(m.devSoldRatio) * 100).toFixed(0)}%`}
                        </dd>
                      </div>
                    </>
                  )}
                  {key === 'contract' && (
                    <>
                      <div className="flex justify-between">
                        <dt>mint 权限</dt>
                        <dd
                          className={
                            Number(m.mintAuthorityRevoked) === 1
                              ? 'text-safe'
                              : Number(m.mintAuthorityRevoked) === 0
                                ? 'text-danger'
                                : 'text-ink-400'
                          }
                        >
                          {Number(m.mintAuthorityRevoked) === 1
                            ? '已弃'
                            : Number(m.mintAuthorityRevoked) === 0
                              ? '未弃'
                              : '未知'}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>转移税</dt>
                        <dd className="text-ink-200">{num(m.transferFeeBps)}bps</dd>
                      </div>
                    </>
                  )}
                  {key === 'social' && (
                    <>
                      <div className="flex justify-between">
                        <dt>24h 提及</dt>
                        <dd className="text-ink-200">{num(m.mentions24h)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>疑似 bot</dt>
                        <dd className="text-ink-200">{((Number(m.botRatio) || 0) * 100).toFixed(0)}%</dd>
                      </div>
                    </>
                  )}
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      <CustodySection report={report} />

      <Provenance report={report} />

      {/* ── 五维详细发现 ─────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-300">逐项体检明细</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {DIMENSION_ORDER.map((key) => {
            const d = report.dimensions[key];
            return d ? <DimensionCard key={key} d={d} /> : null;
          })}
        </div>
      </section>

      <p className="rounded-lg border border-ink-700 bg-ink-900/40 px-4 py-3 text-xs leading-relaxed text-ink-400">
        本报告由链上与公开数据自动生成，<span className="text-ink-300">不构成投资建议</span>。
        meme 币归零是常态 —— 评分低只代表「未发现明显问题」，不代表安全。
        任何仓位都请自行控制风险，并交叉验证 RugCheck、DexScreener 等平台。
      </p>
    </div>
  );
}

/**
 * 锁仓 / 程序托管持仓明细。
 *
 * 用户要求：锁仓要从巨鲸与集中度里剔除，**但必须单独列出来并显示解锁时间**。
 * 这里如实呈现三件事：占比、类型、解锁时间（读不到就写「待接入」）、
 * 以及**是否计入了集中度** —— 避免「剔除了却看不见」变成隐性漏报。
 */
function CustodySection({ report }: { report: ScanReport }) {
  const m = report.dimensions.holders?.metrics;
  const list = Array.isArray(m?.custody) ? (m.custody as CustodyMetric[]) : [];
  if (list.length === 0) return null;

  const locks = list.filter((c) => c.kind === 'timelock');
  const others = list.filter((c) => c.kind !== 'timelock');

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-300">锁仓与托管持仓</h2>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-ink-900/60 text-ink-400">
            <tr>
              <th className="px-3 py-2 font-medium">地址</th>
              <th className="px-3 py-2 font-medium">类型</th>
              <th className="px-3 py-2 text-right font-medium">占比</th>
              <th className="px-3 py-2 font-medium">解锁时间</th>
              <th className="px-3 py-2 font-medium">计入集中度</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {list.map((c) => (
              <tr key={c.address} className="bg-ink-950/40">
                <td className="px-3 py-2 font-mono text-ink-300">{shortAddr(c.address)}</td>
                <td className="px-3 py-2 text-ink-200">{c.label}</td>
                <td className="px-3 py-2 text-right font-mono text-ink-200">{num(c.pct)}%</td>
                <td className="px-3 py-2">
                  {c.kind !== 'timelock' ? (
                    <span className="text-ink-400">—（非时间锁）</span>
                  ) : c.unlockAt ? (
                    <span className="text-warn">
                      首次 {c.unlockAt.slice(0, 10)}
                      {c.unlockEndAt && (
                        <span className="block text-ink-400">全部 {c.unlockEndAt.slice(0, 10)}</span>
                      )}
                    </span>
                  ) : (
                    <span
                      className="text-ink-400"
                      title="托管仓位的 owner 是 PDA，拿不到账户去解析解锁计划，因此读不到到期日"
                    >
                      待接入
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {c.kind === 'timelock' ? (
                    <span className="text-safe">否 · 已剔除</span>
                  ) : (
                    <span className="text-warn">是 · 可随时转出</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-400">
        {locks.length > 0 && (
          <>
            锁仓仓位已从 Top10 与巨鲸判断中剔除。
            {locks.some((l) => l.unlockAt) ? (
              <>
                解锁时间取自锁仓程序自己的托管账户。
                <span className="text-ink-300">
                  锁仓会随时间线性释放，解锁后即可抛售
                </span>
                ，不是「一直锁着」。
              </>
            ) : (
              <>
                解锁时间当前读不到，如实标为「待接入」——
                <span className="text-ink-300">这不是「已解锁」</span>
                ，到期日请另行确认。
              </>
            )}
          </>
        )}
        {locks.length > 0 && others.length > 0 && ' '}
        {others.length > 0 && (
          <>
            {others.length} 个仓位由程序托管，但
            <span className="text-ink-300">多签/托管不是时间锁</span>
            ，可随时签名转出，因此
            <span className="text-warn">仍然计入集中度</span>，只是单独列出。
          </>
        )}
      </p>
    </section>
  );
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-5)}` : a;
}

function num(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, '');
}
