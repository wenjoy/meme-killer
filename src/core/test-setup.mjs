/**
 * Node 测试用的模块解析钩子。
 *
 * 源码里的 import 走 bundler 风格（无扩展名，如 `from '@/core/constants'`），
 * 这是 Next.js 的约定；但 Node 的 ESM 解析器要求写全扩展名。
 * 这个钩子把两种情况桥接起来，让测试能直接跑 TypeScript 源码，
 * 无需额外的构建步骤或 ts-node 依赖。
 */
import { register } from 'node:module';

// 用本文件自身的 URL 作基准注册，避免依赖当前工作目录
register('./ts-resolver-hooks.mjs', import.meta.url);
