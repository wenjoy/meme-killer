/**
 * 采集告警的构造助手。
 *
 * 告警的国际化与 `Finding` 同一套约定：key + params 查字典，`text` 是中文回退。
 * 这里提供一个短的构造器，让 40 个 push 点保持可读：
 *
 *   warnings.push(warn('warnings.helius.ammPools', { n, kinds }, `按控制程序识别出 …`));
 *
 * ⚠️ `text` 必须与 `src/i18n/messages/warnings.zh.ts` 里的中文**逐字一致**。
 * 迁移期两份并存，漂移了就会出现「中文界面看到 A、英文界面回退到 B」。
 * `warnings.i18n.test.ts` 会把这条钉死。
 */
import type { Warning } from './types';

export function warn(
  key: string,
  params: Record<string, string | number> | undefined,
  text: string,
): Warning {
  return params === undefined ? { key, text } : { key, params, text };
}
