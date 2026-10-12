import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Docker 部署用：产出一个自带最小依赖的 .next/standalone 目录。
  // 不加的话镜像要把整个 node_modules（1.4G）搬进去，没必要。
  output: 'standalone',
  // 链上 provider 会读 process.env，不在构建期求值
  //
  // ⚠️ better-sqlite3 必须在这里：它是**原生模块**（.node 二进制），
  // 被 bundler 打包后会因为路径变化而加载失败。列在这里 = 运行时从
  // node_modules 直接 require，保持原样。Dockerfile 里也特意保留了它。
  serverExternalPackages: ['@solana/web3.js', 'better-sqlite3'],
  // 开发时用 127.0.0.1 访问会被判定为跨域，HMR 与客户端资源会被拦截，
  // 表现为「点了按钮页面不更新」。显式允许本机地址。
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
