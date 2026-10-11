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

export type TabKey = 'overview' | 'holders' | 'flow' | 'behavior';

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
    /**
     * 概览 = 雷达图 + 各维度得分 + 逐项体检明细 + 数据来源。
     *
     * 「数据来源」原本是独立 tab，但它只有约 3,800 字、没有任何交互，
     * 单独占一个 tab 的代价（多一次点击、多一层导航）大于收益，故并入概览。
     * 顺序是刻意的：**先分数（一眼看风险）→ 再明细 → 最后来源**。
     *
     * ⚠️ 仍然不允许**同一批数字出现在两个地方**：以前概览有一份手写的紧凑网格，
     * 与「逐项体检明细」的卡片显示同样的 Top10 / 净流入 / 卖单额 ——
     * 两份数字会各自漂移，改口径只改一处就会出现互相矛盾的值。
     * 现在细节只在「逐项体检明细」里出现一次。
     */
    sections: ['雷达图', '各维度得分', '逐项体检明细', '数据来源与局限'],
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
];

/**
 * 常驻头部（不在任何 tab 里）。
 *
 * 单独列出来是为了让「哪些内容必须常驻」成为一条显式约定 ——
 * 新增区块时如果不属于这里、也不属于任何 tab，测试会报错。
 */
export const ALWAYS_VISIBLE = ['结论卡（分数 / 风险等级 / 建议仓位）', '硬否决列表'];

/** 默认打开的 tab */
export const DEFAULT_TAB: TabKey = 'overview';

/** 按 key 取 tab 元数据（渲染时用，避免数组下标与 key 混用） */
export const TAB_META: Record<TabKey, ReportTabMeta> = Object.fromEntries(
  REPORT_TABS.map((t) => [t.key, t]),
) as Record<TabKey, ReportTabMeta>;

/** 某个区块名属于哪个 tab；找不到返回 undefined */
export function tabForSection(section: string): TabKey | undefined {
  return REPORT_TABS.find((t) => t.sections.includes(section))?.key;
}
