'use client';

/**
 * 轻量 i18n：不引第三方库。
 *
 * 为什么不用 next-intl / react-i18next：
 * - 本站只有两种语言、一个页面，库带来的路由约定与打包体积都不划算；
 * - 更重要的：**界面上所有文案都必须在切换语言时立即变**，
 *   而语言状态同时被「客户端组件」和「分析器结论」两边消费。
 *   自己写一个 context 反而更清楚，也不会和 App Router 的 RSC 边界打架。
 *
 * 语言状态放 localStorage 而不是 URL：切换即时生效、无需刷新，
 * 也不会把扫描结果（存在客户端状态里）弄丢。代价是链接不带语言。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { lookup } from './lookup';
import { LOCALES } from './types';
import type { Locale, MessageParams } from './types';
import { en } from './messages/en';
import { zh } from './messages/zh';
import type { Messages } from './messages/zh';

const STORAGE_KEY = 'mk.locale';

const DICTS: Record<Locale, Messages> = { zh, en };

/**
 * 探测首次访问时的语言。
 *
 * 顺序：localStorage（用户选过）→ 浏览器语言 → 英文。
 * 浏览器语言判定用前缀匹配：`en-US`、`en-GB` 都算英文；
 * 其余一律给英文（`zh-CN`/`zh-TW` 都算中文）。
 */
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // 隐私模式等场景下 localStorage 不可用 —— 不影响功能，继续探测
  }
  const langs = [navigator.language, ...(navigator.languages ?? [])];
  for (const l of langs) {
    if (!l) continue;
    const low = l.toLowerCase();
    if (low.startsWith('zh')) return 'zh';
    if (low.startsWith('en')) return 'en';
  }
  return 'en';
}

export interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /**
   * 取一条文案。
   *
   * `t('report.coverage', { pct: 90 })` → 「覆盖率 90%」
   *
   * 缺 key 时**返回 key 本身**而不是空字符串：页面上出现
   * `report.coverage` 这种字样是刺眼的，一眼就能发现漏译；
   * 返回空字符串则会静默少一句话，谁都不会注意到。
   */
  t: (key: string, params?: MessageParams) => string;
  /** 数字按当前语言格式化（千分位） */
  n: (v: number, digits?: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

/** 用 `{name}` 占位符做替换；缺参数时保留占位符可见（同样是「显式失败」原则） */
function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}

/**
 * 从字典里按 'a.b.c' 取值。
 *
 * ⚠️ 字典里**两种形态混杂**，所以要走三步，顺序不能反：
 *
 * 1. **扁平 key**：`app.name` 直接就是顶层的一个属性名吗？
 * 2. **嵌套 key**：`report.largeSells.colTime` 逐层下钻
 *    （`report` → `largeSells` → `colTime`）。
 * 3. **带前缀的扁平 key**：`findings.holders.top10Danger` 的真实存储位置是
 *    `dict['findings']['findings.holders.top10Danger']` ——
 *    `findings.zh.ts` / `findings.en.ts` 是扁平的 `Record<string,string>`，
 *    而它们的 key **自带完整的 `findings.` 前缀**。
 *
 * 漏掉第 3 步的后果：每一条分析器结论都查不到译文，静默回退到分析器内置的
 * 中文 title/detail —— 不报错、不空白，只是英文界面上满屏中文，
 * 而且所有「字典完整性」测试依然是绿的（它们只比对字典文件，不走 lookup）。
 * 这个 bug 真实发生过一次。
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  // 初始值必须是确定的，否则服务端渲染与客户端首帧不一致会报 hydration 错误。
  // 所以这里先用 'zh'（默认语言），挂载后再按探测结果切换。
  const [locale, setLocaleState] = useState<Locale>('zh');

  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  // 切换语言时同步 <html lang> —— 影响字体渲染、连字符、屏幕阅读器发音
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // 存不下就算了，本次会话内仍然生效
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = DICTS[locale];
    // 中文缺失时回退到英文（英文是完整的基准字典），避免出现空文案
    const fallback = DICTS.en;
    return {
      locale,
      setLocale,
      t: (key, params) => {
        const raw = lookup(dict, key) ?? lookup(fallback, key);
        if (raw === undefined) return key;
        return interpolate(raw, params);
      },
      n: (v, digits) => {
        if (!Number.isFinite(v)) return '—';
        return v.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
          minimumFractionDigits: digits ?? 0,
          maximumFractionDigits: digits ?? 0,
        });
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n 必须在 I18nProvider 内使用');
  return ctx;
}

export { LOCALES };
