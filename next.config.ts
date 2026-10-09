import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 链上 provider 会读 process.env，不在构建期求值
  serverExternalPackages: ['@solana/web3.js'],
  // 开发时用 127.0.0.1 访问会被判定为跨域，HMR 与客户端资源会被拦截，
  // 表现为「点了按钮页面不更新」。显式允许本机地址。
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
