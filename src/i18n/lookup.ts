/**
 * 字典查找（纯函数，不依赖 React）。
 *
 * 从 `index.tsx` 抽出来是因为测试环境解析不了 `.tsx`（见 finding.ts 的说明），
 * 而「组合句组装」这类逻辑必须用**真实的 lookup + 真实字典**验证：
 * 它的失败方式是静默回退到中文，不报错 —— 只靠类型检查发现不了。
 */
export function lookup(dict: unknown, key: string): string | undefined {
  if (dict === null || typeof dict !== 'object') return undefined;
  const obj = dict as Record<string, unknown>;

  // 1) 顶层就是这个名字（app.name 那类，也可以说是「字典被拍平了」的情形）
  const direct = obj[key];
  if (typeof direct === 'string') return direct;

  const parts = key.split('.');

  // 2) 逐层下钻（report.largeSells.colTime 那类真正的嵌套）
  let cur: unknown = dict;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') {
      cur = undefined;
      break;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur === 'string') return cur;

  // 3) 取首段当下钻起点，再用「整条 key」去查它下面的扁平属性
  //    （findings / pieces 那类：扁平 Record，但 key 自己带全前缀）
  const head = obj[parts[0]!];
  if (head !== null && typeof head === 'object') {
    const flat = (head as Record<string, unknown>)[key];
    if (typeof flat === 'string') return flat;
  }

  return undefined;
}
