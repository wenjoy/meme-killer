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
  isTeamWallet?: boolean;
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
  lp?: {
    exists?: boolean;
    locked?: boolean;
    burned?: boolean;
    unlockAt?: string;
    locker?: string;
    holder?: string;
    singleHolder?: boolean;
  };
  supply?: number;
}

export interface LiquidityInfo {
  /** 毕业前 = bonding curve 内真实 SOL；毕业后 = 池内 SOL */
  realSolReserves?: number;
  virtualSolReserves?: number;
  graduationTargetSol?: number;
  graduated?: boolean;
  complete?: boolean;
  /** 是否检测到池内资金被抽走 */
  liquidityPulled?: boolean;
  lpLockedOrBurned?: boolean;
  buyVolumeSol?: number;
  sellVolumeSol?: number;
  buyCount?: number;
  sellCount?: number;
  sniperHoldPct?: number;
  holderCount?: number;
  holderGrowth24h?: number;
  /** 池地址，用于持仓剔除 */
  poolAddresses?: string[];
  priceChange24h?: number;
  volume24hUsd?: number;
  liquidityUsd?: number;
}

export interface DeveloperInfo {
  creator?: string;
  priorTokens?: { mint: string; symbol?: string; rugged?: boolean; createdAt?: string }[];
  priorRugCount?: number;
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
  pulledLiquidity?: boolean;
  fundedByMixer?: boolean;
  hopCount?: number;
  linkedWallets?: string[];
  twitterAgeDays?: number;
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
export type FieldOrigin = 'onchain' | 'dexscreener' | 'heuristic' | 'unavailable';

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
  metrics?: Record<string, number | string | Record<string, number> | CustodyMetric[]>;
  error?: string;
}

/** 供 UI 直接渲染的托管持仓列表项 */
export interface CustodyMetric {
  address: string;
  kind: CustodyKind;
  label: string;
  pct: number;
  amount: number;
  unlockAt?: string;
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
