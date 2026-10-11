/** 测试用：把字典包一层，模拟真实 Provider 里的 t()（含 {name} 插值）。 */
import { lookup } from './lookup.ts';

export function lookupForTest(dict: unknown) {
  return (key: string, params?: Record<string, string | number>): string => {
    let out = lookup(dict, key) ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v));
    }
    return out;
  };
}
