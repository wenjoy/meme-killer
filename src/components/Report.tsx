'use client';

import { useEffect, useMemo, useState } from 'react';

import { DEFAULT_TAB, TAB_META as T } from './reportTabs';
import type { ReactNode } from 'react';

import { DIMENSION_ORDER, HOLDER_KIND_LABELS, SEVERITY_ORDER } from '@/core/constants';
import { useI18n } from '@/i18n';
import { localizeFinding, localizeWarning } from '@/i18n/finding';
import { track } from './analytics';

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

/**
 * 维度名本地化。
 *
 * 分析器给的 `d.label` 是中文（`社交热度`）。这里按 `dimensions.<key>` 查表，
 * 查不到就回退到分析器给的中文 —— 和结论文案一样的原则：**不漏成空**。
 */
function dimLabel(key: string, fallback: string, t: (k: string) => string): string {
  const k = `dimensions.${key}`;
  const v = t(k);
  return v === k ? fallback : v;
}

/** 维度名的 React 版本（供各处复用） */
function useDimLabel() {
  const { t } = useI18n();
  return (key: string, fallback: string) => dimLabel(key, fallback, t);
}

/**
 * 盈亏分桶的标签本地化。
 *
 * 分桶的 min/max 来自 constants（逻辑），label 只是展示 —— 所以查
 * `report.common.pnlBuckets.<key>`，缺 key 时回退到分析器给的中文。
 */
function bucketLabel(
  b: { key?: string; label: string },
  t: ((k: string) => string) | null,
): string {
  if (!b.key || !t) return b.label;
  const k = `report.common.pnlBuckets.${b.key}`;
  const v = t(k);
  return v === k ? b.label : v;
}


/**
 * 抛压「口径说明」整句。
 *
 * 分析器给的是数字（windowNoteParts），措辞在这里按当前语言组装 ——
 * 因为这句话要被插进 `note1` 的中间（「口径：{note} 盈亏按…」），
 * 中英文语序不同，不能靠拼接。缺译文时退回分析器的中文整句。
 *
 * 与 `src/i18n/finding.ts` 的组合句是同一套做法（分析器只给结构化数据）。
 */
function sellPressureWindowNote(
  t: (key: string, params?: Record<string, string | number>) => string,
  info: SellPressureInfo,
): string {
  const p = info.windowNoteParts;
  if (!p) return info.windowNote;
  const K = 'pieces.sellPressure.windowNote';
  const main = t(K, {
    deepPart: p.deepWallets > 0 ? t(`${K}.deepPart`, { n: p.deepWallets }) : '',
    paired: p.paired,
    total: p.total,
  });
  // t() 缺 key 时返回 key 本身 → 用这个特性判断有没有译文
  return main === K ? info.windowNote : main;
}


/**
 * 池标签本地化。
 *
 * 池地址的标签来自 provider（如 'RugCheck 池/金库账户'），带中文。
 * provider 同时给出 `labelKey`（`pieces.poolLabels.*`），这里优先查字典，
 * 查不到才用中文回退 —— 与 Finding / Warning 同一套约定。
 */
function poolLabel(
  t: (key: string) => string,
  label: string,
  labelKey?: string,
): string {
  if (!labelKey) return label;
  const k = `pieces.poolLabels.${labelKey}`;
  const v = t(k);
  return v === k ? label : v;
}

function FindingRow({ f }: { f: Finding }) {
  const { t } = useI18n();
  // 把结构化结论（id + params）渲染成当前语言的文案。
  // 所有维度明细都经过这个组件 —— 所以这里是唯一的本地化入口。
  const loc = localizeFinding(f, t);
  const s = SEVERITY_STYLE[f.severity];
  return (
    <li className={`flex gap-2.5 rounded-md border px-3 py-2 ${s.border} ${s.bg}`}>
      <span className={`mt-0.5 shrink-0 font-mono text-xs ${s.text}`}>{s.mark}</span>
      <div className="min-w-0">
        <p className={`text-[13px] font-medium ${s.text}`}>
          {loc.title}
          {f.veto && (
            <span className="ml-2 rounded bg-danger/20 px-1.5 py-0.5 font-mono text-[10px] text-danger">
              {t('verdict.vetoed')}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-300">{loc.detail}</p>
      </div>
    </li>
  );
}

function DimensionCard({ d }: { d: DimensionResult }) {
  const { t } = useI18n();
  const unavailable = d.metrics?.available === 0;
  const findings = [...d.findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink-200">{dimLabel(d.dimension, d.label, t)}</h3>
          {d.error && (
            <span className="rounded bg-danger/15 px-1.5 py-0.5 font-mono text-[10px] text-danger">
              {t('report.common.dimFailed')}
            </span>
          )}
          {!d.error && unavailable && (
            <span className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
              {t('verdict.dataMissing')}
            </span>
          )}
          {d.vetoed && (
            <span className="rounded bg-danger/20 px-1.5 py-0.5 font-mono text-[10px] text-danger">
              {t('verdict.vetoed')}
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
  const { t } = useI18n();
  const { meta } = report;
  const ORIGIN_LABEL: Record<string, { text: string; tone: string }> = {
    onchain: { text: t('report.provenance.onchain'), tone: 'text-safe' },
    dexscreener: { text: 'DexScreener', tone: 'text-accent' },
    rugcheck: { text: 'RugCheck', tone: 'text-accent' },
    heuristic: { text: t('report.provenance.heuristic'), tone: 'text-warn' },
    unavailable: { text: t('report.provenance.unavailable'), tone: 'text-ink-400' },
  };

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold text-ink-300">{t('sections.provenance')}</span>
        {!meta.live && (
          <span className="rounded border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] text-warn">
            {t('report.provenance.anomalous')}
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
            {t('report.provenance.warnings', { n: meta.warnings.length })}
          </summary>
          <ul className="mt-2 space-y-1">
            {meta.warnings.map((w, i) => (
              <li key={i} className="border-l-2 border-warn/40 pl-2 text-xs leading-relaxed text-ink-300">
                {localizeWarning(w, t)}
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
  const { t } = useI18n();
  // 默认 tab 由 reportTabs.ts 的 DEFAULT_TAB 决定（有测试锁住「必须是概览」）
  const [active, setActive] = useState(
    tabs.find((t) => t.key === DEFAULT_TAB)?.key ?? tabs[0]?.key ?? '',
  );
  const current = tabs.find((x) => x.key === active) ?? tabs[0];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={t('report.common.reportTabs')}
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
              onClick={() => {
                setActive(tab.key);
                // 记 tab 使用分布 —— 这是「哪个功能真被用」最直接的证据
                track('tab_view', undefined, { tab: tab.key });
              }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition ${
                on
                  ? 'bg-ink-700/70 font-semibold text-ink-100'
                  : 'text-ink-400 hover:bg-ink-800/60 hover:text-ink-200'
              }`}
            >
              {t(`tabs.${tab.key}`) === `tabs.${tab.key}` ? tab.label : t(`tabs.${tab.key}`)}
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
  // 注意：这个组件里 `t` 已被用作 token 的别名，所以 i18n 用 `tr`
  const { t: tr } = useI18n();
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
                {t.symbol ?? tr('verdict.unknownToken')}
                {t.name && t.name !== t.symbol && (
                  <span className="ml-2 text-sm font-normal text-ink-400">{t.name}</span>
                )}
              </h2>
              <span className={`rounded-md border ${tone.border} px-2.5 py-1 text-sm font-semibold ${tone.text}`}>
                {report.band.labelKey ? tr(report.band.labelKey) : report.band.label} ·{' '}
                {report.band.verdictKey ? tr(report.band.verdictKey) : report.band.verdict}
              </span>
            </div>

            <p className="mt-2 font-mono text-[11px] break-all text-ink-400">{t.mint}</p>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-xs text-ink-400">{tr('verdict.adviceSize')}</span>
              <span className={`font-mono text-2xl font-bold ${tone.text}`}>{report.advice.size}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-300">
              {report.advice.key
                ? tr(report.advice.key, report.advice.params) === report.advice.key
                  ? report.advice.text
                  : tr(report.advice.key, report.advice.params)
                : report.advice.text}
            </p>

            {(t.priceUsd !== undefined || t.marketCapUsd !== undefined) && (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-ink-400">
                {t.priceUsd !== undefined && (
                  <span>
                    {tr('verdict.price')} <span className="text-ink-200">${t.priceUsd.toPrecision(4)}</span>
                  </span>
                )}
                {t.marketCapUsd !== undefined && (
                  <span>
                    {tr('verdict.marketCap')} <span className="text-ink-200">${(t.marketCapUsd / 1000).toFixed(0)}K</span>
                  </span>
                )}
                {t.supply !== undefined && (
                  <span>
                    {tr('verdict.supply')}{' '}
                    <span className="text-ink-200">{(t.supply / 1e9).toFixed(2)}B</span>
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
              {tr('verdict.hardVetoes', { n: report.vetoes.length })}
            </p>
            <ul className="space-y-1.5">
              {report.vetoes.map((v, i) => {
                // 硬否决是整页最重要的结论，也必须走本地化 ——
                // 否则英文用户看到的正文是英文，但「为什么被否决」是中文。
                const loc = localizeFinding(v, tr);
                return (
                  <li key={i} className="text-xs leading-relaxed text-ink-200">
                    <span className="mr-1.5 rounded bg-danger/20 px-1.5 py-0.5 font-mono text-[10px] text-danger">
                      {tr(`dimensions.${v.dimension}`) === `dimensions.${v.dimension}`
                        ? v.dimension
                        : tr(`dimensions.${v.dimension}`)}
                    </span>
                    <span className="font-medium">{loc.title}</span>
                    <span className="text-ink-300"> —— {loc.detail}</span>
                  </li>
                );
              })}
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
                {tr('radar.note')}
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
                      <span className="text-xs text-ink-300">{dimLabel(d.dimension, d.label, tr)}</span>
                      {d.vetoed && (
                        <span className="rounded bg-danger/20 px-1.5 py-0.5 font-mono text-[9px] text-danger">
                          {tr('verdict.vetoed')}
                        </span>
                      )}
                      {!d.vetoed && noData && (
                        <span className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[9px] text-ink-400">
                          {tr('verdict.noData')}
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
            <span className="text-[10px] tracking-wide text-ink-500">{tr('sections.evidence')}</span>
            <div className="h-px flex-1 bg-ink-700" />
          </div>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-ink-300">{tr('sections.detail')}</h2>
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
        {tr('app.disclaimer')}
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
  const { t } = useI18n();
  const m = report.dimensions.liquidity?.metrics;
  const list = Array.isArray(m?.largeSells) ? (m.largeSells as LargeSellEvidence[]) : [];
  if (list.length === 0) return null;

  const total = list.reduce((s, x) => s + x.sol, 0);
  // 0 = 本次没取到最早成交；此时「不在最早 25 笔内」这句话不成立，必须换个说法
  const windowKnown = m?.earlyBuyerWindowKnown === undefined ? undefined : m.earlyBuyerWindowKnown === 1;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-300">
        {t('report.largeSells.title')}
        <span className="ml-2 font-normal text-ink-500">
          {t('report.largeSells.subtitle', {
            n: list.length,
            sol: total.toFixed(3),
            hint: t('report.common.solscanHint'),
          })}
        </span>
      </h2>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-ink-900/60 text-ink-400">
            <tr>
              <th className="px-3 py-2 font-medium">{t('report.largeSells.colTime')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('report.largeSells.colAmount')}</th>
              <th className="px-3 py-2 font-medium">{t('report.largeSells.colTrader')}</th>
              <th className="px-3 py-2 font-medium">{t('report.largeSells.colIdentity')}</th>
              <th className="px-3 py-2 font-medium">{t('report.largeSells.colHoldingNow')}</th>
              <th className="px-3 py-2 font-medium">{t('report.largeSells.colSignature')}</th>
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
                    <span className="text-danger">{t('report.largeSells.creator')}</span>
                  ) : s.earlyBuyerIndex !== undefined ? (
                    <span className="text-warn" title={t('report.largeSells.earlyBuyerTitle')}>
                      {t('report.largeSells.earlyBuyer', { n: s.earlyBuyerIndex + 1 })}
                    </span>
                  ) : windowKnown === false ? (
                    <span
                      className="text-ink-400"
                      title={t('report.largeSells.unknownTitle')}
                    >
                      {t('report.largeSells.unknownIdentity')}
                    </span>
                  ) : (
                    <span
                      className="text-ink-400"
                      title={t('report.largeSells.notInEarlyTitle')}
                    >
                      {t('report.largeSells.notInEarly')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono">
                  {s.holderPctNow === undefined ? (
                    <span className="text-ink-400">{t('report.largeSells.leftTop20')}</span>
                  ) : (
                    <span className={s.sniperNow ? 'text-warn' : 'text-ink-200'}>
                      {s.holderPctNow.toFixed(2)}%{s.sniperNow ? t('report.largeSells.sniperNow') : ''}
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
        {t('report.largeSells.note1')}
        <strong>{t('report.largeSells.noteBold1')}</strong>
        {t('report.largeSells.note2')}
        <strong>{t('report.largeSells.noteBold2')}</strong>
        {t('report.largeSells.note3')}
        <strong>{t('report.largeSells.noteBold3')}</strong>
        {t('report.largeSells.note4')}
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
  const { t } = useI18n();
  const m = report.dimensions.holders?.metrics;
  const list = Array.isArray(m?.custody) ? (m.custody as CustodyMetric[]) : [];
  if (list.length === 0) return null;

  const locks = list.filter((c) => c.kind === 'timelock');
  const others = list.filter((c) => c.kind !== 'timelock');

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-300">{t('sections.custody')}</h2>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-ink-900/60 text-ink-400">
            <tr>
              <th className="px-3 py-2 font-medium">{t('report.custody.colAddress')}</th>
              <th className="px-3 py-2 font-medium">{t('report.custody.colType')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('report.custody.colShare')}</th>
              <th className="px-3 py-2 font-medium">{t('report.custody.colUnlockAt')}</th>
              <th className="px-3 py-2 font-medium">{t('report.custody.colCounted')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {list.map((c) => (
              <tr key={c.address} className="bg-ink-950/40">
                <td className="px-3 py-2 font-mono text-ink-300">{shortAddr(c.address)}</td>
                <td className="px-3 py-2 text-ink-200">
                  {c.labelKey &&
                  t(`report.common.custodyPrograms.${c.labelKey}`) !==
                    `report.common.custodyPrograms.${c.labelKey}`
                    ? t(`report.common.custodyPrograms.${c.labelKey}`)
                    : c.label}
                </td>
                <td className="px-3 py-2 text-right font-mono text-ink-200">{num(c.pct)}%</td>
                <td className="px-3 py-2">
                  {c.kind !== 'timelock' ? (
                    <span className="text-ink-400">{t('report.custody.notTimelock')}</span>
                  ) : c.unlockAt ? (
                    <span className="text-warn">
                      {t('report.custody.firstUnlock', { date: c.unlockAt.slice(0, 10) })}
                      {c.unlockEndAt && (
                        <span className="block text-ink-400">
                          {t('report.custody.allUnlock', { date: c.unlockEndAt.slice(0, 10) })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span
                      className="text-ink-400"
                      title={t('report.custody.custodyTitle')}
                    >
                      {t('report.custody.pending')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {c.kind === 'timelock' ? (
                    <span className="text-safe">{t('report.custody.excluded')}</span>
                  ) : (
                    <span className="text-warn">{t('report.custody.transferable')}</span>
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
            {t('report.custody.noteTimelockExcluded')}
            {locks.some((l) => l.unlockAt) ? (
              <>
                {t('report.custody.noteUnlockSource')}
                <span className="text-ink-300">{t('report.custody.noteLinearRelease')}</span>
                {t('report.custody.noteNotAlwaysLocked')}
              </>
            ) : (
              <>
                {t('report.custody.noteUnreadable1')}
                <span className="text-ink-300">{t('report.custody.noteNotUnlocked')}</span>
                {t('report.custody.noteUnreadable2')}
              </>
            )}
          </>
        )}
        {locks.length > 0 && others.length > 0 && ' '}
        {others.length > 0 && (
          <>
            {t('report.custody.noteCustody1', { n: others.length })}
            <span className="text-ink-300">{t('report.custody.noteCustodyNotTimelock')}</span>
            {t('report.custody.noteCustody2')}
            <span className="text-warn">{t('report.custody.noteStillCounted')}</span>
            {t('report.custody.noteCustody3')}
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
  const { t } = useI18n();
  const m = report.dimensions.holders?.metrics;
  const rows = Array.isArray(m?.topHolders) ? (m.topHolders as HolderRow[]) : [];
  if (rows.length === 0) return null;

  // 分类名走字典（长名）。constants 里的 HOLDER_KIND_LABELS 只作中文语义基准，
  // 直接用它会让英文界面显示中文 —— 这里改成查 report.common.holderKinds.*。
  const KIND_LABEL = Object.fromEntries(
    Object.keys(HOLDER_KIND_LABELS).map((k) => [k, t(`report.common.holderKinds.${k}`)]),
  ) as Record<HolderRow['kind'], string>;
  const countedTop10 = rows.filter((r) => r.counted).slice(0, 10);
  const countedSum = countedTop10.reduce((s, r) => s + r.pct, 0);
  const circulatingPct = Number(m?.circulatingPct ?? 0);
  const top10IsSample = m?.top10Source !== 'full';
  const top10Source = top10IsSample
    ? t('report.topHolders.sourceSample')
    : t('report.topHolders.sourceFull');

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-300">{t('sections.topHolders')}</h2>
        <span className="font-mono text-[10px] text-ink-500">
          {t('report.topHolders.headline', {
            top10: num(m?.top10Pct),
            circ: num(circulatingPct),
            n: countedTop10.length,
            sum: num(countedSum),
          })}
          <span className="ml-1 text-ink-600">· {top10Source}</span>
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-400">
        {t('report.topHolders.note1', { circ: num(circulatingPct) })}
        {top10IsSample && (
          <span className="text-warn"> {t('report.topHolders.noteSample')}</span>
        )}
        。
      </p>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-ink-900/60 text-ink-400">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">{t('report.topHolders.colAddress')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('report.topHolders.colCount')}</th>
              <th className="px-3 py-2 text-right font-medium">
                {t('report.topHolders.colShareOfSupply')}
              </th>
              <th className="px-3 py-2 font-medium">{t('report.topHolders.colCategory')}</th>
              <th className="px-3 py-2 font-medium">{t('report.topHolders.colCounted')}</th>
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
                  {h.label && (
                    <span className="ml-1 text-ink-500">（{poolLabel(t, h.label, h.labelKey)}）</span>
                  )}
                  {h.custody?.label && (
                    <span className="ml-1 text-ink-500">
                      （
                      {t(`report.common.custodyPrograms.${h.custody.labelKey ?? ''}`) ===
                      `report.common.custodyPrograms.${h.custody.labelKey ?? ''}`
                        ? h.custody.label
                        : t(`report.common.custodyPrograms.${h.custody.labelKey}`)}
                      ）
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {h.counted ? (
                    t('report.common.yes')
                  ) : (
                    <span className="text-ink-500">
                      {h.kind === 'pool'
                        ? t('report.topHolders.noPool')
                        : h.kind === 'burn'
                          ? t('report.topHolders.noBurn')
                          : t('report.topHolders.noTimelock')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-400">
        {t('report.topHolders.noteBottom1')}
        <strong>{t('report.topHolders.noteBottomBold')}</strong>
        {t('report.topHolders.noteBottom2')}
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
  const { t, n } = useI18n();
  const m = report.dimensions.holders?.metrics;
  const overview = (m?.overview ?? undefined) as HolderOverview | undefined;
  const lazy = (m?.overviewLazy ?? undefined) as HolderOverviewLazy | undefined;

  if (!overview) {
    if (!lazy) return null;
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-300">{t('report.overview.title')}</h2>
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs text-ink-300">
          <p className="leading-relaxed">{lazy.reason}</p>
          <p className="mt-2 leading-relaxed text-ink-400">{t('report.overview.emptyNote')}</p>
          {onForceOverview && (
            <button
              type="button"
              disabled={forcing}
              onClick={onForceOverview}
              className="mt-3 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs text-ink-100 transition hover:bg-accent/20 disabled:opacity-50"
            >
              {forcing ? t('report.overview.reloading') : t('report.overview.loadFull')}
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
        <h2 className="text-sm font-semibold text-ink-300">{t('report.overview.titleFull')}</h2>
        <span className="font-mono text-[10px] text-ink-500">
          {overview.truncated ? t('report.overview.truncated') : t('report.overview.complete')}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('report.overview.statHolders')}
          value={n(overview.ownersWithBalance)}
          sub={t('report.overview.statAccountsSub', { n: n(overview.accountsWithBalance) })}
        />
        <Stat
          label={t('report.overview.statAccountsTotal')}
          value={n(overview.accountsTotal)}
          sub={
            emptyAccounts > 0
              ? t('report.overview.statEmptySub', { n: n(emptyAccounts) })
              : t('report.overview.statNoEmptySub')
          }
        />
        <Stat
          label={t('report.overview.statHalf')}
          value={`${overview.ownersFor50 ?? '—'} / ${overview.ownersFor80 ?? '—'}`}
          sub={t('report.overview.statHalfSub')}
        />
        <Stat
          label={t('report.overview.statDust', { pct: THRESHOLDS.holders.overviewDustPct })}
          value={n(overview.dustOwners)}
          sub={t('report.overview.statDustSub', { pct: num(overview.dustPct) })}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-ink-900/60 text-ink-400">
            <tr>
              <th className="px-3 py-2 font-medium">{t('report.overview.colRange')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('report.overview.colHolders')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('report.overview.colTotalShare')}</th>
              <th className="px-3 py-2 font-medium">{t('report.overview.colDistribution')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {overview.buckets.map((b) => {
              const share = b.owners / Math.max(1, overview.ownersWithBalance);
              return (
                <tr key={b.label} className="bg-ink-950/40">
                  <td className="px-3 py-2 font-mono text-ink-300">{b.label}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-200">{n(b.owners)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-200">{num(b.pct)}%</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded bg-ink-800">
                        <div className="h-full bg-accent" style={{ width: `${Math.min(100, share * 100).toFixed(2)}%` }} />
                      </div>
                      <span className="font-mono text-[10px] text-ink-500">
                        {t('report.overview.pctOfHolders', { pct: (share * 100).toFixed(1) })}
                      </span>
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
        {t('report.overview.note1')}
        <strong>{t('report.overview.noteBold1')}</strong>
        {t('report.overview.note2', {
          accounts: n(overview.accountsTotal),
          withBalance: n(overview.accountsWithBalance),
        })}
        {overview.reportedHolders !== undefined && (
          <>{t('report.overview.noteReported', { n: n(overview.reportedHolders) })}</>
        )}
        {twoCaliber && (
          <>
            {t('report.overview.noteMismatch1')}
            <span className="text-warn">{t('report.overview.noteMismatchBold')}</span>
          </>
        )}
        {t('report.overview.note3', {
          excluded: num(overview.excludedPct),
          covered: num(overview.coveredPct),
        })}
        {overview.coveredPct < 99 && t('report.overview.noteIncomplete')}
        {t('report.overview.noteEnd')}
      </p>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { t } = useI18n();
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
  const { t } = useI18n();
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
        <span className="font-medium text-ink-300">{t('report.curve.title')}</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-4 rounded bg-warn" /> {t('report.curve.legendWith')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-4 rounded bg-safe" /> {t('report.curve.legendWithout')}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('report.curve.ariaLabel')}>
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
              <th className="px-2 py-1.5 font-medium">{t('report.curve.colRank')}</th>
              <th className="px-2 py-1.5 text-right font-medium text-warn">
                {t('report.curve.colWith')}
                <br />
                {t('report.curve.colWithSuffix')}
              </th>
              <th className="px-2 py-1.5 text-right font-medium text-safe">
                {t('report.curve.colWithout')}
                <br />
                {t('report.curve.colWithoutSuffix')}
              </th>
              <th className="px-2 py-1.5 text-right font-medium">
                {t('report.curve.colOfFloat')}
                <br />
                {t('report.curve.colOfFloatSuffix')}
              </th>
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
        {t('report.curve.note1')}
        <span className="text-ink-300">{t('report.curve.noteBoldDifferent')}</span>
        {t('report.curve.note2')}
        <span className="text-ink-300">{t('report.curve.noteBoldNumerator')}</span>
        {t('report.curve.note3')}
        <span className="text-ink-300">{t('report.curve.noteBoldFinal')}</span>
        {t('report.curve.note4')}
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
  const { t, n } = useI18n();
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
          if (!res.ok) {
            throw new Error(j?.error ?? t('report.common.loadFailed', { status: res.status }));
          }
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

  // 短名：与上面同一套 key，字典里另有 .short 层级
  const KIND_LABEL: Record<string, string> = Object.fromEntries(
    Object.keys(HOLDER_KIND_LABELS).map((k) => [k, t(`report.common.holderKinds.short.${k}`)]),
  );
  const totalPages = meta ? Math.max(1, Math.ceil(meta.filtered / meta.pageSize)) : 1;
  const csvHref = `/api/holders?${query}&format=csv`;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-300">{t('sections.allHolders')}</h2>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs text-ink-100 transition hover:bg-accent/20"
          >
            {t('report.allHolders.expand', {
              accounts: n(overview.accountsTotal),
              owners: n(overview.ownersWithBalance),
            })}
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
              placeholder={t('report.allHolders.searchPlaceholder')}
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
              {t('report.allHolders.includeEmpty')}
            </label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-ink-600 bg-ink-950 px-2 py-1.5 text-[11px] text-ink-200 outline-none"
            >
              {[20, 50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {t('report.allHolders.pageSize', { n: size })}
                </option>
              ))}
            </select>
            <a
              href={csvHref}
              onClick={() => track('csv_export')}
              className="rounded-lg border border-ink-600 px-2.5 py-1.5 text-[11px] text-ink-300 transition hover:text-ink-100"
            >
              {t('report.allHolders.exportCsv')}
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
                  <th className="px-3 py-2 font-medium">{t('report.allHolders.colAddress')}</th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t('report.allHolders.colCount')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t('report.allHolders.colShareOfSupply')}
                  </th>
                  <th className="px-3 py-2 font-medium">{t('report.allHolders.colCategory')}</th>
                  <th className="px-3 py-2 font-medium">{t('report.allHolders.colCounted')}</th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t('report.allHolders.colAccounts')}
                  </th>
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
                    <td className="px-3 py-2">
                      {h.counted ? (
                        t('report.common.yes')
                      ) : (
                        <span className="text-ink-500">{t('report.common.no')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-400">{h.accounts ?? 1}</td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-ink-500">
                      {t('report.allHolders.noRows')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-400">
            <span className="font-mono">
              {loading
                ? t('report.common.loading')
                : meta
                  ? t('report.allHolders.footer', {
                      filtered: n(meta.filtered),
                      total: n(meta.totalOwners),
                    })
                  : ''}
              {meta?.truncated && ` · ${t('report.common.dataIncomplete')}`}
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-ink-700 px-2 py-1 transition hover:text-ink-100 disabled:opacity-40"
              >
                {t('report.allHolders.prev')}
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
                {t('report.allHolders.next')}
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
  const { t } = useI18n();
  const m = report.dimensions.diamond?.metrics;
  const info = m as unknown as DiamondInfo | undefined;
  const rows = Array.isArray(info?.evidence) ? (info.evidence as DiamondEvidence[]) : [];
  if (!info || info.analyzedWallets === undefined) return null;

  const coverageLow = (info.windowCoveragePct ?? 0) < THRESHOLDS.diamond.minWindowCoveragePct;
  // 分类名走字典（与 constants.HOLDER_KIND_LABELS 同一套语义）
  const KIND_LABEL: Record<string, string> = {
    pool: t('report.common.holderKinds.pool'),
    burn: t('report.common.holderKinds.burn'),
    timelock: t('report.common.holderKinds.timelock'),
    custody: t('report.common.holderKinds.custody'),
    dev: t('report.common.holderKinds.dev'),
    related: t('report.common.holderKinds.related'),
    sniper: t('report.common.holderKinds.sniper'),
    retail: t('report.common.holderKinds.retail'),
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-300">{t('report.diamond.title')}</h2>
        <span className="font-mono text-[10px] text-ink-500">
          {t('report.diamond.headline', {
            hands: info.diamondHands,
            analyzed: info.analyzedWallets,
            coverage: num(info.windowCoveragePct),
          })}
        </span>
      </div>

      {coverageLow && (
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs leading-relaxed text-ink-300">
          {t('report.diamond.warn1')}
          <span className="font-mono text-warn">{t('report.diamond.warnBold', { pct: num(info.windowCoveragePct) })}</span>
          {t('report.diamond.warn2')}
          {info.gapDays !== undefined && (
            <>{t('report.diamond.warnGap', { days: info.gapDays })}</>
          )}
          {t('report.diamond.warn3')}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('report.diamond.statHands')}
          value={`${info.diamondHands ?? '—'}`}
          sub={t('report.diamond.statHandsSub', { pct: num(info.sharePct) })}
        />
        <Stat
          label={t('report.diamond.statMedianHold')}
          value={
            info.medianHoldDays !== undefined
              ? t('report.diamond.days', { n: num(info.medianHoldDays) })
              : '—'
          }
          sub={
            info.medianHoldDays !== undefined
              ? t('report.diamond.statMedianSub')
              : t('report.diamond.statNoMedianSub')
          }
        />
        <Stat
          label={t('report.diamond.statStrongest')}
          value={`${info.strongEvidenceCount ?? 0}`}
          sub={t('report.diamond.statStrongestSub')}
        />
        <Stat
          label={t('report.diamond.statAddOn')}
          value={`${info.addOnCount ?? 0}`}
          sub={t('report.diamond.statAddOnSub', { n: THRESHOLDS.diamond.addOnBuys })}
        />
      </div>

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-ink-900/60 text-ink-400">
              <tr>
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">{t('report.diamond.colWallet')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('report.diamond.colHoldDays')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('report.diamond.colBuys')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('report.diamond.colBuyAmount')}</th>
                <th className="px-3 py-2 font-medium">{t('report.diamond.colStrength')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('report.diamond.colShareNow')}</th>
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
                  <td className="px-3 py-2 text-right font-mono text-ink-200">
                    {t('report.diamond.days', { n: num(h.holdDays) })}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-300">
                    {h.buys}
                    {h.added && (
                      <span className="ml-1 text-[9px] text-safe">{t('report.diamond.addedBadge')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-300">{num(h.buySol)} SOL</td>
                  <td className="px-3 py-2 text-[10px]">
                    {h.inEarlyWindow ? (
                      <span className="text-safe">{t('report.diamond.strongestTag')}</span>
                    ) : (
                      <span className="text-ink-500" title={t('report.diamond.recentTitle')}>
                        {t('report.diamond.recentTag')}
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
          {t('report.diamond.empty1', {
            n: info.analyzedWallets,
            days: THRESHOLDS.diamond.minHoldDays,
          })}
          {coverageLow && t('report.diamond.emptyLowCoverage')}
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-ink-400">
        {t('report.diamond.note1', {
          trades: info.tradesAnalyzed,
          early: THRESHOLDS.liquidity.sniperWindowTrades,
          excluded: info.excludedCount,
          robots: info.robotCount,
        })}
        <span className="text-ink-300">{t('report.diamond.noteBold')}</span>
        {t('report.diamond.note2')}
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
  const { t } = useI18n();
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
        <h2 className="text-sm font-semibold text-ink-300">{t('report.sellPressure.title')}</h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-ink-500">
            {byPnl
              ? t('report.sellPressure.priceOk', { price: info.priceSol!.toExponential(2) })
              : info.priceNote ?? t('report.sellPressure.priceUnavailable')}
          </span>
          {onRunDeep && (
            <button
              type="button"
              onClick={onRunDeep}
              disabled={deepPending}
              title={t('report.sellPressure.deepButtonTitle')}
              className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deepPending
                ? t('report.sellPressure.deepRunning')
                : hasDeep
                  ? t('report.sellPressure.deepButtonAgain')
                  : t('report.sellPressure.deepButton')}
            </button>
          )}
        </div>
      </div>

      {hasDeep ? (
        <div className="rounded-xl border border-safe/30 bg-safe/5 p-3 text-xs leading-relaxed text-ink-300">
          {t('report.sellPressure.deepDone1')}
          <span className="text-safe">{t('report.sellPressure.deepDoneBold')}</span>
          {t('report.sellPressure.deepDone2', {
            wallets: info.deepWallets,
            addresses: info.deepAddresses,
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-3 text-xs leading-relaxed text-ink-400">
          {t('report.sellPressure.noDeep1')}
          <span className="text-ink-300">{t('report.sellPressure.noDeepBold')}</span>
          {t('report.sellPressure.noDeep2')}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('report.sellPressure.statUnsold')}
          value={`${num(info.unsoldPctOfCirculating)}%`}
          sub={t('report.sellPressure.statUnsoldSub', { n: num(info.totalUnsoldTokens) })}
        />
        <Stat
          label={t('report.sellPressure.statCost')}
          value={`${num(info.totalCostSol)} SOL`}
          sub={t('report.sellPressure.statCostSub')}
        />
        <Stat
          label={t('report.sellPressure.statWallets')}
          value={`${info.walletsAnalyzed}`}
          sub={
            info.deepWallets > 0
              ? t('report.sellPressure.statWalletsDeep', { n: info.deepWallets })
              : t('report.sellPressure.statWalletsWindow', { pct: num(info.attributionPct) })
          }
        />
        <Stat
          label={t('report.sellPressure.statExited')}
          value={`${info.exitedWallets} / ${info.distributingWallets}`}
          sub={t('report.sellPressure.statExitedSub')}
        />
      </div>

      {info.attributionPct !== undefined && info.attributionPct < 50 && (
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs leading-relaxed text-ink-300">
          {t('report.sellPressure.lowAttr1')}
          <span className="font-mono text-warn">
            {t('report.sellPressure.lowAttrBold', { pct: num(info.attributionPct ?? 0) })}
          </span>
          {t('report.sellPressure.lowAttr2')}
          <span className="text-warn">{t('report.sellPressure.lowAttrBold2')}</span>
        </div>
      )}

      {baseBuckets.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-ink-900/60 text-ink-400">
              <tr>
                <th className="px-3 py-2 font-medium">
                  {byPnl
                    ? t('report.sellPressure.colPnlBucket')
                    : t('report.sellPressure.colCostBucket')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('report.sellPressure.colWallets')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('report.sellPressure.colUnsold')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {byPnl
                    ? t('report.sellPressure.colOfFloat')
                    : t('report.sellPressure.colOfAnalyzable')}
                </th>
                <th className="px-3 py-2 font-medium">{t('report.common.distribution')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {baseBuckets.map((b) => (
                <tr key={b.key ?? b.label} className="bg-ink-950/40">
                  <td className="px-3 py-2 text-ink-300">{bucketLabel(b, t)}</td>
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
            {t('report.sellPressure.profitTitle')}
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-ink-900/40 text-ink-400">
              <tr>
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">{t('report.sellPressure.colWallet')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('report.sellPressure.colCost')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('report.sellPressure.colPnl')}</th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('report.sellPressure.colUnsoldShort')}
                </th>
                <th className="px-3 py-2 text-right font-medium">{t('report.sellPressure.colSold')}</th>
                <th className="px-3 py-2 font-medium">{t('report.sellPressure.colSource')}</th>
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
                      <span className="ml-1 text-safe" title={t('report.sellPressure.sourceDeepTitle')}>
                        {t('report.sellPressure.sourceDeep')}
                      </span>
                    ) : (
                      <span
                        className="ml-1 text-ink-600"
                        title={t('report.sellPressure.sourceWindowTitle')}
                      >
                        {t('report.sellPressure.sourceWindow')}
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
          {t('report.sellPressure.minted1')}
          <span className="font-mono text-ink-200">{info.mintedWallets}</span>
          {t('report.sellPressure.minted2', { tokens: num(info.mintedUnsoldTokens) })}
          <span className="text-ink-300">{t('report.sellPressure.mintedBold1')}</span>
          {t('report.sellPressure.minted3')}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-ink-400">
        {t('report.sellPressure.note1', { note: sellPressureWindowNote(t, info) })}
        <span className="text-ink-300">{t('report.sellPressure.noteBold')}</span>
        {t('report.sellPressure.note2', {
          hours: Math.round(THRESHOLDS.sellPressure.maxPriceAgeSec / 3600),
        })}
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
