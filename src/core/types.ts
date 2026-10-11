/**
 * 归一化数据结构 —— 全系统的核心契约。
 *
 * 分析器只依赖这里的类型，完全不知道数据来自 DexScreener、Solana RPC 还是样本。
 * 接入新数据源 = 新增一个 provider，分析逻辑零改动。
 *
 * 设计要点：字段**允许缺失**（真实数据源经常只能拿到一部分），
 * 因此几乎每个字段都是可选的。分析器必须对 undefined 做正确降级，
 * 而不是拿 undefined 算出一个看起来很确定的错误分数。
 */

/** 控制该仓位的第三方程序类型 */
export type CustodyKind = 'timelock' | 'multisig' | 'unknown-program';

/** 一个持仓被哪个程序托管 —— 用于区分「个人巨鲸」与「锁仓/多签」 */
export interface HolderCustody {
  programId: string;
  kind: CustodyKind;
  label: string;
  /**
   * 解锁时间。
   *
   * ⚠️ 当前**读不到**：托管仓位的 owner 是 PDA，而 PDA 本身没有账户，
   * 拿不到托管账户就无法解析解锁计划；要读必须按程序逐个推导种子 + 解析布局。
   * 因此这里保留字段但标 `unlockAtUnknown`，UI 必须如实显示「待接入」，
   * 不能显示成「已解锁」或留空让人误以为没有锁。
   */
  unlockAt?: string;
  /** 全部解锁完成的时间（线性归属的最后一期） */
  unlockEndAt?: string;
  /** 已领取数量（最小单位），用于判断「锁仓是否已经在释放」 */
  claimedAmount?: number;
  /** 锁仓总量（最小单位） */
  totalAmount?: number;
  unlockAtUnknown?: boolean;
}

/** 一个持有者条目 */
export interface RawHolder {
  address: string;
  /** 原始持有数量（UI 单位，非 lamports） */
  amount: number;
  /** 占总量百分比；缺失时分析器用 amount/supply 反算 */
  pct?: number;
  /** 是否为流动性池 / 金库（剔除项，最大误报源） */
  isPool?: boolean;
  isBurn?: boolean;
  /**
   * 是否为狙击仓位。
   *
   * 由「代币最早若干笔成交的买家」∩「当前前 20 大持仓」推算，
   * 只在真的取到最早成交时才写入；取不到就是 undefined（未知），不是「没有狙击」。
   */
  isSniper?: boolean;
  /** 辅助匹配用的标签，例如 "Raydium AMM Pool" */
  label?: string;
  /** 该持仓的 token account（用于反查控制程序） */
  tokenAccount?: string;
  /** 若该仓位由程序控制（锁仓/多签/托管），记录控制方 */
  custody?: HolderCustody;
}

export interface TokenInfo {
  mint: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  supply?: number;
  /** 发币时间（ISO 字符串或 epoch ms） */
  createdAt?: string | number;
  priceUsd?: number;
  marketCapUsd?: number;
  fdvUsd?: number;
  /** 项目方社交媒体链接 */
  socials?: { twitter?: string; telegram?: string; website?: string };
  imageUrl?: string;
}

export interface ContractInfo {
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  /** 代币程序 id；判断是否 Token-2022 的关键 */
  tokenProgram?: string;
  /** Token-2022 扩展名列表 */
  extensions?: string[];
  transferFeeBps?: number;
  isMutableMetadata?: boolean;
  /**
   * LP（流动性凭证）状态。
   *
   * 三个字段都是**三态**，且只有明确读到才算：
   * - `true`  已确认锁定 / 已销毁
   * - `false` 已确认**未**锁定 / **未**销毁（存在撤池风险）
   * - `undefined` 未知 —— 不得据此判死，只能提示
   *
   * 数据来源：RugCheck 的 `markets[].lp`（链上 LP mint 余额推导）。
   * 拿不到时保持 undefined，UI 必须显示「未知」而不是「安全」。
   */
  lp?: {
    exists?: boolean;
    locked?: boolean;
    burned?: boolean;
    /** 锁仓到期时间（只有锁仓程序自己能给出时才有值） */
    unlockAt?: string;
    /** 锁仓方名称，例如 "Printr Stake Pool" */
    locker?: string;
    /** 锁定或销毁的 LP 占比（%），用于说明结论的依据 */
    lockedPct?: number;
    /**
     * RugCheck 口径下**未**锁定也**未**销毁的 LP 占比（%）。拿不到时为 undefined。
     *
     * ⚠️ 它**不等于**「可随时撤走」：实测两个真实代币的这部分 LP 全部躺在
     * Streamflow 线性解锁合约里（持有人是 LOCKER）。所以还要看下面两个字段。
     */
    unlockedPct?: number;
    /**
     * 未锁部分里由**锁仓/线性解锁程序**托管的占比（%）。
     *
     * 这部分凭证不能被立刻全额提走（会按计划逐步解锁），所以不能算作撤池风险；
     * 但解锁后就能提走，也不能算作「已锁定」。
     */
    lockerPct?: number;
    /**
     * 未锁部分里属于**普通钱包、可随时提走**的占比（%）—— 真正的撤池风险敞口。
     *
     * 判定「项目方可撤池」只认这个数，不认 `unlockedPct`。
     */
    withdrawablePct?: number;
    /**
     * 该池的 LP mint 地址 —— 上面所有比例都能拿它在链上复核。
     */
    lpMint?: string;
    /**
     * **已销毁**的 LP 占比（%），由链上核对得出（不是 RugCheck 的口径推断）：
     * `历史铸造量 − 当前链上供应量 = 已销毁`。LP 凭证一旦销毁就无法恢复，
     * 这是比「锁定」更硬的结论。
     */
    burnedPct?: number;
    /**
     * 销毁核对的原始数字（`everMinted = live + burned`），用于让人自己复算。
     */
    lpAudit?: { everMinted: number; live: number; burned: number };
    /**
     * 仍流通的 LP 分散在几个**普通钱包**里（不含锁仓合约与销毁地址）。
     * RugCheck 的持有者列表最多 20 条，所以 ≥20 时它是下限。
     */
    circulatingHolderCount?: number;
    /**
     * 流通 LP 中占比最大的那个普通钱包持有的份额（%）。
     *
     * ⚠️ 分母是**流通量**而不是历史铸造量：实测 `9raUVuze…pump` 的最大持有者
     * 只占全量 12.4%，却占流通量的 33.3% —— 判断「一个人能撤走多少池子」
     * 必须用流通口径。
     */
    topCirculatingHolderPct?: number;
    /**
     * 项目方（**解析后的 creator**）持有流通 LP 的份额（%）。
     * 只有这个数是撤池跑路的直接风险；第三方各自添加的流动性不是。
     *
     * ⚠️ 分母是流通量。这个数在 merge 阶段按三级来源解析出的 creator 重算，
     * 不再用 RugCheck 的 `knownAccounts` 标签 —— 实测那个标签会指向
     * 创建指令的另一个账户（`TSLvdd1p…`），而不是真正的 dev。
     */
    creatorLpPct?: number;
    /**
     * 链上 LP mint 的持有者全量（RugCheck 最多给 20 条）。
     *
     * 给它是为了能用**解析后的 creator 地址**去核对该地址持有多少 LP ——
     * 只暴露前 3 名的 `lpHolders` 会漏掉「creator 是第 4 大 LP 持有者」这种情况。
     */
    lpAllHolders?: { owner: string; pct: number }[];
    /**
     * LP 凭证的持有者明细（RugCheck 按链上 LP mint 余额给出，最多取前 3）。
     *
     * 用于核对「未锁的那部分到底在谁手里」—— 没有这份明细就只能说
     * 「存在未锁部分」，不能说「项目方可以撤池」。
     */
    lpHolders?: {
      owner: string;
      pct: number;
      label?: string;
      /** 是否为锁仓/线性解锁程序账户 */
      isLocker?: boolean;
      /** 锁仓的解锁时间（程序给出时才有） */
      unlockAt?: string;
    }[];
    /** 未锁定时，持有 ≥95% LP 的单一地址 */
    holder?: string;
    /** 未锁定/未销毁，且 LP 集中在单一地址（可随时撤池） */
    singleHolder?: boolean;
  };
  supply?: number;
}

export interface LiquidityInfo {
  /** 毕业前 = bonding curve 内真实 SOL；毕业后 = 池内 SOL */
  realSolReserves?: number;
  graduated?: boolean;
  complete?: boolean;
  /**
   * RugCheck 已将该代币判定为 rug。
   *
   * 只写 `true`：`false` 不代表安全（RugCheck 的判定只覆盖它见过的数据），
   * 因此不用它生成任何「积极信号」。
   */
  rugged?: boolean;
  /**
   * 买入/卖出金额（SOL）。
   *
   * **只由 Helius 逐笔成交写入**（单位真的是 SOL）。DexScreener 的成交额是
   * USD 口径，写在 `buyVolumeUsd`/`sellVolumeUsd` 里 —— 两者绝不混用：
   * 曾经把 USD 当 SOL 喂给「净流入 / 刷量」判定，净流入直接虚高 150 倍。
   */
  buyVolumeSol?: number;
  sellVolumeSol?: number;
  /** 买入/卖出金额（USD），DexScreener 的推算拆分 */
  buyVolumeUsd?: number;
  sellVolumeUsd?: number;
  buyCount?: number;
  sellCount?: number;
  /**
   * 狙击仓位占比（%）。
   *
   * 只由「最早成交的买家 ∩ 前 20 大持仓」推算，取不到最早成交时是 undefined
   * （未知），不是 0。仅覆盖前 20 大持仓窗口，属于下限估计。
   */
  sniperHoldPct?: number;
  /**
   * 逐笔成交的「大单 / 小单」证据。
   *
   * 为什么需要它：`买单笔数是卖单 4.6 倍，但买入金额只有卖出的 81%` 这种结论
   * 读者无法核对 —— 必须给出单笔量级（中位/最大）与卖单集中度，才能看出
   * 「小额买盘撑笔数、大额卖盘出货」到底是不是真的。全部来自最近 100 笔中
   * 能判定方向的成交，拿不到时为 undefined（不得当成 0）。
   */
  tradeSizeAudit?: {
    /** 样本笔数（本次能判定买卖方向的成交） */
    trades: number;
    /** 样本覆盖的时间跨度（秒）—— 100 笔可能只跨几分钟，也可能跨几天 */
    windowSec?: number;
    /** 单笔买入的 SOL 中位数 */
    buyMedianSol: number;
    /** 单笔卖出的 SOL 中位数 */
    sellMedianSol: number;
    buyMaxSol: number;
    sellMaxSol: number;
    /** 最大单笔卖单占卖出总额的比例（%） */
    largestSellSharePct?: number;
    /** 前 5 大卖单占卖出总额的比例（%） */
    top5SellSharePct?: number;
  };
  /**
   * 最大的若干笔卖单（默认前 5），带交易签名 —— 供读者点开链上核对。
   * 拿不到签名时为空（不是造一个假条目）。
   */
  largeSells?: LargeSellEvidence[];
  /**
   * 「早期买家窗口」（代币最早若干笔成交）这次是否真的取到了。
   *
   * ⚠️ 必须区分三态：取不到时**不能**把大额卖单钱包标成「不在最早 25 笔内」——
   * 那会被读成「不是狙击手」，而真相是「这次没查到」。抓不到最早成交时是 false。
   */
  earlyBuyerWindowKnown?: boolean;
  /** 持有人总数（RugCheck `totalHolders`） */
  holderCount?: number;
  /** 池地址，用于持仓剔除 */
  poolAddresses?: string[];
  priceChange24h?: number;
  volume24hUsd?: number;
  liquidityUsd?: number;
}

export interface DeveloperInfo {
  creator?: string;
  /**
   * `creator` 这个地址是从哪一级来源取的（后面是前面取不到时的回退）：
   *
   * 1. `curve`     pump.fun bonding curve **程序状态**里的 creator 字段（第 49..81 字节）
   *                —— 最权威：程序自己写的，也是 creator fee 的收款方
   * 2. `metadata`  链上 Metaplex metadata 的 `creators[0]`（非 pump.fun 平台常见）
   * 3. `create-tx` 创建交易的付款方 —— **推断值**，打包器/launchpad 发币时会指错人
   *
   * 实测：pump.fun 代币的 metadata creators 是空的，所以正常走 `curve`。
   */
  creatorSource?: 'curve' | 'metadata' | 'create-tx';
  /**
   * 创建交易的付款方（launch wallet）。
   *
   * 与 `creator` 不一致时**必须在报告里说明**：用打包器发币、再把 creator
   * 转给真 dev 是常见做法，此时这两个地址代表完全不同的主体，
   * 把 launch wallet 当 dev 会让整个开发者维度追错人。
   */
  launchWallet?: string;
  /**
   * 该 creator 历史发行过的其它代币。
   *
   * ⚠️ **只有铸币记录，没有结局**：判断其中哪些是 rug 需要那些代币的价格与
   * 流动性历史，本工具只用单次查询，不猜。因此这里绝不写入 `rugged` 字段，
   * 分析器也不得据此输出「历史记录干净」。
   */
  priorTokens?: { mint: string; symbol?: string; createdAt?: string }[];
  tokensLast7d?: number;
  devSoldRatio?: number;
  devHoldingPct?: number;
  /**
   * 部署者是否已清仓。
   *
   * **三态**，且只有 `true` 才触发硬否决：
   * - `true`      已确认清仓（链上余额为 0）
   * - `false`     已确认未清仓（链上仍有余额）
   * - `undefined` 无法确认 —— 不得据此判死，只能提示
   *
   * 绝不能用流水比例代替它：交易历史窗口有限，
   * 实测出现过「流水算出清仓、链上仍持有 27.6% 供应量」的严重误判。
   */
  devFullyExited?: boolean;
  /** creator 当前在该代币上的链上余额（UI 单位），权威判据 */
  devCurrentBalance?: number;
  devFirstSellAgeSec?: number;
  /** creator 的首笔资金来源钱包（首笔交易的付款方），不是「混币证据」 */
  linkedWallets?: string[];
}

export interface SocialInfo {
  mentions24h?: number;
  mentionGrowthPct?: number;
  engagementRatio?: number;
  suspectedBotRatio?: number;
  retweetToReplyRatio?: number;
  telegramGrowthSpiky?: boolean;
  uniqueAuthors?: number;
}

/** provider 必须返回的完整数据结构 */
export interface ScanInput {
  token: TokenInfo;
  contract?: ContractInfo | null;
  liquidity?: LiquidityInfo | null;
  holders?: RawHolder[];
  developer?: DeveloperInfo | null;
  social?: SocialInfo | null;
  /** 数据来源与完整性元信息，UI 必须展示，避免把估算当事实 */
  meta?: ScanMeta;
}

/** 数据来源追踪：每个字段组的可信度 */
export type FieldOrigin = 'onchain' | 'dexscreener' | 'rugcheck' | 'heuristic' | 'unavailable';

export interface ScanMeta {
  /** 数据源标识，例如 "solana-rpc + dexscreener" */
  source: string;
  /** 是否来自真实数据源。当前恒为 true —— 本项目不提供模拟数据 */
  live: boolean;
  fetchedAt: string;
  /** 各字段组来源，UI 据此标注"推算/缺失" */
  origins: Record<string, FieldOrigin>;
  /** 采集过程中的告警（限流、字段缺失等），必须显式暴露 */
  warnings: string[];
  /** 实际耗时 */
  elapsedMs?: number;
}

/** 单条发现项 */
export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
  /** 命中硬否决 —— 一票判死 */
  veto?: true;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'good';

/** 单维度分析结果 */
export interface DimensionResult {
  dimension: string;
  label: string;
  /** 风险分 0–100，越高越危险 */
  score: number;
  vetoed: boolean;
  findings: Finding[];
  metrics?: Record<
    string,
    | number
    | string
    | Record<string, number>
    | CustodyMetric[]
    | LargeSellEvidence[]
    | HolderRow[]
  >;
  error?: string;
}

/**
 * 供 UI 直接渲染的大额卖单明细。
 *
 * 为什么要把签名透出来：`最大单笔卖单 2.028 SOL` 只是个数字，读者没法验证；
 * 给出「签名 + 时间 + 卖出钱包」才能点到 Solscan 上看到底是谁、什么时候砸的。
 */
export interface LargeSellEvidence {
  signature: string;
  /** 成交额（SOL） */
  sol: number;
  /** 成交时间（Unix 秒） */
  ts?: number;
  /** 卖出的钱包（fee payer） */
  trader?: string;
  /**
   * 该钱包在**最早 25 笔成交**（狙击窗口）里的位置（0-based，由 provider 标注）。
   *
   * ⚠️ undefined 只代表「不在最早 25 笔成交的付款方里」，不等于「不是早期买家」——
   * 它可能是第 26 笔买入的。报告里必须按这个口径措辞。
   */
  earlyBuyerIndex?: number;
  /** 该钱包就是部署者（由 provider 标注） */
  isCreator?: boolean;
  /** 分析器补齐：该钱包当前是否仍在前 20 大持仓，占比（%） */
  holderPctNow?: number;
  /** 分析器补齐：该持仓是否已被持仓维度标为狙击仓位 */
  sniperNow?: boolean;
}

/** 供 UI 直接渲染的托管持仓列表项 */
/**
 * 供 UI 直接渲染的持仓明细（前 20 大，链上 RPC 能给的全部）。
 *
 * 为什么要把原始地址与数量都透出来：`Top10 = 62.9%` 只是个数字，
 * 读者没法核对「被剔除的到底是哪些地址、剔除后剩的是哪些」。
 * 把分类结果逐行列出，集中度这个数字才能被自己加一遍验证。
 */
export interface HolderRow {
  address: string;
  /** 持仓数量（UI 单位） */
  amount: number;
  /** 占总供应量百分比（分母是总量，不是流通量 —— 便于和剔除比例对照） */
  pct: number;
  kind: 'pool' | 'burn' | 'timelock' | 'custody' | 'dev' | 'related' | 'sniper' | 'retail';
  /** 是否计入集中度（池 / 销毁 / 锁仓被剔除） */
  counted: boolean;
  /** 标签，例如「Raydium AMM Pool」「Jupiter Lock」 */
  label?: string;
  /** 该仓位是否由程序控制（锁仓/多签/托管），UI 用来标注 */
  custody?: { kind: CustodyKind; label: string };
}

export interface CustodyMetric {
  address: string;
  kind: CustodyKind;
  label: string;
  pct: number;
  amount: number;
  unlockAt?: string;
  unlockEndAt?: string;
  claimedAmount?: number;
  totalAmount?: number;
  unlockAtUnknown?: boolean;
}

export interface RiskBand {
  max: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  label: string;
  verdict: string;
  tone: 'success' | 'warning' | 'error';
}

export interface ScanReport {
  /** 综合风险分 0–100 */
  score: number;
  band: RiskBand;
  /** 是否命中硬否决 */
  vetoed: boolean;
  /** 数据覆盖率 0–100：实际采集到的维度权重占比。低覆盖率时不能给出买入建议 */
  coverage: number;
  vetoes: (Finding & { dimension: string })[];
  dimensions: Record<string, DimensionResult>;
  advice: { size: string; text: string };
  /** Markdown 格式的中文报告 */
  summary: string;
  token: TokenInfo;
  meta: ScanMeta;
}
