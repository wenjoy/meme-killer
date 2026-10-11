import type { Metadata } from 'next';
import './globals.css';

import { I18nProvider } from '@/i18n';

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
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
