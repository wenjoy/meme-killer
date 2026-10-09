/**
 * 扫描引擎：编排五个维度 → 加权总分 → 买入建议 + 中文报告。
 *
 * 执行顺序很重要：**先跑硬否决，命中即短路**。
 * 否决项（如 mint authority 未放弃）是「一票判死」，此时再算加权分没有意义，
 * 而且会给出「总分 60 好像还能小仓」的错误暗示。
 */
import {
  DIMENSION_LABELS,
  DIMENSION_ORDER,
  SEVERITY_ORDER,
  WEIGHTS,
  bandFor,
  scoreFromFindings,
} from './constants';
import { analyzeContract } from './analyzers/contract';
import { analyzeLiquidity } from './analyzers/liquidity';
import { analyzeHolders } from './analyzers/holders';
import { analyzeDeveloper } from './analyzers/developer';
import { analyzeSocial } from './analyzers/social';
import type { DimensionResult, Finding, ScanInput, ScanReport } from './types';

export const ANALYZERS: Record<string, (data: ScanInput) => DimensionResult> = {
  contract: analyzeContract,
  liquidity: analyzeLiquidity,
  holders: analyzeHolders,
  developer: analyzeDeveloper,
  social: analyzeSocial,
};

/** 把发现项按严重度排序，供报告与 UI 使用 */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/**
 * 生成建议仓位。
 * 注意：即使低风险也不建议梭哈 —— meme 币的本质是归零概率极高。
 */
function positionAdvice(level: string, vetoes: unknown[]): { size: string; text: string } {
  if (vetoes.length > 0) {
    return { size: '0%', text: '命中硬否决项，任何仓位都不应该开。建议直接放弃这个标的。' };
  }
  switch (level) {
    case 'LOW':
      return { size: '≤ 5%', text: '各维度未发现明显问题，可小仓位参与。仍需设好止损，meme 币归零是常态。' };
    case 'MEDIUM':
      return { size: '≤ 2%', text: '存在若干风险点，若参与请严格控制仓位，并做好随时离场的准备。' };
    case 'HIGH':
      return { size: '0–1%', text: '风险显著高于收益。建议观望，等待风险点消除或项目更成熟。' };
    default:
      return { size: '0%', text: '风险极高，不建议买入。' };
  }
}

export function scan(data: ScanInput): ScanReport {
  const dimensions: Record<string, DimensionResult> = {};

  for (const key of DIMENSION_ORDER) {
    const fn = ANALYZERS[key];
    try {
      dimensions[key] = fn(data);
    } catch (err) {
      // 单个维度失败不应让整次扫描崩掉，但必须显式暴露，不能静默吞掉 ——
      // 否则用户会看到「某维度 0 分 = 很安全」的假象。
      dimensions[key] = {
        dimension: key,
        label: DIMENSION_LABELS[key],
        score: 0,
        vetoed: false,
        error: err instanceof Error ? err.message : String(err),
        findings: [
          {
            severity: 'medium',
            title: '分析失败',
            detail: `该维度执行出错：${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }

  const vetoes = Object.values(dimensions)
    .filter((d) => d.vetoed)
    .flatMap((d) => d.findings.filter((f) => f.veto).map((f) => ({ dimension: d.label, ...f })));

  const weighted = DIMENSION_ORDER.reduce(
    (sum, key) => sum + (dimensions[key]?.score ?? 0) * (WEIGHTS[key] ?? 0),
    0,
  );
  // 命中硬否决时，综合分直接拉满。
  // 否则会出现「加权分 37 = 中等风险」与「已判定一票否决」并存的矛盾结论，
  // 分数会给出「好像还能小仓」的错误暗示 —— 否决项和分数必须一致。
  const score = vetoes.length > 0 ? 100 : Math.round(weighted * 10) / 10;

  // 数据覆盖率：有多少权重是「真的算过」的。
  // 没有这个检查，「所有数据都拿不到」会被加权成一个看起来很确定的高分/低分，
  // 这是最危险的一种误导 —— 用户会以为自己拿到了一份体检结论。
  const availableWeight = DIMENSION_ORDER.reduce(
    (sum, key) => sum + (dimensions[key]?.metrics?.available === 0 ? 0 : (WEIGHTS[key] ?? 0)),
    0,
  );
  const coverage = Math.round(availableWeight * 100);

  let band = bandFor(score);
  let advice = positionAdvice(band.level, vetoes);

  // 覆盖率过低时，**必须连分数和等级一起作废**。
  // 只改建议文案是不够的：用户第一眼看的是那个绿色的「12.6 低风险」大数字，
  // 它会直接盖过下面「数据不足」的提示 —— 这是最危险的一种误导。
  if (coverage < 40 && vetoes.length === 0) {
    band = {
      max: 0,
      level: 'CRITICAL',
      label: '数据不足',
      verdict: '无法评估',
      tone: 'warning',
    };
    advice = {
      size: '—',
      text: `仅采集到约 ${coverage}% 的评估维度，数据不足以给出买入建议。请检查网络/数据源后重试，并自行到 RugCheck、DexScreener 交叉验证。`,
    };
  }
  const meta = data.meta ?? {
    source: '未知',
    live: false,
    fetchedAt: new Date().toISOString(),
    origins: {},
    warnings: [],
  };

  return {
    score,
    band,
    vetoed: vetoes.length > 0,
    vetoes,
    dimensions,
    advice,
    coverage,
    token: data.token,
    meta,
    summary: buildSummary(data, score, band.label, vetoes, dimensions),
  };
}

function buildSummary(
  data: ScanInput,
  score: number,
  bandLabel: string,
  vetoes: (Finding & { dimension: string })[],
  dimensions: Record<string, DimensionResult>,
): string {
  const name = data.token?.symbol ?? data.token?.name ?? '该代币';
  const lines: string[] = [];

  if (vetoes.length > 0) {
    lines.push(`${name} 命中 ${vetoes.length} 项硬否决，风险评分 ${score}（${bandLabel}）。`);
    lines.push('');
    lines.push('**触发否决的信号：**');
    for (const v of vetoes) lines.push(`- 【${v.dimension}】${v.title}：${v.detail}`);
    lines.push('');
    lines.push('硬否决项代表存在「可以直接让你血本无归」的机制，与其它维度表现无关。建议直接放弃。');
    return lines.join('\n');
  }

  lines.push(`${name} 综合风险评分 ${score}，等级「${bandLabel}」。`);
  lines.push('');

  const worst = Object.values(dimensions)
    .filter((d) => !d.error)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  if (worst.length > 0 && worst[0].score > 0) {
    lines.push('**主要风险点：**');
    for (const d of worst) {
      const top = sortFindings(d.findings).filter((f) => f.severity !== 'good')[0];
      if (top) lines.push(`- 【${d.label}】${top.title}：${top.detail}`);
    }
    lines.push('');
  }

  const strengths = Object.values(dimensions)
    .flatMap((d) => d.findings.filter((f) => f.severity === 'good'))
    .slice(0, 3);
  if (strengths.length > 0) {
    lines.push('**积极信号：**');
    for (const s of strengths) lines.push(`- ${s.title}：${s.detail}`);
    lines.push('');
  }

  lines.push('> 本报告基于链上与公开数据自动生成，不构成投资建议。meme 币归零是常态，请自行控制风险。');
  return lines.join('\n');
}

/** 供「空数据」场景使用：所有维度全 0，明确标注无法评估 */
export function emptyReport(mint: string, reason: string): ScanReport {
  const dimensions: Record<string, DimensionResult> = {};
  for (const key of DIMENSION_ORDER) {
    dimensions[key] = {
      dimension: key,
      label: DIMENSION_LABELS[key],
      score: 0,
      vetoed: false,
      findings: [{ severity: 'medium', title: '数据不足', detail: reason }],
    };
  }
  return {
    score: 0,
    band: bandFor(0),
    vetoed: false,
    vetoes: [],
    coverage: 0,
    dimensions,
    advice: { size: '—', text: '数据不足，无法给出建议。请核对 mint 地址后重试。' },
    token: { mint },
    meta: {
      source: 'none',
      live: false,
      fetchedAt: new Date().toISOString(),
      origins: {},
      warnings: [reason],
    },
    summary: `无法分析 ${mint}：${reason}`,
  };
}

export { scoreFromFindings };
