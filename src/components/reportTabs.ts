/**
 * 报告分区的定义。
 *
 * 抽成纯数据（而不是写死在 JSX 里）有两个好处：
 * 1. 可以测 —— 「硬否决不能被分页藏起来」这种约定必须有测试锁住；
 * 2. 新增区块时会立刻遇到「它属于哪个 tab」这个问题，而不是随手追加到页面末尾。
 *
 * ⚠️ 本节最重要的约束：**结论与硬否决不属于任何 tab**。
 * 它们是常驻头部。一票判死的结论如果藏在默认不可见的页里，等于没显示。
 */

export type TabKey = 'overview' | 'holders' | 'flow' | 'behavior' | 'source';

export interface ReportTabMeta {
  key: TabKey;
  label: string;
  /** 这个 tab 里包含哪些区块（用于测试与文档，不参与渲染） */
  sections: string[];
}

export const REPORT_TABS: ReportTabMeta[] = [
  {
    key: 'overview',
    label: '概览',
    sections: ['雷达图', '各维度速览'],
  },
  {
    key: 'holders',
    label: '持仓',
    sections: ['持币集中度方程', '全量持有人总览', '集中度曲线', 'Top20 持仓表', '全量持币人明细'],
  },
  {
    key: 'flow',
    label: '资金流',
    sections: ['大额卖单明细'],
  },
  {
    key: 'behavior',
    label: '持仓行为',
    sections: ['钻石手', '抛压分布'],
  },
  {
    key: 'source',
    label: '数据来源',
    sections: ['逐项体检明细', '数据来源与局限'],
  },
];

/** 按 key 取 tab 元数据（渲染时用，避免数组下标与 key 混用） */
export const TAB_META: Record<TabKey, ReportTabMeta> = Object.fromEntries(
  REPORT_TABS.map((t) => [t.key, t]),
) as Record<TabKey, ReportTabMeta>;

/**
 * 常驻头部（不在任何 tab 里）。
 *
 * 单独列出来是为了让「哪些内容必须常驻」成为一条显式约定 ——
 * 新增区块时如果不属于这里、也不属于任何 tab，测试会报错。
 */
export const ALWAYS_VISIBLE = ['结论卡（分数 / 风险等级 / 建议仓位）', '硬否决列表'];

/** 默认打开的 tab */
export const DEFAULT_TAB: TabKey = 'overview';

/** 某个区块名属于哪个 tab；找不到返回 undefined */
export function tabForSection(section: string): TabKey | undefined {
  return REPORT_TABS.find((t) => t.sections.includes(section))?.key;
}
