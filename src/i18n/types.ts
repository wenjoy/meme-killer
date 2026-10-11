/**
 * 结论（Finding）的结构化表达。
 *
 * ── 为什么要改成「ID + 参数」而不是直接存字符串 ──────────────────
 * 结论文案原本是分析器里硬编码的中文模板字符串（约 12,000 字），
 * 这带来三个问题：
 *
 * 1. **无法国际化**：字符串在分析器里就定死了，英文用户只能看到中文。
 * 2. **无法测试语义**：测试只能断言 `title === 'Top10 持仓过度集中'`，
 *    改一个字的措辞就会让测试失败 —— 而措辞本来不该影响逻辑。
 * 3. **数字格式无法适配语言**：`38.22%` 的中文与英文写法没有区别，
 *    但日期、数字分组、单位在不同语言下不一样。
 *
 * 所以分析器现在只产出 `{ id, params }`，由渲染层按当前语言查字典。
 * 这样做还有一个副作用是好的：**漏译会变成显式的编译/测试错误**，
 * 而不是页面上悄悄少一段话。
 */

/** 所有结论 ID 的联合类型由 en 字典推导（见 messages/en.ts） */
export type MessageParams = Record<string, string | number>;

/**
 * 一条结论：ID + 参数。
 *
 * `params` 里的值必须是**已格式化好的字符串或原始数字** ——
 * 原始数字交给渲染层按语言格式化（千分位、小数位）。
 */
export interface FindingMessage {
  id: string;
  params?: MessageParams;
}

export type Locale = 'zh' | 'en';

export const LOCALES: Locale[] = ['zh', 'en'];

export const LOCALE_LABELS: Record<Locale, string> = {
  zh: '中文',
  en: 'English',
};
