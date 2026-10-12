# ─────────────────────────────────────────────────────────────────────
# Meme Killer —— Fly.io 部署镜像
#
# 三阶段构建：
#   deps    装依赖（含 better-sqlite3 的**编译**，需要 python3/g++）
#   builder 跑 next build
#   runner  只带运行必需的东西
#
# 为什么必须多阶段：better-sqlite3 是原生模块，编译要几百 MB 工具链，
# 但运行时只需要那个 .node 二进制。单阶段镜像会大出一个数量级。
# ─────────────────────────────────────────────────────────────────────

# ── 1. 依赖 ──
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 优先用预编译包，但 Node 版本不匹配时会回退到源码编译，
# 所以工具链必须装 —— 否则在构建机上「碰巧有预编译包」能过，
# 换个架构就炸，且报错很难懂。
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── 2. 构建 ──
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ⚠️ 构建期不能连真实数据源：provider 会读 process.env，
# 但 Next.js 的构建不应该真的去发 RPC 请求（会很慢且可能失败）。
# 这里给占位值，运行时由 Fly 的 secrets 覆盖。
ENV NEXT_TELEMETRY_DISABLED=1
ENV SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"

RUN npm run build

# ── 3. 运行 ──
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 非 root 运行。Fly 的机器默认以 root 跑，但应用没有理由要 root。
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# standalone 产物：自带最小化的 node_modules 与 server.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# ⚠️⚠️ 本项目最容易踩的坑：better-sqlite3 的原生二进制。
#
# Next.js 的 standalone 裁剪**会**把 better-sqlite3 目录带上（因为
# next.config.ts 里声明了 serverExternalPackages），但它只跟踪**构建机
# 当前平台**的那个 .node 文件 —— 在 macOS 上构建时带的是
# prebuilds/darwin-arm64.node，而容器是 linux-x64，运行时会报
# 「Could not locate the bindings file」。
#
# 所以这里从 builder 阶段整体覆盖这个包（该包自带全平台 prebuilds：
# linux-x64 / linux-arm64 / linuxmusl-* …）。覆盖而不是「补一个文件」，
# 是为了不依赖 Next.js 内部跟踪行为的细节 —— 它变了我们也不受影响。
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

# 埋点数据库落在挂载的卷上（见 fly.toml 的 [mounts]）
ENV ANALYTICS_DB=/data/analytics.db
RUN mkdir -p /data && chown -R nextjs:nodejs /data
VOLUME ["/data"]

# 产物校验：如果原生二进制不对，**在构建阶段就失败**，
# 而不是等部署完、用户点第一次扫描时才报错。
# 这里显式断言加载的是 linux 版，且真的能开库。
RUN node -e "\
  const p = require.resolve('better-sqlite3');\
  const D = require('better-sqlite3');\
  const fs = require('fs');\
  const bin = require('path').join(require('path').dirname(p), '..', 'prebuilds', process.platform + '-' + process.arch + '.node');\
  if (!fs.existsSync(bin)) { console.error('缺少本平台原生二进制: ' + bin); process.exit(1); }\
  const db = new D(':memory:');\
  db.exec('CREATE TABLE t(a)'); db.prepare('INSERT INTO t VALUES (?)').run('ok');\
  console.log('better-sqlite3 自检通过 (' + process.platform + '-' + process.arch + '): ' + db.prepare('SELECT a FROM t').get().a);\
  " && rm -rf /tmp/*

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
