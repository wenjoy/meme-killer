'use client';

/**
 * 顶部的钱包按钮 —— 与表单里那个是同一个动作、同一套样式。
 *
 * 四种状态：
 * - 未连钱包 / 连了但没签名 → 「连接钱包」（点击一次走完全程）
 * - 签名中                  → 禁用
 * - 已签名                  → 显示缩略地址 + 断开
 * - 出错                    → 提示 + 重试
 */
import { useI18n } from '@/i18n';
import { useWalletGate, WALLET_BTN_PRIMARY, WALLET_BTN_SECONDARY } from './WalletGate';

function shortAddr(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function WalletButton() {
  const { t } = useI18n();
  const { state, wallet, error, connect, disconnect, retry } = useWalletGate();

  if (state === 'signing') {
    return (
      <button type="button" disabled className={WALLET_BTN_PRIMARY}>
        {t('wallet.signing')}
      </button>
    );
  }

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
        <button type="button" onClick={disconnect} className={WALLET_BTN_SECONDARY}>
          {t('wallet.disconnect')}
        </button>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="max-w-[14rem] truncate text-xs text-rose-400" title={error ?? ''}>
          {t('wallet.signFailed')}
        </span>
        <button type="button" onClick={() => void retry()} className={WALLET_BTN_SECONDARY}>
          {t('wallet.retry')}
        </button>
      </div>
    );
  }

  // no-wallet 与 need-sign 合并：两种情况下都是「点一次 → 连上并签名」，
  // 分开展示只会让用户以为要先连再签（旧版就是这样，要点两次）。
  return (
    <button type="button" onClick={() => void connect()} className={WALLET_BTN_PRIMARY}>
      {t('wallet.connect')}
    </button>
  );
}
