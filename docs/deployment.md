# 部署

> 面向维护者。三条路：本地 Docker、自有机器、Fly.io。
> 为什么不能上 Vercel 见下。

## 先看这条：没有信用卡怎么办

**Fly.io 现在要求绑卡**（即使只用免费额度），没卡就走不了。
这不是能绕过的 —— 用别人的卡、虚拟卡都有账号风控风险，不建议。

不需要卡的方案：

| 方案 | 适用 | 限制 |
|---|---|---|
| **本机 Docker**（推荐先用这个） | 自己电脑/公司机器 | 机器关机服务就停；公网访问要自己配 |
| **自有 VPS**（Hetzner/DO/国内厂商） | 长期跑 | 要花钱（约 $5/月），但不需要「绑卡给平台」 |
| **Oracle Cloud Always Free** | 想要免费长驻 | ARM 机型长期免费，注册有时要卡验证 |
| **GitHub Codespaces** | 只做**演示** | 最长 6 小时会断，**不能当长期服务** |
| Fly.io | 有卡时最省事 | 要绑卡 |

⚠️ 不要为了「不要卡」去用 serverless 平台（Vercel/Netlify）——
见下方说明，架构不兼容。

---

## 方案 A：本机 Docker（无需卡）

仓库根目录已备好 `docker-compose.yml`：

```bash
# 1. 确认 .env.local 里有 RPC 配置
cat .env.local

# 2. 构建并启动（首次约 5-10 分钟，要编译 better-sqlite3）
docker compose up -d --build

# 3. 打开
open http://127.0.0.1:5273

# 4. 看日志 / 停止
docker compose logs -f
docker compose down
```

埋点数据存在 Docker 命名卷里，容器重建不丢。

**想让别人访问**：需要把端口暴露到公网。最简单的两种：

```bash
# 临时给人看（Cloudflare 免费隧道，不需要卡、不需要域名）
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:5273
# 会输出一个 https://xxx.trycloudflare.com 给你

# 或者用 Tailscale / frp / 路由器端口转发
```

⚠️ 隧道地址是**公开的**，任何人拿到都能用。上线前建议先加全局每日限额
（见文末「额度风险」）。

---

## 方案 B：Fly.io（需要卡）


## 为什么是 Fly.io 而不是 Vercel

本项目的架构假设**进程长期存活且只有一个实例**。Vercel 的 serverless
模型与这个假设直接冲突，不是改配置能解决的：

| 组件 | 位置 | 在 Vercel 上会怎样 |
|---|---|---|
| 限流桶 | `src/server/rateLimit.ts` 内存 Map | 每请求可能新实例 → **限流失效**，Helius 额度被刷爆 |
| 深度任务队列 | `src/providers/deepJobs.ts` 内存 Map | 轮询落到别的实例 → **永远查不到任务**，页面卡住 |
| 签名 nonce | `src/server/walletAuth.ts` 内存 Map | 取 nonce 与验签不在同一实例 → 签名随机失败 |
| 埋点数据库 | SQLite 本地文件 | 文件系统只读/临时 → **数据全丢** |

要在 Vercel 上跑，这四处都得换成外部服务（Upstash Redis + 托管数据库），
且**每加一个内存状态就要重复改造** —— 是持续成本，不是一次性成本。

Fly.io 是长驻容器，**零代码改动**。

> ⚠️ 另外：Vercel Hobby（免费版）函数超时上限 60 秒，而深度分析实测
> **121 秒**，在免费版上必然超时失败，必须升 Pro（$20/月）。

---

## 部署步骤

### 0. 前置

```bash
brew install flyctl      # 或 curl -L https://fly.io/install.sh | sh
fly auth login
```

### 1. 首次创建（不要直接 deploy）

```bash
fly launch --no-deploy --copy-config --name <你的应用名>
```

`--copy-config` 表示用仓库里已有的 `fly.toml`（已配好单实例与卷）。

⚠️ **改 `fly.toml` 里的 `primary_region`**：默认 `sjc`（圣何塞）离
Solana RPC 节点近；主要用户在亚洲就改 `nrt`（东京）。

### 2. 创建持久卷（埋点数据库）

```bash
fly volumes create meme_killer_data --size 1 --region <与 primary_region 一致>
```

1GB 足够 —— 埋点是每事件一行，几年也就几十 MB。

### 3. 设置密钥（**必须，别跳过**）

```bash
fly secrets set \
  SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=你的key" \
  HELIUS_API_KEY="你的key" \
  AUTH_SECRET="$(openssl rand -hex 32)"
```

- `SOLANA_RPC_URL` / `HELIUS_API_KEY`：不设就只有标准 RPC，
  「流动性」与「开发者历史」两个维度标记未采集，覆盖率掉到 65%。
- `AUTH_SECRET`：**不设的后果**（代码里会告警）：
  1. 每次重启生成新密钥 → 所有用户会话失效，需重新签名
  2. **埋点的匿名用户 ID 会变**（HMAC 密钥变了）→ 重启前后
     同一批用户被算成两批，留存数据断裂

### 4. 部署

```bash
fly deploy
```

首次构建约 5–10 分钟（要编译 `better-sqlite3` 并跑 `next build`）。

### 5. 验证

```bash
fly open                                  # 打开站点
curl https://<app>.fly.dev/api/scan       # 能力自检，应返回 JSON
fly logs                                  # 看日志
fly status                                # 确认只有 1 台机器
```

---

## ⚠️ 绝对不能做的事

### 不要扩容到多实例

```bash
fly scale count 2        # ❌ 千万别
```

两个实例 = 限流额度翻倍（正是要防的事）+ 深度任务轮询随机失败。
`fly.toml` 里已用 `min_machines_running = 1` + `auto_stop_machines = false`
锁定，但手动 `fly scale` 会绕过它。

**卷本身也是单机绑定的** —— 多实例时只有一台能挂载 `/data`。

### 不要提交 `.env.local`

已在 `.gitignore` 与 `.dockerignore` 里。Fly 的密钥走 `fly secrets`。

---

## 排障

### `Could not locate the bindings file`

`better-sqlite3` 的原生二进制不匹配。**这是本项目最容易踩的坑**：

Next.js 的 standalone 裁剪会带上 `better-sqlite3` 目录，但**只带构建机
当前平台的那个 `.node`** —— 在 macOS 上构建时带的是 `darwin-arm64.node`，
容器需要 `linux-x64.node`。

`Dockerfile` 已通过「整体覆盖该包目录」解决（该包自带全平台 prebuilds），
并在构建阶段做了断言 —— 二进制不对时**构建就失败**，不会拖到运行时。

### 部署后扫描报 401 / 429

- 401 = 没带有效会话 → 正常，前端会提示连接钱包
- 429 = 触发限流（每钱包 60 秒 1 次扫描、5 分钟 1 次深度分析）→ 正常

### 埋点数据不增长

```bash
fly ssh console
ls -la /data          # 卷挂上了吗
echo $ANALYTICS_DB    # 应该是 /data/analytics.db
```

看日志里有没有 `[analytics] 无法打开数据库`。

### 深度分析总是超时

深度分析实测约 2 分钟（50 地址 × 133 次分页）。若 `fly.toml` 的
`hard_limit` 设太小，长连接会被切断。

---

## 更新部署

```bash
fly deploy               # 重新构建并滚动更新
fly logs                 # 观察
```

⚠️ 部署会**重启进程** → 内存里的限流桶、nonce、深度任务队列全部清空。
已完成的扫描结果不受影响（那些在浏览器侧），但正在跑的深度任务会丢失。
所以**不要在用户活跃时部署**。

---

## 成本

`shared-cpu-1x` + 512MB + 1GB 卷约 $2–4/月。Fly 对新账号有免费额度，
但**卷与固定 IP 可能计费**，以控制台为准。

---

## 安全提醒：额度风险

公开部署后，**Helius 免费额度（通常 100 万 credits/月）可能被快速耗尽**。
现有防护是「每钱包 60 秒 1 次」，但攻击者可以生成大量钱包各扫一次。

**未实现**：IP 维度限流、全局每日上限。如果站点公开且流量可观，
建议加一个「全局每日扫描上限」，到顶就礼貌提示而不是让 Helius 报错。
