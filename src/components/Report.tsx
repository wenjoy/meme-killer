'use client';

import { DIMENSION_ORDER, SEVERITY_ORDER } from '@/core/constants';
import { useEffect, useMemo, useState } from 'react';

import { THRESHOLDS } from '@/core/constants';
import type {
  CustodyMetric,
  DiamondEvidence,
  DiamondInfo,
  DimensionResult,
  Finding,
  HolderCurvePoint,
  HolderOverview,
  HolderOverviewLazy,
  HolderRow,
  LargeSellEvidence,
  ScanReport,
} from '@/core/types';
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

export function Report({
  report,
  onForceOverview,
  forcing,
}: {
  report: ScanReport;
  /** 点「按需加载全量分布」时重新扫描（带 forceOverview） */
  onForceOverview?: () => void;
  forcing?: boolean;
}) {
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
                      {m.buyTrades !== undefined && (
                        <div className="flex justify-between">
                          <dt>买/卖笔数</dt>
                          <dd className="text-ink-200">
                            {num(m.buyTrades)} / {num(m.sellTrades)}
                            {m.sampleWindowMin !== undefined && (
                              <span className="ml-1 text-[10px] text-ink-500">
                                （样本跨 {num(m.sampleWindowMin)} 分钟）
                              </span>
                            )}
                          </dd>
                        </div>
                      )}
                      {m.avgBuySol !== undefined && (
                        <div className="flex justify-between">
                          <dt>平均单笔 买/卖</dt>
                          <dd className="text-ink-200" title="单笔成交额均值，用来核对「小额买盘撑笔数、大额卖盘出货」">
                            {num(m.avgBuySol)} / {num(m.avgSellSol)} SOL
                          </dd>
                        </div>
                      )}
                      {m.sellMaxSol !== undefined && (
                        <div className="flex justify-between">
                          <dt>最大单笔卖单</dt>
                          <dd className="text-ink-200">{num(m.sellMaxSol)} SOL</dd>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <dt>持有人</dt>
                        <dd className="text-ink-200">{num(m.holderCount)}</dd>
                      </div>
                    </>
                  )}
                  {key === 'developer' && (
                    <>
                      {m.creatorSource !== undefined && (
                        <div className="flex justify-between">
                          <dt>部署者来源</dt>
                          <dd className="text-ink-200" title={String(m.creator ?? '')}>
                            {m.creatorSource === 'curve'
                              ? '曲线程序状态'
                              : m.creatorSource === 'metadata'
                                ? 'metadata creators'
                                : '创建交易付款方（推断值）'}
                          </dd>
                        </div>
                      )}
                      {m.launchWallet !== undefined && (
                        <div className="flex justify-between">
                          <dt>创建钱包</dt>
                          <dd className="font-mono text-warn" title={`与 creator ${String(m.creator ?? '')} 不是同一个地址`}>
                            {shortAddr(String(m.launchWallet))}
                          </dd>
                        </div>
                      )}
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
      <HoldersOverviewSection report={report} onForceOverview={onForceOverview} forcing={forcing} />
      <TopHoldersSection report={report} />
      <AllHoldersSection report={report} />

      <LargeSellsSection report={report} />

      <DiamondSection report={report} />

      <Provenance report={report} />

      {/* ── 各维度详细发现 ───────────────────────────────────── */}
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
 * 大额卖单明细。
 *
 * 用户要求：`最大单笔卖单 2.028 SOL` 这种话要能自己核对。所以这里给出
 * 时间、金额、卖出钱包与**交易签名**，签名直接链到 Solscan —— 点开就能看到
 * 是谁在什么时候砸的，而不是只能选择相信这个数字。
 */
function LargeSellsSection({ report }: { report: ScanReport }) {
  const m = report.dimensions.liquidity?.metrics;
  const list = Array.isArray(m?.largeSells) ? (m.largeSells as LargeSellEvidence[]) : [];
  if (list.length === 0) return null;

  const total = list.reduce((s, x) => s + x.sol, 0);
  // 0 = 本次没取到最早成交；此时「不在最早 25 笔内」这句话不成立，必须换个说法
  const windowKnown = m?.earlyBuyerWindowKnown === undefined ? undefined : m.earlyBuyerWindowKnown === 1;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-300">
        大额卖单明细
        <span className="ml-2 font-normal text-ink-500">
          最近 100 笔里最大的 {list.length} 笔，合计 {total.toFixed(3)} SOL，点签名可在 Solscan 核对
        </span>
      </h2>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-ink-900/60 text-ink-400">
            <tr>
              <th className="px-3 py-2 font-medium">时间（UTC）</th>
              <th className="px-3 py-2 text-right font-medium">金额 SOL</th>
              <th className="px-3 py-2 font-medium">卖出钱包</th>
              <th className="px-3 py-2 font-medium">身份</th>
              <th className="px-3 py-2 font-medium">当前持仓</th>
              <th className="px-3 py-2 font-medium">交易签名</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {list.map((s) => (
              <tr key={s.signature} className="bg-ink-950/40">
                <td className="px-3 py-2 font-mono text-ink-300">
                  {s.ts === undefined ? '—' : new Date(s.ts * 1000).toISOString().slice(5, 16).replace('T', ' ')}
                </td>
                <td className="px-3 py-2 text-right font-mono text-ink-200">{s.sol.toFixed(3)}</td>
                <td className="px-3 py-2 font-mono text-ink-300">
                  {s.trader ? shortAddr(s.trader) : '—'}
                </td>
                <td className="px-3 py-2">
                  {s.isCreator ? (
                    <span className="text-danger">部署者</span>
                  ) : s.earlyBuyerIndex !== undefined ? (
                    <span className="text-warn" title="代币最早 25 笔成交内的买家 —— 开盘就进场的人在出货">
                      开盘第 {s.earlyBuyerIndex + 1} 笔买入
                    </span>
                  ) : windowKnown === false ? (
                    <span
                      className="text-ink-400"
                      title="本次没取到该代币的最早成交，无法判断身份 —— 不要读成「不是狙击手」"
                    >
                      身份未知（没取到最早成交）
                    </span>
                  ) : (
                    <span
                      className="text-ink-400"
                      title="不是最早 25 笔成交的付款方；但这不等于确定不是早期买家（可能第 26 笔才买）"
                    >
                      不在最早 25 笔内
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono">
                  {s.holderPctNow === undefined ? (
                    <span className="text-ink-400">已不在前 20</span>
                  ) : (
                    <span className={s.sniperNow ? 'text-warn' : 'text-ink-200'}>
                      {s.holderPctNow.toFixed(2)}%{s.sniperNow ? '（狙击仓位）' : ''}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <a
                    className="font-mono text-accent underline decoration-dotted hover:text-accent/80"
                    href={`https://solscan.io/tx/${s.signature}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddr(s.signature)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-500">
        ⚠️ 「大额」是相对该代币自身成交而言：这里列的是<strong>样本内最大的几笔</strong>，
        不代表金额上有绝对意义。样本口径与上面的笔数/金额一致（最近 100 笔成交）。
        「身份」列看的是这些钱包<strong>是不是开盘那批人</strong>：开盘就买入的地址在出货
        与半路进场的持有人止盈，性质完全不同。「不在最早 25 笔内」只说明它不是最早
        25 笔成交的付款方，<strong>不等于</strong>确定不是早期买家。
      </p>
    </section>
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

/**
 * 前 20 大持仓明细。
 *
 * 用户要求：集中度那里要把 Top20 列出来。
 * 为什么必须逐行列出：`Top10 = 62.9%` 独自出现时读者无法核对 ——
 * 这个表把每个地址的分类（池/销毁/锁仓/托管/dev/狙击/散户）与**是否计入集中度**
 * 都写清楚。
 *
 * ⚠️ 等式必须写成两步，因为 Top10 集中度是「占流通盘」：
 *   下表「计入」前 10 行合计（占总供应）÷ 流通盘（占总供应）= Top10 集中度
 * 只写「合计 = Top10」是错的（那正是修掉的口径 bug），读者按计算器一除就能核对。
 */
function TopHoldersSection({ report }: { report: ScanReport }) {
  const m = report.dimensions.holders?.metrics;
  const rows = Array.isArray(m?.topHolders) ? (m.topHolders as HolderRow[]) : [];
  if (rows.length === 0) return null;

  const KIND_LABEL: Record<HolderRow['kind'], string> = {
    pool: '流动性池',
    burn: '销毁地址',
    timelock: '时间锁仓',
    custody: '程序托管',
    dev: 'creator 本人',
    related: '与部署者关联',
    sniper: '狙击仓位',
    retail: '散户',
  };
  const countedTop10 = rows.filter((r) => r.counted).slice(0, 10);
  const countedSum = countedTop10.reduce((s, r) => s + r.pct, 0);
  const circulatingPct = Number(m?.circulatingPct ?? 0);
  const top10Source = m?.top10Source === 'full' ? '全量枚举' : '前 20 名样本估算';

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-300">前 20 大持仓（链上能拿到的全部）</h2>
        <span className="font-mono text-[10px] text-ink-500">
          Top10 集中度 <span className="text-warn">{num(m?.top10Pct)}%</span>
          （占流通盘 {num(circulatingPct)}%）= 下表「计入」前 {countedTop10.length} 行合计{' '}
          {num(countedSum)}%（占总供应）÷ 流通盘 {num(circulatingPct)}%
          <span className="ml-1 text-ink-600">· {top10Source}</span>
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-400">
        「占总供应」这一列可以直接相加核对（锁仓那 72% 也算在里面，所以第一行就占掉半张表）；
        Top10 集中度则是把这些「计入」的行加起来再除以流通盘 {num(circulatingPct)}%
        {top10Source === '前 20 名样本估算' && (
          <span className="text-warn">
            {' '}—— 本次分子分母都只用前 20 名样本估的，加载全量持有人分布后会更准
          </span>
        )}
        。
      </p>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-ink-900/60 text-ink-400">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">地址</th>
              <th className="px-3 py-2 text-right font-medium">数量</th>
              <th className="px-3 py-2 text-right font-medium">占总供应</th>
              <th className="px-3 py-2 font-medium">分类</th>
              <th className="px-3 py-2 font-medium">计入集中度</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {rows.map((h, i) => (
              <tr key={h.address} className={h.counted ? 'bg-ink-950/40' : 'bg-ink-900/30 text-ink-400'}>
                <td className="px-2 py-2 font-mono text-ink-500">{i + 1}</td>
                <td className="px-3 py-2 font-mono">
                  <a
                    href={`https://solscan.io/account/${h.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink-200 underline decoration-ink-700 hover:text-safe"
                    title={h.address}
                  >
                    {shortAddr(h.address)}
                  </a>
                </td>
                <td className="px-3 py-2 text-right font-mono text-ink-300">{num(h.amount)}</td>
                <td className="px-3 py-2 text-right font-mono text-ink-200">{num(h.pct)}%</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      h.kind === 'dev'
                        ? 'text-danger'
                        : h.kind === 'related' || h.kind === 'sniper'
                          ? 'text-warn'
                          : h.counted
                            ? 'text-ink-300'
                            : 'text-ink-400'
                    }
                  >
                    {KIND_LABEL[h.kind]}
                  </span>
                  {h.label && <span className="ml-1 text-ink-500">（{h.label}）</span>}
                </td>
                <td className="px-3 py-2">
                  {h.counted ? (
                    '是'
                  ) : (
                    <span className="text-ink-500">
                      否（{h.kind === 'pool' ? '池持仓' : h.kind === 'burn' ? '已销毁' : '锁仓未解锁'}）
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-400">
        链上 RPC 只返回前 20 大持仓账户；更深的分布需要索引器，所以这 20 行是**能核对到的全部**，
        不代表只有 20 个持有人。「计入集中度 = 否」的三类（池、销毁、锁仓）已从 Top10 与巨鲸判断中剔除，
        托管（多签）不剔除 —— 它可以随时签名转出。
      </p>
    </section>
  );
}

/**
 * 全量持有人分布总览。
 *
 * 用户要求：「所有持币帐户的总览」——账户数是几千到几万，逐行列没有意义，
 * 所以这里给的是**结构**：分桶 + 累计集中度曲线 + 几个能直接下判断的标量。
 * 逐行明细在下面的 AllHoldersSection（分页、按需加载）。
 *
 * ⚠️ 两条曲线必须同时画：「含池/销毁/锁仓」与「剔除后」。
 * 实测同一个币前者 Top10 = 84.68%、后者 = 8.2% —— 只画一条，读者会以为
 * 这一页和上面的「Top10 集中度」自相矛盾。
 */
function HoldersOverviewSection({
  report,
  onForceOverview,
  forcing,
}: {
  report: ScanReport;
  onForceOverview?: () => void;
  forcing?: boolean;
}) {
  const m = report.dimensions.holders?.metrics;
  const overview = (m?.overview ?? undefined) as HolderOverview | undefined;
  const lazy = (m?.overviewLazy ?? undefined) as HolderOverviewLazy | undefined;

  if (!overview) {
    if (!lazy) return null;
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-300">全量持有人分布</h2>
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs text-ink-300">
          <p className="leading-relaxed">{lazy.reason}</p>
          <p className="mt-2 leading-relaxed text-ink-400">
            ⚠️ 这不等于「没有持有人」——只是没在这个代币上自动拉全量分布。
          </p>
          {onForceOverview && (
            <button
              type="button"
              disabled={forcing}
              onClick={onForceOverview}
              className="mt-3 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs text-ink-100 transition hover:bg-accent/20 disabled:opacity-50"
            >
              {forcing ? '正在重新扫描并枚举全量持仓…' : '按需加载全量分布（会重新扫描一次，较慢）'}
            </button>
          )}
        </div>
      </section>
    );
  }

  const emptyAccounts = overview.accountsTotal - overview.accountsWithBalance;
  const twoCaliber =
    overview.reportedHolders !== undefined && overview.reportedHolders !== overview.accountsTotal;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-300">全量持有人分布（链上枚举）</h2>
        <span className="font-mono text-[10px] text-ink-500">
          {overview.source === 'rpc' ? 'RPC 全量枚举' : 'DAS 分页兜底（较慢）'}
          {overview.truncated && ' · ⚠️ 未取全'}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="持有人（按地址合并）" value={overview.ownersWithBalance.toLocaleString()} sub={`${overview.accountsWithBalance.toLocaleString()} 个账户`} />
        <Stat label="持仓账户总数" value={overview.accountsTotal.toLocaleString()} sub={emptyAccounts > 0 ? `含已清空 ${emptyAccounts.toLocaleString()} 个` : '无空账户'} />
        <Stat
          label="达到 50% / 80% 需要"
          value={`${overview.ownersFor50 ?? '—'} / ${overview.ownersFor80 ?? '—'}`}
          sub="按剔除后的流通盘算"
        />
        <Stat
          label={`灰尘持有人（< ${THRESHOLDS.holders.overviewDustPct}%）`}
          value={overview.dustOwners.toLocaleString()}
          sub={`合计占 ${num(overview.dustPct)}%`}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-ink-900/60 text-ink-400">
            <tr>
              <th className="px-3 py-2 font-medium">持仓区间（占总供应）</th>
              <th className="px-3 py-2 text-right font-medium">持有人数</th>
              <th className="px-3 py-2 text-right font-medium">合计占比</th>
              <th className="px-3 py-2 font-medium">分布</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {overview.buckets.map((b) => {
              const share = b.owners / Math.max(1, overview.ownersWithBalance);
              return (
                <tr key={b.label} className="bg-ink-950/40">
                  <td className="px-3 py-2 font-mono text-ink-300">{b.label}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-200">{b.owners.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-200">{num(b.pct)}%</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded bg-ink-800">
                        <div className="h-full bg-accent" style={{ width: `${Math.min(100, share * 100).toFixed(2)}%` }} />
                      </div>
                      <span className="font-mono text-[10px] text-ink-500">{(share * 100).toFixed(1)}% 的人</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {overview.curve.length >= 2 && <ConcentrationCurve points={overview.curve} />}

      <p className="text-[11px] leading-relaxed text-ink-400">
        口径说明：这里按 **owner 合并**统计（同一地址的多个 token account 算一个人），
        账户数 {overview.accountsTotal.toLocaleString()} 个、有余额 {overview.accountsWithBalance.toLocaleString()} 个
        {overview.reportedHolders !== undefined && <>、RugCheck 报 {overview.reportedHolders.toLocaleString()} 个持有人</>}
        {twoCaliber && <> —— <span className="text-warn">三个口径对不上，差额不做推断</span></>}。
        池 / 销毁 / 锁仓合计剔除 {num(overview.excludedPct)}%；更深的持仓只能按地址归类，
        托管（多签/锁仓）判定只覆盖前 20 名（需要逐账户反查控制程序）。
        枚举到的持仓合计占总量 {num(overview.coveredPct)}%
        {overview.coveredPct < 99 && '（不到 100% 说明有持仓没被枚举到，分布不完整）'}。
      </p>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
      <div className="text-[10px] text-ink-400">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-ink-100">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-ink-500">{sub}</div>}
    </div>
  );
}

/** 累计集中度曲线：两条口径并排画，读者一眼能看出差在哪 */
function ConcentrationCurve({ points }: { points: HolderCurvePoint[] }) {
  const W = 560;
  const H = 170;
  const PAD = 30;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, points.length - 1);
  const y = (pct: number) => H - PAD - (Math.min(100, Math.max(0, pct)) / 100) * (H - 2 * PAD);
  const line = (get: (p: HolderCurvePoint) => number) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join(' ');

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] text-ink-400">
        <span className="font-medium text-ink-300">累计集中度曲线</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-4 rounded bg-warn" /> 含池 / 销毁 / 锁仓（占总量）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-4 rounded bg-safe" /> 剔除池/销毁/锁仓后（同用总量做分母）
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="累计集中度曲线">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={PAD} x2={W - PAD} y1={y(g)} y2={y(g)} stroke="var(--color-ink-700)" strokeWidth="1" strokeDasharray={g === 0 ? '' : '3 3'} />
            <text x={PAD - 4} y={y(g) + 3} textAnchor="end" fontSize="8" fill="var(--color-ink-500)">{g}%</text>
          </g>
        ))}
        <path d={line((p) => p.cumPctAll)} fill="none" stroke="var(--color-warn)" strokeWidth="2" />
        <path d={line((p) => p.cumPctCirculating)} fill="none" stroke="var(--color-safe)" strokeWidth="2" />
        {points.map((p, i) => (
          <g key={p.top}>
            <circle cx={x(i)} cy={y(p.cumPctCounted)} r="2.5" fill="var(--color-safe)" />
            <text x={x(i)} y={H - PAD + 12} textAnchor="middle" fontSize="8" fill="var(--color-ink-500)">
              {p.top >= 1000 ? `${p.top / 1000}k` : p.top}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-2 overflow-hidden rounded-lg border border-ink-800">
        <table className="w-full text-left text-[10px]">
          <thead className="bg-ink-900/60 text-ink-400">
            <tr>
              <th className="px-2 py-1.5 font-medium">前 N 名</th>
              <th className="px-2 py-1.5 text-right font-medium text-warn">含池/销毁/锁仓<br />（占总供应）</th>
              <th className="px-2 py-1.5 text-right font-medium text-safe">剔除后<br />（占总供应）</th>
              <th className="px-2 py-1.5 text-right font-medium">剔除后<br />（占流通盘）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {points.map((p) => (
              <tr key={p.top} className="bg-ink-950/40">
                <td className="px-2 py-1.5 font-mono text-ink-400">Top{p.top}</td>
                <td className="px-2 py-1.5 text-right font-mono text-warn">{num(p.cumPctAll)}%</td>
                <td className="px-2 py-1.5 text-right font-mono text-safe">{num(p.cumPctCounted)}%</td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-300">{num(p.cumPctCirculating)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-500">
        同一个 Top10 出现三个数只是因为<span className="text-ink-300">分母不同</span>：中间那列
        「剔除后占总供应」是上面「持币集中度」里 Top10 集中度的<span className="text-ink-300">分子</span>，
        最右列「占流通盘」＝ 中间那列 ÷（总量 − 池/销毁/锁仓），
        才是<span className="text-ink-300">最终显示的那个 Top10 集中度</span>。
        最外层那条线含锁仓所以看着很吓人 —— 那部分卖不掉。
      </p>
    </div>
  );
}

/**
 * 全量持有人明细（分页 / 搜索 / 分类筛选 / CSV 导出 / 含空账户切换）。
 *
 * 几千到几万行不可能一次渲染完，所以：
 * - 页面不自动请求，用户点「加载全部持有人」才拉第一页（避免每次扫描都拖着大请求）；
 * - 分页与筛选都在服务端做，浏览器一次只拿一页；
 * - CSV 由服务端生成（当前筛选下的**全量**行，不是当前页）。
 */
function AllHoldersSection({ report }: { report: ScanReport }) {
  const mint = report.token.mint;
  const m = report.dimensions.holders?.metrics;
  const overview = (m?.overview ?? undefined) as HolderOverview | undefined;

  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [q, setQ] = useState('');
  const [kinds, setKinds] = useState<string[]>([]);
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [rows, setRows] = useState<HolderRow[]>([]);
  const [meta, setMeta] = useState<{ filtered: number; totalOwners: number; pageSize: number; source: string; truncated: boolean } | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ mint, page: String(page), pageSize: String(pageSize) });
    if (q.trim()) p.set('q', q.trim());
    if (kinds.length > 0) p.set('kind', kinds.join(','));
    if (includeEmpty) p.set('includeEmpty', '1');
    return p.toString();
  }, [mint, page, pageSize, q, kinds, includeEmpty]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch(`/api/holders?${query}`)
        .then(async (res) => {
          const j = await res.json();
          if (!res.ok) throw new Error(j?.error ?? `加载失败（HTTP ${res.status}）`);
          if (!alive) return;
          setRows(j.rows as HolderRow[]);
          setMeta(j.meta);
        })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, query]);

  if (!overview) return null;

  const KIND_LABEL: Record<string, string> = {
    pool: '池',
    burn: '销毁',
    timelock: '锁仓',
    custody: '托管',
    dev: 'creator',
    related: '关联',
    sniper: '狙击',
    retail: '散户',
  };
  const totalPages = meta ? Math.max(1, Math.ceil(meta.filtered / meta.pageSize)) : 1;
  const csvHref = `/api/holders?${query}&format=csv`;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-300">全部持有人明细</h2>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs text-ink-100 transition hover:bg-accent/20"
          >
            加载全部持有人（{overview.accountsTotal.toLocaleString()} 个账户 / {overview.ownersWithBalance.toLocaleString()} 个地址）
          </button>
        )}
      </div>

      {open && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="搜索地址前缀…"
              className="w-56 rounded-lg border border-ink-600 bg-ink-950 px-2.5 py-1.5 font-mono text-[11px] text-ink-200 outline-none placeholder:text-ink-600 focus:border-accent/60"
            />
            <div className="flex flex-wrap items-center gap-1">
              {Object.entries(KIND_LABEL).map(([k, label]) => {
                const on = kinds.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setKinds((prev) => (on ? prev.filter((x) => x !== k) : [...prev, k]));
                      setPage(1);
                    }}
                    className={`rounded-md border px-2 py-1 text-[10px] transition ${
                      on ? 'border-accent/60 bg-accent/15 text-ink-100' : 'border-ink-700 text-ink-400 hover:text-ink-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-1 text-[10px] text-ink-400">
              <input
                type="checkbox"
                checked={includeEmpty}
                onChange={(e) => {
                  setIncludeEmpty(e.target.checked);
                  setPage(1);
                }}
              />
              含已清空账户
            </label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-ink-600 bg-ink-950 px-2 py-1.5 text-[11px] text-ink-200 outline-none"
            >
              {[20, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  每页 {n}
                </option>
              ))}
            </select>
            <a
              href={csvHref}
              className="rounded-lg border border-ink-600 px-2.5 py-1.5 text-[11px] text-ink-300 transition hover:text-ink-100"
            >
              ← 导出 CSV（当前筛选）
            </a>
          </div>

          {error && (
            <div className="rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs text-ink-300">{error}</div>
          )}

          <div className="overflow-hidden rounded-xl border border-ink-700">
            <table className="w-full text-left text-xs">
              <thead className="bg-ink-900/60 text-ink-400">
                <tr>
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">地址</th>
                  <th className="px-3 py-2 text-right font-medium">数量</th>
                  <th className="px-3 py-2 text-right font-medium">占总供应</th>
                  <th className="px-3 py-2 font-medium">分类</th>
                  <th className="px-3 py-2 font-medium">计入集中度</th>
                  <th className="px-3 py-2 text-right font-medium">账户数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {rows.map((h, i) => (
                  <tr key={h.address} className={h.counted ? 'bg-ink-950/40' : 'bg-ink-900/30 text-ink-400'}>
                    <td className="px-2 py-2 font-mono text-ink-500">{(page - 1) * pageSize + i + 1}</td>
                    <td className="px-3 py-2 font-mono">
                      <a
                        href={`https://solscan.io/account/${h.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ink-200 underline decoration-ink-700 hover:text-safe"
                        title={h.address}
                      >
                        {shortAddr(h.address)}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-300">{num(h.amount)}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-200">{num(h.pct)}%</td>
                    <td className="px-3 py-2">
                      <span className={h.kind === 'dev' ? 'text-danger' : h.kind === 'related' || h.kind === 'sniper' ? 'text-warn' : h.counted ? 'text-ink-300' : 'text-ink-400'}>
                        {KIND_LABEL[h.kind] ?? h.kind}
                      </span>
                    </td>
                    <td className="px-3 py-2">{h.counted ? '是' : <span className="text-ink-500">否</span>}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-400">{h.accounts ?? 1}</td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-ink-500">
                      没有符合条件的记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-400">
            <span className="font-mono">
              {loading ? '加载中…' : meta ? `共 ${meta.filtered.toLocaleString()} 行（全量 ${meta.totalOwners.toLocaleString()} 个地址）` : ''}
              {meta?.truncated && ' · ⚠️ 数据未取全'}
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-ink-700 px-2 py-1 transition hover:text-ink-100 disabled:opacity-40"
              >
                上一页
              </button>
              <span className="font-mono">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-ink-700 px-2 py-1 transition hover:text-ink-100 disabled:opacity-40"
              >
                下一页
              </button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * 钻石手明细。
 *
 * 「钻石手 3 个」单独出现时无法核对，所以逐行给出：地址、持有时长、买入次数与金额、
 * 是否落在最早窗口内（决定这条证据有多强）、当前持仓占比。地址链到 Solscan。
 *
 * ⚠️ 这个区块刻意**不给**「所以可以买」这类结论 —— 它只描述筹码结构。
 * 新发币天然没人卖过，把「拿得住」当利好会让评分偏向新币。
 */
function DiamondSection({ report }: { report: ScanReport }) {
  const m = report.dimensions.diamond?.metrics;
  const info = m as unknown as DiamondInfo | undefined;
  const rows = Array.isArray(info?.evidence) ? (info.evidence as DiamondEvidence[]) : [];
  if (!info || info.analyzedWallets === undefined) return null;

  const coverageLow = (info.windowCoveragePct ?? 0) < THRESHOLDS.diamond.minWindowCoveragePct;
  const KIND_LABEL: Record<string, string> = {
    pool: '池',
    burn: '销毁',
    timelock: '锁仓',
    custody: '托管',
    dev: 'creator',
    related: '关联',
    sniper: '狙击',
    retail: '散户',
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-300">钻石手（持仓行为）</h2>
        <span className="font-mono text-[10px] text-ink-500">
          {info.diamondHands} / {info.analyzedWallets} 个可分析钱包 · 窗口覆盖 {num(info.windowCoveragePct)}%
        </span>
      </div>

      {coverageLow && (
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs leading-relaxed text-ink-300">
          ⚠️ 成交窗口只覆盖了 <span className="font-mono text-warn">{num(info.windowCoveragePct)}%</span> 的时间跨度
          {info.gapDays !== undefined && <>（中间缺 <span className="font-mono">{info.gapDays}</span> 天）</>}
          ，所以下面的**只是窗口内的观测值，几乎肯定低估**：缺口期间买入并一直持有的钱包不在样本里。
          「没看到卖」≠「没卖过」。
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="钻石手"
          value={`${info.diamondHands ?? '—'}`}
          sub={`占可分析钱包 ${num(info.sharePct)}%`}
        />
        <Stat
          label="中位持有时长"
          value={info.medianHoldDays !== undefined ? `${num(info.medianHoldDays)} 天` : '—'}
          sub={info.medianHoldDays !== undefined ? '首次买入至今' : '没有符合条件的钱包'}
        />
        <Stat
          label="证据最强（最早窗口内）"
          value={`${info.strongEvidenceCount ?? 0}`}
          sub="覆盖时间最长的那批"
        />
        <Stat
          label="有加仓行为"
          value={`${info.addOnCount ?? 0}`}
          sub={`买入 ≥ ${THRESHOLDS.diamond.addOnBuys} 次`}
        />
      </div>

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-ink-900/60 text-ink-400">
              <tr>
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">钱包</th>
                <th className="px-3 py-2 text-right font-medium">持有时长</th>
                <th className="px-3 py-2 text-right font-medium">买入次数</th>
                <th className="px-3 py-2 text-right font-medium">买入金额</th>
                <th className="px-3 py-2 font-medium">证据强度</th>
                <th className="px-3 py-2 text-right font-medium">当前占比</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {rows.map((h, i) => (
                <tr key={h.address} className="bg-ink-950/40">
                  <td className="px-2 py-2 font-mono text-ink-500">{i + 1}</td>
                  <td className="px-3 py-2 font-mono">
                    <a
                      href={`https://solscan.io/account/${h.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ink-200 underline decoration-ink-700 hover:text-safe"
                      title={h.address}
                    >
                      {shortAddr(h.address)}
                    </a>
                    {h.kind && h.kind !== 'retail' && (
                      <span className="ml-1.5 rounded bg-ink-800 px-1 py-0.5 text-[9px] text-warn">
                        {KIND_LABEL[h.kind] ?? h.kind}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-200">{num(h.holdDays)} 天</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-300">
                    {h.buys}
                    {h.added && <span className="ml-1 text-[9px] text-safe">加仓</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-300">{num(h.buySol)} SOL</td>
                  <td className="px-3 py-2 text-[10px]">
                    {h.inEarlyWindow ? (
                      <span className="text-safe">最早窗口内</span>
                    ) : (
                      <span className="text-ink-500" title="首次买入落在最近窗口里：没卖只是因为刚买">
                        窗口内新进
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-300">
                    {h.holderPct !== undefined ? `${num(h.holderPct)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border border-ink-700 bg-ink-900/40 p-3 text-xs text-ink-400">
          在 {info.analyzedWallets} 个可分析钱包里，没有找到符合「只买未卖 + 仍持仓 + 持有 ≥{' '}
          {THRESHOLDS.diamond.minHoldDays} 天」的地址。
          {coverageLow && '（窗口覆盖不足，这个结论很可能是漏，而不是真的没有。）'}
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-ink-400">
        口径：只统计成交窗口里出现过的 {info.tradesAnalyzed} 笔成交（最近 100 笔 + 最早{' '}
        {THRESHOLDS.liquidity.sniperWindowTrades} 笔，按交易去重，中间的历史没拉到）；已排除 creator / 关联钱包{' '}
        {info.excludedCount} 个、高频机器人 {info.robotCount} 个；「仍持仓」用全量持有人枚举的余额交叉验证，
        卖光的不算。
        <span className="text-ink-300">本维度权重为 0，不参与总分</span> ——
        它描述筹码在谁手里，不回答该不该买；新币天然没人卖过，拿得住不等于利好。
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
