import type { Metadata } from 'next';
import './globals.css';

import { I18nProvider } from '@/i18n';
import { WalletProvider } from '@/components/WalletProvider';
import { WalletGateProvider } from '@/components/WalletGate';

export const metadata: Metadata = {
  title: 'Meme Killer',
  description:
    'Score Solana meme tokens on contract safety, liquidity, holder concentration, developer history and social signal — with hard vetoes and a position-size recommendation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // lang 是初值，I18nProvider 挂载后会按实际语言改写（含 en）
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        {/* 钱包 Provider 在外层：报告里也要读钱包状态（决定能否扫描/深度分析） */}
        <WalletProvider>
          {/* GateProvider 要在 WalletProvider 内层（它读 useWallet），
              在 I18nProvider 外层（错误信息要能本地化） */}
          <I18nProvider>
            <WalletGateProvider>{children}</WalletGateProvider>
          </I18nProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
