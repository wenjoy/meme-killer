# Meme Radar · Pump.fun 买入风险体检

输入一个 Solana mint 地址，判断这个 meme coin **是否值得买入**、
以及**有哪些会让你血本无归的机制**。

五维链上风控 → 硬否决短路 → 仓位建议。**全部结论来自实时真实数据，没有任何模拟数据。**

> ⚠️ **本工具不构成投资建议。** 评分低只代表「未发现明显问题」，
> 不代表安全 —— meme 币归零是常态。

---

## 快速开始

```bash
npm install
cp .env.example .env.local     # 填入你的 Helius RPC / API key（见下）
npm run dev                    # → http://127.0.0.1:5273

npm test                       # 37 个测试
npm run typecheck
npm run build
```

### 配置数据源（必读）

本项目**只使用真实数据源**，因此必须配置一个可用的 RPC 端点。
公共节点 `api.mainnet-beta.solana.com` 限流极严重 ——
一次扫描要发十几次 RPC 调用，用公共节点几乎必然失败。**建议用 Helius。**

```bash
# .env.local
SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=你的key"
HELIUS_API_KEY=""     # 可选：RPC URL 里带了 api-key 就不用重复填
```

页面顶部会显示**数据源能力自检**，明确告诉你当前配置下哪些维度能真正生效。

---

## 数据来源与维度覆盖

三个数据源，各司其职：

| 数据源 | 提供什么 | 需要 key |
|---|---|---|
| **Solana RPC**（Helius） | mint 账户、mint/freeze 权限、Token-2022 扩展、最大持仓 | 是（推荐 Helius） |
| **Helius Enhanced API** | 部署者身份与元数据、部署者资金来源、交易历史（dev 卖出、历史发币） | 是（同一个 key） |
| **DexScreener** | 价格、市值、成交量、买卖笔数、AMM pair 地址 | 否（公开免费） |

对应的维度覆盖情况：

| 维度 | 权重 | 数据来源 | 无 Helius key 时 |
|---|---|---|---|
| 合约安全 | 30% | Solana RPC | 可计算 |
| 流动性 & 资金流 | 25% | DexScreener + RPC | 可计算 |
| 持币集中度 | 20% | Solana RPC + PDA 推导 | 可计算 |
| 开发者历史 | 15% | Helius Enhanced API | **标记未采集** |
| 社交热度 | 10% | 需 X/TG 第三方服务（**当前未接入**） | 不计分 |

社交热度是唯一没有真实数据源的维度：Helius 不提供社交数据，
链上也拿不到社区质量。因此它**恒为「未采集」且不计入评分** ——
不会用任何替代值伪装成已检查。

### 硬否决项（一票判死）

| 维度 | 否决条件 |
|---|---|
| 合约安全 | mint / freeze authority 未放弃；Token-2022 含 TransferHook / PermanentDelegate |
| 流动性 | 已抽池；买盘一边倒但卖单笔数 < 5%（蜜罐） |
| 持币集中度 | 剔除池/burn 后 Top10 > 40% |
| 开发者历史 | 历史 rug ≥ 2 次；dev 已清仓 |

风险等级：`< 25` 低 · `25–45` 中 · `45–65` 高 · `> 65` 极高。
**命中否决时总分直接拉满 100** —— 保证分数与结论不矛盾。

---

## 设计上的关键决策

这些来自对真实 rug 手法的调研，直接决定检测准不准。

### 1. 池地址必须**推导**出来，不能靠正则猜 —— 最大的误报源

bonding curve / AMM pool 天然持有大部分供应量。不剔除，任何正常项目都会被算成
「Top10 控盘 80%」。

真实池地址是**随机 base58 字符串**，用 `/pool|vault|amm/` 这类正则去匹配
**几乎永远匹配不到** —— 只会让人误以为已经处理过了。所以 `pools.ts` 用确定性推导：

- pump.fun bonding curve PDA：`seeds = ["bonding-curve", mint]`
- PumpSwap 池 PDA：`seeds = ["pool", index, creator, base_mint, quote_mint]`
- **池的 ATA**：池持有代币用的是它的 associated token account，
  只认池地址会漏掉真正的持仓账户
- DexScreener 的 `pairAddress`（AMM 池地址的直接来源）

`pools.test.ts` 锁住了这一点：同一份数据，认不出池就会误报庄家控盘。

### 2. 未知 ≠ 安全，也 ≠ 危险 —— 本项目最花心思的部分

真实数据源经常只给一部分数据。把缺失当成 0，会得到两种致命错误：

- **把缺失当「安全」** → 报告显示绿色「低风险」，用户以为体检过了
- **把缺失当「危险」** → 凭空报出高风险，用户被吓跑

因此：每个分析器在数据缺失时返回 `available: 0` 并说明缺失原因，
引擎据此算出**数据覆盖率**；覆盖率 < 40% 时，
连**分数和等级一起作废**，显示「数据不足 · 无法评估」并**拒绝给出仓位建议**。

只改建议文案是不够的 —— 用户第一眼看的是那个绿色大数字，
它会直接盖过下面「数据不足」的提示。

**这个原则贯彻到了 provider 层**：RPC 读失败时返回 `contract: null`
而不是空对象 `{}`。返回 `{}` 会让「权限状态未知」冒充「已检查」，把覆盖率从 0% 抬到 30%。

### 3. 部署者 ≠ fee payer

Pump.fun 的交易由**用户钱包**签名，fee payer 往往是买家而不是发币人。
真正的部署者写在 Metaplex metadata 的 `creators` 字段里。
用 fee payer 当 creator 会追错人，整个「开发者历史」维度都是错的。

只有在 metadata 无 `creators` 时才回退到「发币交易的 fee payer」，
**并在 warnings 里明确标注这是推断值**。

### 4. 「买盘一边倒」可能是蜜罐，不是利好

看到买盘占 97% 容易以为是强势。但若**卖单笔数**极少（< 5%），
真实含义是「根本卖不出去」。所以必须**同时**看金额占比和笔数占比 —— 只看金额会漏报。
反过来只看笔数也会误判：毕业瞬间的抢购笔数极高，并非刷量。

### 5. 刷量要用「净 SOL 流入」而非「笔数」

高笔数 + 净流入 ≈ 0 才是对倒刷量。
进一步地，**笔数比与金额比背离**（买单笔数是卖单 2 倍，但买入金额不到卖出的一半）
说明「小额买盘撑笔数、大额卖盘出货」。

### 6. 权限必须读到 `null` 才算「已放弃」

`c.mintAuthority ? 0 : 1` 会把 `undefined`（没读到）当成「已放弃」，
在 UI 上渲染成绿色的安全标记。所以权限状态是**三态**：
`1` = 已放弃，`0` = 未放弃，`-1` = 未知。

### 7. 代币程序必须读 `getAccountInfo().owner`

`getParsedAccountInfo` 返回的 `parsed.info.owner` 是 **authority**，不是代币程序。
混淆这两者会导致「所有代币都用了 Token-2022」的严重误判。

### 8. dev 卖出部分 ≠ rug；账号新 ≠ bot

部分回收成本在 meme 圈极常见，只有「清仓 + 时间很早」才升级为高危。
同理，meme 玩家本来就开新钱包新 X 号，判定 bot 要看**行为聚类**而不是注册时间。

### 9. 不猜

拿不到的字段留空。「这个代币是不是 rug」需要价格与流动性历史，
单次 RPC 查询无法负责任地断言 —— 因此 `priorRugCount` **不猜**，
宁可留空也不用启发式编一个看起来确定的数字。

---

## 项目结构

```
src/
  core/
    types.ts              归一化数据契约（分析器只依赖它，不关心数据来源）
    constants.ts          风控阈值 + 协议固定标识 + 评分/分档工具
    engine.ts             编排五维 → 硬否决短路 → 加权总分 → 中文报告
    analyzers/
      contract.ts         合约安全：权限、Token-2022 扩展、转移税、LP 锁定
      liquidity.ts        流动性：抽池、刷量、蜜罐、抛压、狙击
      holders.ts          持币集中度：先分类剔除池/burn，再算占比
      developer.ts        开发者履历：历史 rug、批量发币、dev 清仓
      social.ts           社交热度：刷量识别（不做否决）
    fixtures.ts           测试夹具（仅测试用，不参与运行时）
    engine.test.ts        引擎与分析器测试
  providers/
    helius.ts             Solana RPC + Helius Enhanced API（元数据/部署者/资金来源/交易历史）
    pools.ts              池地址确定性推导（bonding curve / PumpSwap PDA / ATA）
    dexscreener.ts        市场数据：价格、成交量、买卖笔数、pair 地址
    index.ts              采集编排 + 优雅降级
    pools.test.ts         池推导测试
  app/
    page.tsx              首页：地址输入 + 数据源能力自检
    api/scan/route.ts     POST /api/scan、GET /api/scan（能力自检）
  components/
    Report.tsx            报告：结论、否决置顶、五维明细、数据来源
    visuals.tsx           分数圆环 + 五维雷达图（手写 SVG，无图表库依赖）
```

**架构要点**：分析器只依赖归一化数据结构，不关心数据来源。
接入新数据源只需新增一个 provider，分析逻辑零改动。

**关于测试数据**：`fixtures.ts` 只在单元测试里使用。
`src/providers/` 下全部是真实数据源，页面与 API 也只走真实链路 ——
**不存在任何会被用户看到或触发的模拟数据路径。**

---

## API

```bash
# 能力自检：当前配置下哪些维度可用
curl http://127.0.0.1:5273/api/scan

# 扫描
curl -X POST http://127.0.0.1:5273/api/scan \
  -H 'content-type: application/json' \
  -d '{"mint":"<mint address>"}'
```

返回 `ScanReport`：`score` / `band` / `vetoed` / `vetoes` / `dimensions` /
`advice` / `coverage` / `meta`（数据来源与告警）。

---

## 已知限制

界面上的「数据来源」面板会逐字段标注
**链上 / DexScreener / 推算 / 未采集**，`meta.warnings` 列出所有采集告警。
**请务必区分「链上事实」与「推算值」。**

- **社交热度无数据源** —— Helius 不提供，链上也拿不到，恒为「未采集」
- **历史 rug 数不计算** —— 需要价格与流动性历史，本工具只用单次查询，不猜
- **LP 锁定状态无法从 RPC 判定** —— 需解析锁仓程序或接 RugCheck，当前标为「未知」
- **链上只返回前 20 大持仓账户** —— 更深的分布需要索引器
- **部分 AMM 的 vault authority 无法推导**（如 Raydium v4 的独立 vault），
  这类池持仓可能未被剔除，会让 Top10 偏高；命中时会在 warnings 里提示
- **DexScreener 不直接提供买卖金额** —— 当前按笔数比例拆分，属推算值

**交叉验证渠道**：RugCheck、DexScreener、Solscan、Bubblemaps。

---

## 后续可做

- [ ] 接入 X/TG 社交数据源，让「社交热度」维度真正生效
- [ ] 接入索引器回溯 creator 历史代币的价格/流动性，计算真实 rug 率
- [ ] 用 Raydium/Meteora 的 vault 账户列表补全池剔除
- [ ] 用 Enhanced API 完整交易历史计算真实净 SOL 流入（替代按笔数推算）
- [ ] 新币发现榜 + 批量扫描排序
- [ ] 自选监控与定时复扫、风险变化提醒
- [ ] 扫描结果快照持久化，支持「上次 vs 本次」差分（抽池检测更可靠）
