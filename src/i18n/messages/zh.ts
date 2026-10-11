/**
 * 中文文案（基准字典）。
 *
 * ⚠️ 这份字典是**类型的来源**：`Messages = typeof zh`，
 * 所以 en.ts 缺任何一个 key 都会编译失败 —— 漏译不会静默通过。
 * 键名用点分层级，与 Finding 的 ID 一一对应（`holders.top10Danger` 等）。
 */
import { findingsZh } from './findings.zh';
import { piecesZh } from './pieces.zh';
import { warningsZh } from './warnings.zh';

export const zh = {
  app: {
    name: 'Meme Killer',
    tagline: '',
    inputLabel: '输入 Solana mint 地址',
    inputPlaceholder: '粘贴 mint 地址',
    submit: '开始体检',
    scanning: '正在采集链上数据…',
    scanFailed: '扫描失败',
    scanFailedHint: '请稍后重试。若持续失败，可能是数据源暂时不可用。',
    deepQueued: '已排队 —— 前面有 {n} 个深度任务在跑',
    deepEta: '预计等待约 {min} 分钟',
    deepQueuedNote: '一次只跑一个深度任务，避免触发数据源限流导致结果不完整。可以离开这一页。',
    deepRunning: '深度分析进行中 —— 逐地址拉取完整历史，算出真实成本（不是窗口估算）',
    deepProgress: '{pct}%（{done}/{total}）',
    deepRunningNote: '前 50 名持有人约需 2 分钟，完成后自动重新生成报告。',
    deepFailed: '深度分析失败：{msg}',
    disclaimer:
      '由链上与公开数据自动生成，不构成投资建议。评分低只代表「未发现明显问题」，不代表安全 —— meme 币归零是常态。',
  },

  wallet: {
    connect: '连接钱包',
    sign: '签名以启用',
    signing: '等待签名…',
    disconnect: '断开',
    signFailed: '签名失败',
    retry: '重试',
    connecting: '连接中…',
    needsWallet: '请先连接钱包',
    howTo: '用网站前需要连接 Solana 钱包并签名。签名不发起交易、不花 gas。',
    required: '需要连接钱包并签名后才能使用',
    rateLimited: '请求太频繁，请等待 {sec} 秒',
  },
  tabs: {
    overview: '概览',
    holders: '持仓',
    flow: '资金流',
    behavior: '持仓行为',
  },

  verdict: {
    riskScore: '风险分',
    adviceSize: '建议仓位',
    price: '价格',
    marketCap: '市值',
    supply: '供应量',
    hardVetoes: '命中 {n} 项硬否决 —— 一票判死，与其它维度表现无关',
    unknownToken: '未知代币',
    noData: '无数据',
    dataMissing: '数据缺失',
    vetoed: '否决',
  },

  sections: {
    custody: '锁仓与托管持仓',
    overview: '全量持有人分布（链上枚举）',
    topHolders: '前 20 大持仓（链上能核对到的全部）',
    allHolders: '全部持有人明细',
    largeSells: '大额卖单',
    diamond: '钻石手（持仓行为）',
    sellPressure: '抛压分布',
    detail: '逐项体检明细',
    evidence: '以下是每个维度的依据',
    provenance: '数据来源',
  },

  radar: {
    noData: '无数据',
    note: '半径越大风险越高 · 灰色「无数据」表示该维度未采集',
  },

  dimensions: {
    contract: '合约安全',
    liquidity: '流动性',
    holders: '持币集中',
    developer: '开发者',
    social: '社交热度',
    diamond: '钻石手',
    sellPressure: '抛压分布',
  },

  bands: {
    low: '低风险',
    lowVerdict: '可考虑小仓买入',
    medium: '中等风险',
    mediumVerdict: '仅小仓位试探',
    high: '高风险',
    highVerdict: '建议观望',
    critical: '极高风险',
    criticalVerdict: '不要买入',
    dataInsufficient: '数据不足',
    cannotAssess: '无法评估',
    dataInsufficientAdvice:
      '仅采集到约 {coverage}% 的评估维度，数据不足以给出买入建议。请检查网络/数据源后重试，并自行到 RugCheck、DexScreener 交叉验证。',
    noAdvice: '数据不足，无法给出建议。请核对 mint 地址后重试。',
  },

  advice: {
    vetoed: '命中硬否决项，任何仓位都不应该开。建议直接放弃这个标的。',
    low: '各维度未发现明显问题，可小仓位参与。仍需设好止损，meme 币归零是常态。',
    medium: '存在若干风险点，若参与请严格控制仓位，并做好随时离场的准备。',
    high: '风险显著高于收益。建议观望，等待风险点消除或项目更成熟。',
    critical: '风险极高，不建议买入。',
  },


  /**
   * Report.tsx 的界面文案（表格表头、按钮、脚注等）。
   * 按区块分组，与 Report.tsx 里各 Section 组件对应。
   */
  report: {
    /** 通用 */
    common: {
      address: '地址',
      type: '类型',
      share: '占比',
      shareOfSupply: '占总供应',
      category: '分类',
      countedInConcentration: '计入集中度',
      count: '数量',
      yes: '是',
      no: '否',
      wallet: '钱包',
      distribution: '分布',
      notAvailableShort: '—',
      solscanHint: '点签名可在 Solscan 核对',
      dataIncomplete: '⚠️ 数据未取全',
      dimFailed: '执行失败',
      loadFailed: '加载失败（HTTP {status}）',
      // long = 表格/说明里用的完整名；short = 窄列里用的缩写。
      // ⚠️ 这两个必须与 constants.HOLDER_KIND_LABELS 的语义一一对应
      // （那边是中文基准，这里是展示层，改一边要想想另一边）。
      holderKinds: {
        // 长名直接是字符串：t('report.common.holderKinds.pool')
        // 短名在子对象里：  t('report.common.holderKinds.pool.short')
        // ⚠️ 短名不能再写成 'short.pool' 或 'pool.short' 这种扁平带点 key ——
        // lookup 按 `.` 分层，那个写法查不到，界面上会直接显示出这串 key。
        pool: '流动性池',
        burn: '销毁地址',
        timelock: '时间锁仓',
        custody: '程序托管',
        dev: 'creator 本人',
        related: '与部署者关联',
        sniper: '狙击仓位',
        retail: '散户',
        short: {
          pool: '池',
          burn: '销毁',
          timelock: '锁仓',
          custody: '托管',
          dev: 'creator',
          related: '关联',
          sniper: '狙击',
          retail: '散户',
        },
      },
      pnlBuckets: {
        hugeProfit: '浮盈 > 200%（随时获利了结）',
        profit: '浮盈 50% – 200%（有落袋动机）',
        smallProfit: '浮盈 10% – 50%',
        backToEven: '回本区 -10% ~ +10%（最易触发卖出）',
        smallLoss: '浮亏 10% – 50%（等回本）',
        hugeLoss: '浮亏 > 50%（通常死拿）',
      },
      custodyPrograms: {
        jupiterLock: 'Jupiter Lock（锁仓）',
        squadsMultisig: 'Squads 多签金库',
      },
      reportTabs: '报告分区',
      loading: '加载中…',
    },

    provenance: {
      anomalous: '数据源异常 · 结果不完整',
      warnings: '采集告警 {n} 条 —— 这些是「未知」，不等于「安全」',
      onchain: '链上',
      heuristic: '推算',
      unavailable: '未采集',
    },

    largeSells: {
      title: '大额卖单明细',
      subtitle:
        '最近 100 笔里最大的 {n} 笔，合计 {sol} SOL，{hint}',
      colTime: '时间（UTC）',
      colAmount: '金额 SOL',
      colTrader: '卖出钱包',
      colIdentity: '身份',
      colHoldingNow: '当前持仓',
      colSignature: '交易签名',
      creator: '部署者',
      earlyBuyerTitle: '代币最早 25 笔成交内的买家 —— 开盘就进场的人在出货',
      earlyBuyer: '开盘第 {n} 笔买入',
      unknownTitle: '本次没取到该代币的最早成交，无法判断身份 —— 不要读成「不是狙击手」',
      unknownIdentity: '身份未知（没取到最早成交）',
      notInEarlyTitle:
        '不是最早 25 笔成交的付款方；但这不等于确定不是早期买家（可能第 26 笔才买）',
      notInEarly: '不在最早 25 笔内',
      leftTop20: '已不在前 20',
      sniperNow: '（狙击仓位）',
      note1: '⚠️ 「大额」是相对该代币自身成交而言：这里列的是',
      noteBold1: '样本内最大的几笔',
      note2: '，不代表金额上有绝对意义。样本口径与上面的笔数/金额一致（最近 100 笔成交）。「身份」列看的是这些钱包',
      noteBold2: '是不是开盘那批人',
      note3: '：开盘就买入的地址在出货与半路进场的持有人止盈，性质完全不同。「不在最早 25 笔内」只说明它不是最早 25 笔成交的付款方，',
      noteBold3: '不等于',
      note4: '确定不是早期买家。',
    },

    custody: {
      colAddress: '地址',
      colType: '类型',
      colShare: '占比',
      colUnlockAt: '解锁时间',
      colCounted: '计入集中度',
      notTimelock: '—（非时间锁）',
      firstUnlock: '首次 {date}',
      allUnlock: '全部 {date}',
      custodyTitle:
        '托管仓位的 owner 是 PDA，拿不到账户去解析解锁计划，因此读不到到期日',
      pending: '待接入',
      excluded: '否 · 已剔除',
      transferable: '是 · 可随时转出',
      noteTimelockExcluded: '锁仓仓位已从 Top10 与巨鲸判断中剔除。',
      noteUnlockSource: '解锁时间取自锁仓程序自己的托管账户。',
      noteLinearRelease: '锁仓会随时间线性释放，解锁后即可抛售',
      noteNotAlwaysLocked: '，不是「一直锁着」。',
      noteUnreadable1: '解锁时间当前读不到，如实标为「待接入」——',
      noteNotUnlocked: '这不是「已解锁」',
      noteUnreadable2: '，到期日请另行确认。',
      noteCustody1: '{n} 个仓位由程序托管，但',
      noteCustodyNotTimelock: '多签/托管不是时间锁',
      noteCustody2: '，可随时签名转出，因此',
      noteStillCounted: '仍然计入集中度',
      noteCustody3: '，只是单独列出。',
    },

    topHolders: {
      sourceFull: '全量枚举',
      sourceSample: '前 20 名样本估算',
      headline:
        'Top10 集中度 {top10}%（占流通盘 {circ}%）= 下表「计入」前 {n} 行合计 {sum}%（占总供应）÷ 流通盘 {circ}%',
      note1:
        '「占总供应」这一列可以直接相加核对（锁仓那 72% 也算在里面，所以第一行就占掉半张表）；Top10 集中度则是把这些「计入」的行加起来再除以流通盘 {circ}%',
      noteSample: '—— 本次分子分母都只用前 20 名样本估的，加载全量持有人分布后会更准',
      colAddress: '地址',
      colCount: '数量',
      colShareOfSupply: '占总供应',
      colCategory: '分类',
      colCounted: '计入集中度',
      noPool: '否（池持仓）',
      noBurn: '否（已销毁）',
      noTimelock: '否（锁仓未解锁）',
      noteBottom1: '以下是',
      noteBottomBold: '能核对到的',
      noteBottom2:
        '前 20 名，不代表只有 20 个持有人。「计入集中度 = 否」的三类（池、销毁、锁仓）已从 Top10 与巨鲸判断中剔除；托管（多签）不剔除 —— 它可以随时签名转出。',
    },

    overview: {
      title: '全量持有人分布',
      emptyNote: '⚠️ 这不等于「没有持有人」——只是没在这个代币上自动拉全量分布。',
      loadFull: '按需加载全量分布（会重新扫描一次，较慢）',
      reloading: '正在重新扫描并枚举全量持仓…',
      titleFull: '全量持有人分布（链上枚举）',
      truncated: '⚠️ 未取全',
      complete: '已取全',
      statHolders: '持有人（按地址合并）',
      statAccountsSub: '{n} 个账户',
      statAccountsTotal: '持仓账户总数',
      statEmptySub: '含已清空 {n} 个',
      statNoEmptySub: '无空账户',
      statHalf: '达到 50% / 80% 需要',
      statHalfSub: '按剔除后的流通盘算',
      statDust: '灰尘持有人（< {pct}%）',
      statDustSub: '合计占 {pct}%',
      colRange: '持仓区间（占总供应）',
      colHolders: '持有人数',
      colTotalShare: '合计占比',
      colDistribution: '分布',
      pctOfHolders: '{pct}% 的人',
      note1: '按 ',
      noteBold1: 'owner 合并',
      note2: '统计（同一钱包的多个持币账户算一个人）：账户 {accounts} 个、有余额 {withBalance} 个',
      noteReported: '、RugCheck 报 {n} 个',
      noteMismatch1: ' —— ',
      noteMismatchBold: '口径对不上，差额不做推断',
      note3:
        '。剔除池 / 销毁 / 锁仓 {excluded}%，枚举覆盖总量 {covered}%',
      noteIncomplete: '（不到 100%，分布不完整）',
      noteEnd: '。',
    },

    curve: {
      title: '累计集中度曲线',
      legendWith: '含池 / 销毁 / 锁仓（占总量）',
      legendWithout: '剔除池/销毁/锁仓后（同用总量做分母）',
      ariaLabel: '累计集中度曲线',
      colRank: '前 N 名',
      colWith: '含池/销毁/锁仓',
      colWithSuffix: '（占总供应）',
      colWithout: '剔除后',
      colWithoutSuffix: '（占总供应）',
      colOfFloat: '剔除后',
      colOfFloatSuffix: '（占流通盘）',
      note1: '同一个 Top10 出现三个数只是因为',
      noteBoldDifferent: '分母不同',
      note2: '：中间那列「剔除后占总供应」是上面「持币集中度」里 Top10 集中度的',
      noteBoldNumerator: '分子',
      note3: '，最右列「占流通盘」＝ 中间那列 ÷（总量 − 池/销毁/锁仓），才是',
      noteBoldFinal: '最终显示的那个 Top10 集中度',
      note4: '。最外层那条线含锁仓所以看着很吓人 —— 那部分卖不掉。',
    },

    allHolders: {
      expand: '加载全部持有人（{accounts} 个账户 / {owners} 个地址）',
      searchPlaceholder: '搜索地址前缀…',
      includeEmpty: '含已清空账户',
      pageSize: '每页 {n}',
      exportCsv: '← 导出 CSV（当前筛选）',
      colAddress: '地址',
      colCount: '数量',
      colShareOfSupply: '占总供应',
      colCategory: '分类',
      colCounted: '计入集中度',
      colAccounts: '账户数',
      noRows: '没有符合条件的记录',
      footer: '共 {filtered} 行（全量 {total} 个地址）',
      prev: '上一页',
      next: '下一页',
    },

    diamond: {
      title: '钻石手（持仓行为）',
      headline: '{hands} / {analyzed} 个可分析钱包 · 窗口覆盖 {coverage}%',
      warn1: '⚠️ 成交窗口只覆盖了 ',
      warnBold: '{pct}%',
      warn2: ' 的时间跨度',
      warnGap: '（中间缺 {days} 天）',
      warn3:
        '，所以下面的只是窗口内的观测值，几乎肯定低估：缺口期间买入并一直持有的钱包不在样本里。「没看到卖」≠「没卖过」。',
      statHands: '钻石手',
      statHandsSub: '占可分析钱包 {pct}%',
      statMedianHold: '中位持有时长',
      statMedianSub: '首次买入至今',
      statNoMedianSub: '没有符合条件的钱包',
      statStrongest: '证据最强（最早窗口内）',
      statStrongestSub: '覆盖时间最长的那批',
      statAddOn: '有加仓行为',
      statAddOnSub: '买入 ≥ {n} 次',
      days: '{n} 天',
      colWallet: '钱包',
      colHoldDays: '持有时长',
      colBuys: '买入次数',
      colBuyAmount: '买入金额',
      colStrength: '证据强度',
      colShareNow: '当前占比',
      addedBadge: '加仓',
      strongestTag: '最早窗口内',
      recentTitle: '首次买入落在最近窗口里：没卖只是因为刚买',
      recentTag: '窗口内新进',
      empty1: '在 {n} 个可分析钱包里，没有找到符合「只买未卖 + 仍持仓 + 持有 ≥ {days} 天」的地址。',
      emptyLowCoverage: '（窗口覆盖不足，这个结论很可能是漏，而不是真的没有。）',
      note1: '样本 {trades} 笔成交（最近 100 笔 + 最早 {early} 笔）；已排除 creator / 关联钱包 {excluded} 个、高频机器人 {robots} 个；卖光的不算。',
      noteBold: '权重为 0，不参与总分',
      note2: ' —— 它描述筹码在谁手里，不回答该不该买；拿得住不等于利好。',
    },

    sellPressure: {
      title: '抛压分布（还没卖的筹码在什么价位）',
      priceOk: '现价 {price} SOL/枚（窗口内最近成交反推）',
      priceUnavailable: '现价不可用',
      deepButton: '深度分析（约 2 分钟）',
      deepButtonAgain: '重新深度分析',
      deepRunning: '深度分析中…',
      deepButtonTitle: '逐地址拉取前 50 名持有人的完整历史，算出真实成本（实测约 2 分钟）',
      deepDone1: '✓ 已用',
      deepDoneBold: '完整历史',
      deepDone2:
        '计算 {wallets} 个钱包的成本（覆盖前 {addresses} 名持有人）—— 这些行不受成交窗口缺口影响，是真实成本与真实已卖比例。其余行仍是窗口估算。表里用「完整历史 / 窗口估算」标出区别。',
      noDeep1: '当前成本是',
      noDeepBold: '成交窗口估算',
      noDeep2:
        '：窗口只覆盖一部分时间跨度，所以未卖筹码会被低估。点右上角「深度分析」可逐地址拉完整历史（约 2 分钟），把成本换成真实值 —— 实测某币可分析钱包从 14 个升到 43 个、未卖筹码从 1.0% 升到 12.4% 流通盘。深度只覆盖前 50 名持有人，但那已经代表约 91% 的持仓筹码（实测 91.2%；扩到前 200 名也只多 4.2 个百分点）。',
      statUnsold: '未卖筹码（可分析部分）',
      statUnsoldSub: '流通盘占比 · {n} 枚',
      statCost: '按成本折算',
      statCostSub: '这些钱包当初投入的本金',
      statWallets: '可分析钱包',
      statWalletsDeep: '其中 {n} 个用完整历史',
      statWalletsWindow: '成交配对率 {pct}%',
      statExited: '已出走 / 派发中',
      statExitedSub: '已卖光的不算抛压',
      lowAttr1: '⚠️ 窗口内只有 ',
      lowAttrBold: '{pct}%',
      lowAttr2: ' 的成交能配对出成本（其余交易的代币变动记在别的账户上，无法归因到买家）。',
      lowAttrBold2: '下面的分布只覆盖一小部分筹码，不是全貌。',
      colPnlBucket: '相对现价的盈亏区间',
      colCostBucket: '买入成本区间',
      colWallets: '钱包数',
      colUnsold: '未卖筹码',
      colOfFloat: '占流通盘',
      colOfAnalyzable: '占可分析筹码',
      profitTitle: '浮盈且仍有筹码的钱包（未卖量从大到小）—— 这些是最有动机卖出的一批',
      colWallet: '钱包',
      colCost: '成本',
      colPnl: '盈亏',
      colUnsoldShort: '未卖',
      colSold: '已卖',
      colSource: '最后成交 / 成本来源',
      sourceDeep: '完整历史',
      sourceDeepTitle: '逐地址完整历史算出，不受窗口缺口影响',
      sourceWindow: '窗口估算',
      sourceWindowTitle: '成交窗口估算，可能低估未卖量',
      minted1: '另有 ',
      mintedBold1: '创建/铸造获得的',
      minted2: '（约 {tokens} 枚，只付了网络手续费），',
      mintedBold2: '没有买入价',
      minted3:
        '，因此不计入上面的盈亏分桶 —— 把手续费当成本会算出「浮盈几十万%」这种假数字。这类筹码在任何价位卖出都是纯利润。',
      note1: '口径：{note} 盈亏按「最近一笔成交反推」的现价计算，',
      noteBold: '不是实时行情价',
      note2: '；超过 {hours} 小时的陈旧价格会停用这一栏。本维度权重为 0，不参与总分。',
    },
  },

  /** 分析器结论：key = `<id>` 与 `<id>.detail`，与 Finding id 一一对应 */
  findings: findingsZh,
  pieces: piecesZh,
  warnings: warningsZh,
};

/**
 * 字典的类型。
 *
 * ⚠️ 不能用 `typeof zh`（配 `as const`）—— 那会把每个值变成字面量类型
 * （`'开始体检'`），于是 en.ts 里赋 `'Run check'` 会编译失败。
 * 我们要的是「key 结构一致、值为 string」：用 `DeepStringify` 把字面量放宽。
 */
type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>;
};

export type Messages = DeepStringify<typeof zh>;
