'use client';

import { useEffect, useMemo, useState } from 'react';

import { DEFAULT_TAB, TAB_META as T } from './reportTabs';
import type { ReactNode } from 'react';

import { DIMENSION_ORDER, HOLDER_KIND_LABELS, SEVERITY_ORDER } from '@/core/constants';

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
  SellPressureInfo,
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
        {!meta.live && (
          <span className="rounded border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] text-warn">
            数据源异常 · 结果不完整
          </span>
        )}
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


/**
 * 报告分页容器。
 *
 * 为什么分页：报告有 9 个区块（含两张可分页的大表 + 一个 2 分钟的深度分析入口），
 * 平铺成一页要滚很久，而且「找抛压」要在十几屏里翻。
 *
 * ⚠️ 顶部结论卡（分数 / 仓位 / 硬否决）**不在**任何 tab 里 —— 它是常驻的。
 * 硬否决是「一票判死」的结论，藏进默认不可见的 tab 等于没显示。
 *
 * `hidden` 用 CSS 而不是条件渲染：切回某个 tab 时，用户已经输入过的搜索词、
 * 翻到的页码、展开的详情都会保留，不会因为切换而重置。
 */
export interface TabDef {
  key: string;
  label: string;
  /** 右上角的计数徽标（比如「43 项」）；没有就不显示 */
  badge?: string;
  /**
   * `switchTab` 让 tab 内部能跳到别的 tab（比如概览里指向「数据来源」的链接）。
   * 传进来而不是让子组件自己管状态：tab 状态必须只有一份，
   * 否则「跳转过去」和「点 tab 切过去」会变成两个互不同步的状态。
   */
  render: (switchTab: (key: string) => void) => React.ReactNode;
}

function ReportTabs({ tabs }: { tabs: TabDef[] }) {
  // 默认 tab 由 reportTabs.ts 的 DEFAULT_TAB 决定（有测试锁住「必须是概览」）
  const [active, setActive] = useState(
    tabs.find((t) => t.key === DEFAULT_TAB)?.key ?? tabs[0]?.key ?? '',
  );
  const current = tabs.find((x) => x.key === active) ?? tabs[0];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="报告分区"
        className="flex flex-wrap gap-1 rounded-xl border border-ink-700 bg-ink-900/60 p-1"
      >
        {tabs.map((tab) => {
          const on = tab.key === current?.key;
          return (
            <button
              key={tab.key}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`panel-${tab.key}`}
              onClick={() => setActive(tab.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition ${
                on
                  ? 'bg-ink-700/70 font-semibold text-ink-100'
                  : 'text-ink-400 hover:bg-ink-800/60 hover:text-ink-200'
              }`}
            >
              {tab.label}
              {tab.badge && (
                <span
                  className={`rounded px-1 py-0.5 font-mono text-[9px] ${
                    on ? 'bg-ink-900 text-ink-300' : 'bg-ink-800 text-ink-500'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 所有面板都渲染，用 hidden 切换 —— 保留用户在表里的输入与页码 */}
      {tabs.map((tab) => (
        <div
          key={tab.key}
          id={`panel-${tab.key}`}
          role="tabpanel"
          hidden={tab.key !== current?.key}
          className="space-y-4"
        >
          {tab.render((key) => setActive(key))}
        </div>
      ))}
    </div>
  );
}

export function Report({
  report,
  onForceOverview,
  forcing,
  onRunDeep,
  deepPending,
}: {
  report: ScanReport;
  /** 点「按需加载全量分布」时重新扫描（带 forceOverview） */
  onForceOverview?: () => void;
  forcing?: boolean;
  /** 触发深度分析（逐地址拉完整历史，算出真实成本） */
  onRunDeep?: () => void;
  deepPending?: boolean;
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

      <ReportTabs
        tabs={[
          {
            key: T.overview.key,
            label: T.overview.label,
            render: (switchTab) => (
              <>
              {/* ── 雷达图 + 各维度得分 ──────────────────────────────── */}
          {/*
            ⚠️ 这里**只给分数，不给细节数字**。
            细节（Top10 占比、净流入、卖单额…）统一放在「数据来源」tab 的
            「逐项体检明细」里 —— 同一批数字出现在两个 tab 会被读成两套结论，
            而且改口径时容易只改一处。
          */}
          <section className="grid gap-4 lg:grid-cols-[300px_1fr]">
            <div className="flex flex-col items-center justify-center rounded-xl border border-ink-700 bg-ink-900/60 p-4">
              <RadarChart scores={scores} missing={missing} />
              <p className="mt-1 text-center text-[11px] leading-relaxed text-ink-400">
                半径越大风险越高 · 灰色「无数据」表示该维度未采集
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {DIMENSION_ORDER.map((key) => {
                const d = report.dimensions[key];
                if (!d) return null;
                const m = d.metrics ?? {};
                const noData = m.available === 0;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900/60 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-300">{d.label}</span>
                      {d.vetoed && (
                        <span className="rounded bg-danger/20 px-1.5 py-0.5 font-mono text-[9px] text-danger">
                          否决
                        </span>
                      )}
                      {!d.vetoed && noData && (
                        <span className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[9px] text-ink-400">
                          无数据
                        </span>
                      )}
                    </div>
                    <span
                      className="font-mono text-xl font-semibold"
                      style={{
                        color: noData
                          ? 'var(--color-ink-400)'
                          : d.score >= 45
                            ? 'var(--color-danger)'
                            : d.score >= 25
                              ? 'var(--color-warn)'
                              : 'var(--color-safe)',
                      }}
                    >
                      {noData ? '—' : d.score.toFixed(0)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>


          {/* ── 以下是依据（分数在上、依据在下） ──────────────────── */}
          <div className="flex items-center gap-3 pt-2">
            <div className="h-px flex-1 bg-ink-700" />
            <span className="text-[10px] tracking-wide text-ink-500">以下是每个维度的依据</span>
            <div className="h-px flex-1 bg-ink-700" />
          </div>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-ink-300">逐项体检明细</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {DIMENSION_ORDER.map((key) => {
                const d = report.dimensions[key];
                return d ? <DimensionCard key={key} d={d} /> : null;
              })}
            </div>
          </section>
                <Provenance report={report} />
              </>
            ),
          },
          {
            key: T.holders.key,
            label: T.holders.label,
            // 徽标用「有余额的持有人数」，没有就退回到「地址数」；都没有则不给徽标
            ...(() => {
              const hm = report.dimensions.holders?.metrics;
              const n = Number(hm?.circulatingCount ?? hm?.holderCount);
              return Number.isFinite(n) && n > 0 ? { badge: `${n}` } : {};
            })(),
            render: () => (
              <>
                <CustodySection report={report} />
                <HoldersOverviewSection
                  report={report}
                  onForceOverview={onForceOverview}
                  forcing={forcing}
                />
                <TopHoldersSection report={report} />
                <AllHoldersSection report={report} />
              </>
            ),
          },
          {
            key: T.flow.key,
            label: T.flow.label,
            render: () => (
              <>
                <LargeSellsSection report={report} />
              </>
            ),
          },
          {
            key: T.behavior.key,
            label: T.behavior.label,
            render: () => (
              <>
                <DiamondSection report={report} />
                <SellPressureSection
                  report={report}
                  onRunDeep={onRunDeep}
                  deepPending={deepPending}
                />
              </>
            ),
          },
        ]}
      />

      <p className="rounded-lg border border-ink-700 bg-ink-900/40 px-4 py-3 text-xs leading-relaxed text-ink-400">
        由链上与公开数据自动生成，<span className="text-ink-300">不构成投资建议</span>。
        评分低只代表「未发现明显问题」，不代表安全 —— meme 币归零是常态。
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

  // 分类名统一来自 constants（之前这里有一份副本，改名字会漏改）
  const KIND_LABEL: Record<HolderRow['kind'], string> = Object.fromEntries(
    Object.entries(HOLDER_KIND_LABELS).map(([k, v]) => [k, v.long]),
  ) as Record<HolderRow['kind'], string>;
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
        以下是**能核对到的**前 20 名，不代表只有 20 个持有人。
        「计入集中度 = 否」的三类（池、销毁、锁仓）已从 Top10 与巨鲸判断中剔除；
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
          {overview.truncated ? '⚠️ 未取全' : '已取全'}
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
        按 **owner 合并**统计（同一钱包的多个持币账户算一个人）：
        账户 {overview.accountsTotal.toLocaleString()} 个、有余额 {overview.accountsWithBalance.toLocaleString()} 个
        {overview.reportedHolders !== undefined && <>、RugCheck 报 {overview.reportedHolders.toLocaleString()} 个</>}
        {twoCaliber && <> —— <span className="text-warn">口径对不上，差额不做推断</span></>}。
        剔除池 / 销毁 / 锁仓 {num(overview.excludedPct)}%，枚举覆盖总量 {num(overview.coveredPct)}%
        {overview.coveredPct < 99 && '（不到 100%，分布不完整）'}。
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

  const KIND_LABEL: Record<string, string> = Object.fromEntries(
    Object.entries(HOLDER_KIND_LABELS).map(([k, v]) => [k, v.short]),
  );
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
        样本 {info.tradesAnalyzed} 笔成交（最近 100 笔 + 最早 {THRESHOLDS.liquidity.sniperWindowTrades} 笔）；
        已排除 creator / 关联钱包 {info.excludedCount} 个、高频机器人 {info.robotCount} 个；卖光的不算。
        <span className="text-ink-300">权重为 0，不参与总分</span> ——
        它描述筹码在谁手里，不回答该不该买；拿得住不等于利好。
      </p>
    </section>
  );
}

/**
 * 抛压分布。
 *
 * 回答的问题：**这些还没卖的筹码，在什么价位、还有多少、谁拿着**。
 *
 * 三条口径必须印在界面上，否则这张图会被读成「全部筹码的抛压」：
 * - 只覆盖窗口内**能配对出成本**的那部分成交（实测某币 100 笔里只有 42 笔能配对）；
 * - 已卖光（≥90%）的钱包不计入抛压 —— 已经跑掉的筹码不会再来砸盘；
 * - 卖了一半的按剩余部分折算，未卖量与实际余额不一致时取较小值（保守）。
 */
function SellPressureSection({
  report,
  onRunDeep,
  deepPending,
}: {
  report: ScanReport;
  onRunDeep?: () => void;
  deepPending?: boolean;
}) {
  const m = report.dimensions.sellPressure?.metrics;
  const info = m as unknown as SellPressureInfo | undefined;
  if (!info || info.walletsAnalyzed === undefined) return null;
  const hasDeep = (info.deepWallets ?? 0) > 0;

  const baseBuckets = info.priceSol !== undefined ? info.buckets : (info.costBuckets ?? []);
  const maxShare = Math.max(0.0001, ...baseBuckets.map((b) => b.pctOfCirculating));
  const byPnl = info.priceSol !== undefined;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-300">抛压分布（还没卖的筹码在什么价位）</h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-ink-500">
            {byPnl
              ? `现价 ${info.priceSol!.toExponential(2)} SOL/枚（窗口内最近成交反推）`
              : info.priceNote ?? '现价不可用'}
          </span>
          {onRunDeep && (
            <button
              type="button"
              onClick={onRunDeep}
              disabled={deepPending}
              title="逐地址拉取前 50 名持有人的完整历史，算出真实成本（实测约 2 分钟）"
              className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deepPending ? '深度分析中…' : hasDeep ? '重新深度分析' : '深度分析（约 2 分钟）'}
            </button>
          )}
        </div>
      </div>

      {hasDeep ? (
        <div className="rounded-xl border border-safe/30 bg-safe/5 p-3 text-xs leading-relaxed text-ink-300">
          ✓ 已用<span className="text-safe">完整历史</span>计算 {info.deepWallets} 个钱包的成本（覆盖前{' '}
          {info.deepAddresses} 名持有人）—— 这些行不受成交窗口缺口影响，是**真实成本与真实已卖比例**。
          其余行仍是窗口估算。表里用「完整历史 / 窗口估算」标出区别。
        </div>
      ) : (
        <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-3 text-xs leading-relaxed text-ink-400">
          当前成本是<span className="text-ink-300">成交窗口估算</span>：窗口只覆盖一部分时间跨度，
          所以未卖筹码会被低估。点右上角「深度分析」可逐地址拉完整历史（约 2 分钟），
          把成本换成真实值 —— 实测某币可分析钱包从 14 个升到 43 个、
          未卖筹码从 1.0% 升到 12.4% 流通盘。深度只覆盖前 50 名持有人，
          但那已经代表约 91% 的持仓筹码（实测 91.2%；扩到前 200 名也只多 4.2 个百分点）。
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="未卖筹码（可分析部分）"
          value={`${num(info.unsoldPctOfCirculating)}%`}
          sub={`流通盘占比 · ${num(info.totalUnsoldTokens)} 枚`}
        />
        <Stat
          label="按成本折算"
          value={`${num(info.totalCostSol)} SOL`}
          sub="这些钱包当初投入的本金"
        />
        <Stat
          label="可分析钱包"
          value={`${info.walletsAnalyzed}`}
          sub={
            info.deepWallets > 0
              ? `其中 ${info.deepWallets} 个用完整历史`
              : `成交配对率 ${num(info.attributionPct)}%`
          }
        />
        <Stat
          label="已出走 / 派发中"
          value={`${info.exitedWallets} / ${info.distributingWallets}`}
          sub="已卖光的不算抛压"
        />
      </div>

      {info.attributionPct !== undefined && info.attributionPct < 50 && (
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs leading-relaxed text-ink-300">
          ⚠️ 窗口内只有 <span className="font-mono text-warn">{num(info.attributionPct ?? 0)}%</span> 的成交能配对出成本
          （其余交易的代币变动记在别的账户上，无法归因到买家）。
          <span className="text-warn">下面的分布只覆盖一小部分筹码，不是全貌。</span>
        </div>
      )}

      {baseBuckets.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-ink-900/60 text-ink-400">
              <tr>
                <th className="px-3 py-2 font-medium">{byPnl ? '相对现价的盈亏区间' : '买入成本区间'}</th>
                <th className="px-3 py-2 text-right font-medium">钱包数</th>
                <th className="px-3 py-2 text-right font-medium">未卖筹码</th>
                <th className="px-3 py-2 text-right font-medium">{byPnl ? '占流通盘' : '占可分析筹码'}</th>
                <th className="px-3 py-2 font-medium">分布</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {baseBuckets.map((b) => (
                <tr key={b.label} className="bg-ink-950/40">
                  <td className="px-3 py-2 text-ink-300">{b.label}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-200">{b.wallets}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-300">{num(b.unsoldTokens)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-200">{num(b.pctOfCirculating)}%</td>
                  <td className="px-3 py-2">
                    <div className="h-1.5 w-full max-w-32 overflow-hidden rounded bg-ink-800">
                      <div
                        className="h-full bg-warn"
                        style={{ width: `${Math.min(100, (b.pctOfCirculating / maxShare) * 100).toFixed(1)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {info.topHoldersAtProfit.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <div className="border-b border-ink-800 bg-ink-900/60 px-3 py-2 text-[10px] text-ink-400">
            浮盈且仍有筹码的钱包（未卖量从大到小）—— 这些是最有动机卖出的一批
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-ink-900/40 text-ink-400">
              <tr>
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">钱包</th>
                <th className="px-3 py-2 text-right font-medium">成本</th>
                <th className="px-3 py-2 text-right font-medium">盈亏</th>
                <th className="px-3 py-2 text-right font-medium">未卖</th>
                <th className="px-3 py-2 text-right font-medium">已卖</th>
                <th className="px-3 py-2 font-medium">最后成交 / 成本来源</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {info.topHoldersAtProfit.map((w, i) => (
                <tr key={w.address} className="bg-ink-950/40">
                  <td className="px-2 py-2 font-mono text-ink-500">{i + 1}</td>
                  <td className="px-3 py-2 font-mono">
                    <a
                      href={`https://solscan.io/account/${w.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ink-200 underline decoration-ink-700 hover:text-safe"
                      title={w.address}
                    >
                      {shortAddr(w.address)}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-400">{w.avgCostSol.toExponential(2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-safe">
                    +{w.pnlPct >= 1000 ? w.pnlPct.toFixed(0) : w.pnlPct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-200">{num(w.unsoldTokens)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-400">{num(w.soldPct)}%</td>
                  <td className="px-3 py-2 text-[10px] text-ink-500">
                    {w.lastTs ? new Date(w.lastTs * 1000).toISOString().slice(0, 10) : '—'}
                    {w.source === 'deep' ? (
                      <span className="ml-1 text-safe" title="逐地址完整历史算出，不受窗口缺口影响">
                        完整历史
                      </span>
                    ) : (
                      <span className="ml-1 text-ink-600" title="成交窗口估算，可能低估未卖量">
                        窗口估算
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {info.mintedWallets > 0 && (
        <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-3 text-xs leading-relaxed text-ink-400">
          另有 <span className="font-mono text-ink-200">{info.mintedWallets}</span> 个地址的筹码是
          <span className="text-ink-300">创建/铸造获得的</span>（约 {num(info.mintedUnsoldTokens)} 枚，只付了网络手续费），
          <span className="text-ink-300">没有买入价</span>，因此不计入上面的盈亏分桶 ——
          把手续费当成本会算出「浮盈几十万%」这种假数字。
          这类筹码在任何价位卖出都是纯利润。
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-ink-400">
        口径：{info.windowNote}
        盈亏按「最近一笔成交反推」的现价计算，<span className="text-ink-300">不是实时行情价</span>；
        超过 {Math.round(THRESHOLDS.sellPressure.maxPriceAgeSec / 3600)} 小时的陈旧价格会停用这一栏。
        本维度权重为 0，不参与总分。
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
