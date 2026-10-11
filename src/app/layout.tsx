import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Meme Killer',
  description:
    '输入 Solana mint 地址，从合约安全、流动性、持币集中度、开发者历史、社交热度等维度评估代币风险，并给出硬否决项与仓位建议。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
