/**
 * 解析钩子实现：把无扩展名的相对/别名 import 映射到实际的 .ts 文件。
 * 见 ./test-setup.mjs 的说明。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// 本文件位于 <root>/src/core/，所以要上溯两层才是项目根。
// （上溯一层会得到 src，进而把 @/x 解析成 src/src/x —— 那样任何
//   使用 @/ 别名的模块一旦被测试 import 就会报「找不到包」。）
const HERE = path.dirname(fileURLToPath(import.meta.url)); // <root>/src/core
const PROJECT_ROOT = path.resolve(HERE, '..', '..'); // <root>
const SRC_ROOT = path.join(PROJECT_ROOT, 'src'); // <root>/src

const CANDIDATES = ['.ts', '.tsx', '/index.ts', '.mjs', '.js'];

export async function resolve(specifier, context, nextResolve) {
  // 别名 @/* → src/*
  if (specifier.startsWith('@/')) {
    const base = path.join(SRC_ROOT, specifier.slice(2));
    const resolved = tryExtensions(base);
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  // 相对路径补扩展名
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : PROJECT_ROOT;
    const base = path.resolve(path.dirname(parentPath), specifier);
    if (!existsSync(base)) {
      const resolved = tryExtensions(base);
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}

function tryExtensions(base) {
  for (const ext of CANDIDATES) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
