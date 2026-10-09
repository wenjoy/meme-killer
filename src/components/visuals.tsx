import type { Severity } from '@/core/types';

export const TONE = {
  success: { text: 'text-safe', bg: 'bg-safe/10', border: 'border-safe/30', dot: 'bg-safe' },
  warning: { text: 'text-warn', bg: 'bg-warn/10', border: 'border-warn/30', dot: 'bg-warn' },
  error: { text: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/30', dot: 'bg-danger' },
} as const;

export type Tone = keyof typeof TONE;

/** 严重度 → 展示样式。critical 用实心强调，因为它代表「一票判死」 */
export const SEVERITY_STYLE: Record<
  Severity,
  { label: string; text: string; bg: string; border: string; mark: string }
> = {
  critical: { label: '否决', text: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/40', mark: '✕' },
  high: { label: '高危', text: 'text-danger', bg: 'bg-danger/5', border: 'border-danger/25', mark: '!' },
  medium: { label: '注意', text: 'text-warn', bg: 'bg-warn/5', border: 'border-warn/25', mark: '•' },
  low: { label: '轻微', text: 'text-ink-400', bg: 'bg-ink-800/40', border: 'border-ink-700', mark: '·' },
  good: { label: '积极', text: 'text-safe', bg: 'bg-safe/5', border: 'border-safe/25', mark: '✓' },
};

/** 风险分 → 颜色（0 绿 → 100 红），用于分数圆环与雷达图 */
export function riskColor(score: number): string {
  if (score < 25) return 'var(--color-safe)';
  if (score < 45) return 'var(--color-warn)';
  return 'var(--color-danger)';
}

/** 分数圆环：一眼看出风险水位 */
export function ScoreRing({ score, size = 132 }: { score: number; size?: number }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const color = riskColor(score);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-ink-700)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: 'stroke-dashoffset .6s ease, stroke .3s' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold leading-none" style={{ color }}>
          {score}
        </span>
        <span className="mt-1 text-[10px] tracking-wider text-ink-400">风险分</span>
      </div>
    </div>
  );
}

const AXES: { key: string; label: string }[] = [
  { key: 'contract', label: '合约安全' },
  { key: 'liquidity', label: '流动性' },
  { key: 'holders', label: '持币集中' },
  { key: 'developer', label: '开发者' },
  { key: 'social', label: '社交热度' },
];

/**
 * 五维雷达图（手写 SVG，无需图表库）。
 * 半径越大 = 风险越高，所以形状越「鼓」越危险。
 * 数据缺失的维度画成虚线灰点，避免被误读为「该维度安全」。
 */
export function RadarChart({
  scores,
  missing,
  size = 260,
}: {
  scores: Record<string, number>;
  missing: Record<string, boolean>;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 42;
  const n = AXES.length;

  const point = (i: number, ratio: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(angle) * maxR * ratio, cy + Math.sin(angle) * maxR * ratio] as const;
  };

  const dataPoints = AXES.map((a, i) => point(i, Math.max(0.04, (scores[a.key] ?? 0) / 100)));
  const polygon = dataPoints.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <svg width={size} height={size} className="overflow-visible">
      {/* 网格 */}
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          points={AXES.map((_, i) => point(i, ring).join(',')).join(' ')}
          fill="none"
          stroke="var(--color-ink-700)"
          strokeWidth={0.8}
        />
      ))}
      {/* 轴 */}
      {AXES.map((a, i) => {
        const [x, y] = point(i, 1);
        return <line key={a.key} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-ink-700)" strokeWidth={0.8} />;
      })}
      {/* 风险区域 */}
      <polygon points={polygon} fill="var(--color-danger)" fillOpacity={0.16} stroke="var(--color-danger)" strokeWidth={1.6} />
      {/* 顶点 */}
      {dataPoints.map(([x, y], i) => (
        <circle
          key={AXES[i].key}
          cx={x}
          cy={y}
          r={missing[AXES[i].key] ? 2.5 : 3.4}
          fill={missing[AXES[i].key] ? 'var(--color-ink-600)' : riskColor(scores[AXES[i].key] ?? 0)}
          stroke="var(--color-ink-900)"
          strokeWidth={1.4}
        />
      ))}
      {/* 标签 */}
      {AXES.map((a, i) => {
        const [lx, ly] = point(i, 1.24);
        const isMissing = missing[a.key];
        return (
          <g key={a.key}>
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fill={isMissing ? 'var(--color-ink-400)' : 'var(--color-ink-200)'}
            >
              {a.label}
            </text>
            <text
              x={lx}
              y={ly + 13}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill={isMissing ? 'var(--color-ink-600)' : riskColor(scores[a.key] ?? 0)}
            >
              {isMissing ? '无数据' : (scores[a.key] ?? 0).toFixed(0)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
