'use client';

/**
 * Solana 钱包 Provider。
 *
 * 放在 `layout.tsx` 里包住整棵树 —— 页面、报告、语言切换都要能读钱包状态。
 */
import { ConnectionProvider, WalletProvider as AdapterProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { useMemo, type ReactNode } from 'react';

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
  // 空数组：只用钱包自己注入的适配器（Phantom / Solflare / Backpack …），
  // 不打包 WalletConnect 之类的重型依赖。
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={PLACEHOLDER_RPC}>
      <AdapterProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </AdapterProvider>
    </ConnectionProvider>
  );
}
