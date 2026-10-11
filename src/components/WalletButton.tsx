'use client';

/**
 * 顶部的钱包连接按钮 —— 未连接时是「连接钱包」，已连接时显示地址。
 *
 * 三种状态：
 * - 未连钱包     → 「连接钱包」（点击弹选择器）
 * - 连了但没签名 → 「签名以启用」（点击弹签名）
 * - 已签名       → 显示缩略地址 + 断开
 */
import { useI18n } from '@/i18n';
import { useWalletGate } from './WalletGate';

function shortAddr(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function WalletButton() {
  const { t } = useI18n();
  const { state, wallet, error, connect, disconnect, retry } = useWalletGate();

  // 签名中：禁用点击，避免重复弹窗
  if (state === 'signing') {
    return (
      <button
        type="button"
        disabled
        className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs text-ink-400"
      >
        {t('wallet.signing')}
      </button>
    );
  }

  // 已签名：显示地址与断开入口
  if (state === 'ready' && wallet) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="flex items-center gap-1.5 rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-2.5 py-1.5 font-mono text-xs text-emerald-300"
          title={wallet}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {shortAddr(wallet)}
        </span>
        <button
          type="button"
          onClick={disconnect}
          className="rounded-lg border border-ink-700 px-2 py-1.5 text-xs text-ink-400 transition-colors hover:border-ink-600 hover:text-ink-200"
        >
          {t('wallet.disconnect')}
        </button>
      </div>
    );
  }

  // 出错：给出原因与重试
  if (state === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="max-w-[16rem] truncate text-xs text-rose-400" title={error ?? ''}>
          {t('wallet.signFailed')}
        </span>
        <button
          type="button"
          onClick={() => void retry()}
          className="rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
        >
          {t('wallet.retry')}
        </button>
      </div>
    );
  }

  // 连了钱包但还没签名
  if (state === 'need-sign') {
    return (
      <button
        type="button"
        onClick={() => void connect()}
        className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-ink-950 transition-colors hover:bg-amber-400"
      >
        {t('wallet.sign')}
      </button>
    );
  }

  // 未连钱包
  return (
    <button
      type="button"
      onClick={() => void connect()}
      className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs font-medium text-ink-100 transition-colors hover:border-ink-500 hover:bg-ink-700"
    >
      {t('wallet.connect')}
    </button>
  );
}
