# 架构与 API

> 面向维护者。项目结构、模块职责、接口契约。

## 项目结构

```
src/
  core/
    types.ts              归一化数据契约（分析器只依赖它，不关心数据来源）
    constants.ts          风控阈值 + 协议固定标识 + 评分/分档工具
    engine.ts             编排各维度 → 硬否决短路 → 加权总分 → 中文报告
    analyzers/
      contract.ts         合约安全：权限、Token-2022 扩展、转移税、LP 锁定
      liquidity.ts        流动性：bonding curve 深度、刷量、蜜罐、抛压（+ 单位纪律）
      holders.ts          持币集中度：先分类剔除池/burn，再算占比（含狙击筹码），
                          并产出前 20 大持仓明细（Top10 要能被读者自己加出来）
      developer.ts        开发者履历：发币数量、dev 清仓（历史结局不猜）
      social.ts           社交热度：刷量识别（不做否决）
    fixtures.ts           测试夹具（仅测试用，不参与运行时）
    engine.test.ts        引擎与分析器测试
  providers/
    helius.ts             Solana RPC + DAS getAsset + Enhanced API（元数据/部署者/成交明细）
    pools.ts              曲线账户推导与解码（阶段 + 真实 SOL）、池 ATA 推导
    dexscreener.ts        市场数据：价格、成交量、买卖笔数、pair 地址
    rugcheck.ts           LP 锁定/销毁与 LP 持有者、持有人总数、池金库、风险项
    index.ts              采集编排 + 优雅降级
    pools.test.ts         池推导与曲线解码测试
    rugcheck.test.ts      RugCheck 映射测试（含 bonding curve 陷阱）
  app/
    page.tsx              首页：地址输入 + 数据源能力自检
    api/scan/route.ts     POST /api/scan、GET /api/scan（能力自检）
  components/
    Report.tsx            报告：结论、否决置顶、各维度明细、数据来源
    visuals.tsx           分数圆环 + 雷达图（手写 SVG，无图表库依赖；不含钻石手，见 §19）
```

**架构要点**：分析器只依赖归一化数据结构，不关心数据来源。
接入新数据源只需新增一个 provider，分析逻辑零改动。

**关于测试数据**：`fixtures.ts` 只在单元测试里使用。
`src/providers/` 下全部是真实数据源，页面与 API 也只走真实链路 ——
**不存在任何会被用户看到或触发的模拟数据路径。**

---


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

```bash
# 全量持有人明细（分页 / 搜索 / 分类筛选 / CSV）—— 必须先扫描过该 mint
curl 'http://127.0.0.1:5273/api/holders?mint=<mint>&page=1&pageSize=50'
curl 'http://127.0.0.1:5273/api/holders?mint=<mint>&q=4JBz&kind=related'
curl 'http://127.0.0.1:5273/api/holders?mint=<mint>&includeEmpty=1&format=csv' -o holders.csv

# 账户数超过自动上限时，强制枚举全量分布（会重新扫描一次，较慢）
curl -X POST http://127.0.0.1:5273/api/scan \
  -H 'content-type: application/json' \
  -d '{"mint":"<mint>","forceOverview":true}'
```

`includeEmpty` 默认关（只给有余额的持有人）；`kind` 可传
`pool,burn,timelock,custody,dev,related,sniper,retail`；CSV 是当前筛选下的**全量**行。
缓存过期会返回 `409 / NEED_SCAN`，而不是给旧数据。

---
