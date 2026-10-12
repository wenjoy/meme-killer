'use client';

/**
 * 语言切换按钮。
 *
 * 设计取舍：
 * - 两个语言就两个选项，做成**分段控件**而不是下拉菜单 ——
 *   一次点击即可切换，下拉还要「点开 → 选 → 关」三步。
 * - 切换即时生效：语言状态在 React context 里，不刷新页面，
 *   所以已经渲染出来的报告会跟着变，扫描结果也不会丢。
 */
import { track } from './analytics';
import { useI18n, LOCALES } from '@/i18n';
import { LOCALE_LABELS } from '@/i18n/types';

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div
      role="group"
      aria-label="Language"
      className="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-900/60 p-0.5"
    >
      {LOCALES.map((l) => {
        const on = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => {
              setLocale(l);
              // 只在真的换了语言时记，避免重复点同一个按钮刷数据
              if (l !== locale) track('lang_switch', undefined, { from: locale, to: l });
            }}
            aria-pressed={on}
            lang={l}
            className={`rounded-md px-2.5 py-1 text-[11px] transition ${
              on
                ? 'bg-accent/15 font-semibold text-accent'
                : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
            }`}
          >
            {LOCALE_LABELS[l]}
          </button>
        );
      })}
    </div>
  );
}
