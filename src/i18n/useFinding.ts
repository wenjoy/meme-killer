'use client';

/** 结论本地化的 React 绑定（纯函数在 finding.ts，便于测试） */
import { useCallback } from 'react';

import { useI18n } from './index';
import { localizeFinding } from './finding';
import type { Finding } from '../core/types';

export function useFindingLocalizer() {
  const { t } = useI18n();
  return useCallback((f: Finding) => localizeFinding(f, t), [t]);
}
