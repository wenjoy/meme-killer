'use client';

/**
 * Solana 钱包 Provider。
 *
 * 放在 `layout.tsx` 里包住整棵树 —— 页面、报告、语言切换都要能读钱包状态。
 */
import { ConnectionProvider, WalletProvider as AdapterProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { useMemo, type ReactNode } from 'react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { CoinbaseWalletAdapter } from '@solana/wallet-adapter-coinbase';
import { TrustWalletAdapter } from '@solana/wallet-adapter-trust';

// 钱包弹窗的默认样式（必须引入，否则弹窗没有样式、看起来像坏掉了）
import '@solana/wallet-adapter-react-ui/styles.css';

/**
 * RPC 端点。
 *
 * ⚠️ 这里**不需要**真实可用的 RPC：本站所有链上数据都走服务端
 * （`/api/scan`），前端只做签名验证。但 Wallet Adapter 要求有个 connection，
 * 所以给一个公共端点占位。
 *
 * 为什么不直接用 `NEXT_PUBLIC_SOLANA_RPC_URL`：
 * 那会把带 API key 的 Helius 地址暴露到浏览器 —— key 会被任何人从
 * 网络请求里抄走，等于白送额度（这正是本次要防的事）。
 */
const PLACEHOLDER_RPC = 'https://api.mainnet-beta.solana.com';

export function WalletProvider({ children }: { children: ReactNode }) {
  /**
   * 显式注册主流钱包适配器。
   *
   * ⚠️ 之前用空数组 `[]`，指望 Wallet Adapter 自动发现注入的 provider。
   * 实测**不可靠**：钱包选择器里一个都不显示，用户点了「连接钱包」后
   * 看到空弹窗，根本连不上 —— 表现就是「按钮一直是连接钱包」。
   *
   * 只装 4 个主流钱包（Phantom / Solflare / Trust / Coinbase）。
   * 不引入 WalletConnect（体积大、要额外配置 projectId）。
   * ⚠️ Backpack 没有独立适配器包（它走 Wallet Standard 自动注册），
   * 所以这里不列它 —— 装了会编译不过。
   */
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new TrustWalletAdapter(),
      new CoinbaseWalletAdapter(),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={PLACEHOLDER_RPC}>
      <AdapterProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </AdapterProvider>
    </ConnectionProvider>
  );
}
