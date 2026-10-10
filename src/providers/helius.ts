/**
 * Helius Provider —— 链上事实与开发者履历。
 *
 * 两类接口，用途完全不同：
 *
 * 1. **标准 Solana RPC**（`https://mainnet.helius-rpc.com/?api-key=...`）
 *    走 @solana/web3.js，取 mint 账户、权限、Token-2022 扩展、最大持仓。
 *    这部分与 provider 无关，任何 RPC 都能用。
 *
 * 2. **Helius Enhanced / DAS API**（`https://api.helius.xyz`）
 *    取标准 RPC **拿不到**的东西，也正是「开发者历史」维度的全部输入：
 *    - `/v0/token-metadata`    → 元数据与 **creators**（真正的部署者身份）
 *    - `/v1/wallet/{w}/funded-by` → 资金来源（识别混币/交易所中转）
 *    - `/v0/addresses/{a}/transactions` → 交易历史（dev 卖出、批量发币）
 *
 * ⚠️ 两个必须显式处理的坑：
 * - **creator ≠ fee payer**。Pump.fun 上交易由用户钱包签名，
 *   真正的部署者写在 Metaplex metadata 的 `creators` 里。
 *   用 fee payer 当 creator 会追错人，整个维度都是错的。
 * - **无 key 时 Enhanced API 全部不可用**，此时必须降级为「未采集」，
 *   绝不能把「没查到」渲染成「没有前科」。
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { BURN_ADDRESSES, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@/core/constants';
import type {
  ContractInfo,
  DeveloperInfo,
  FieldOrigin,
  RawHolder,
  SocialInfo,
  TokenInfo,
} from '@/core/types';

// ── 环境配置 ────────────────────────────────────────────────────────
export const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
export const HELIUS_REST_BASE = 'https://api.helius.xyz';

/** RPC 端点。Helius 的 RPC 走带 key 的 URL */
export function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL?.trim() || process.env.HELIUS_RPC_URL?.trim() || DEFAULT_RPC;
}

/** Helius REST API key。缺省时从 RPC URL 里提取（Helius 两者共用同一个 key） */
export function heliusApiKey(): string | null {
  const explicit = process.env.HELIUS_API_KEY?.trim();
  if (explicit) return explicit;
  const url = rpcUrl();
  const m = url.match(/[?&]api-key=([^&]+)/);
  return m ? m[1] : null;
}

/** Enhanced API 是否可用 —— 决定「开发者历史」能否真正计算 */
export function hasEnhancedApi(): boolean {
  return heliusApiKey() !== null;
}

const RPC_TIMEOUT_MS = 12_000;
const REST_TIMEOUT_MS = 15_000;

/**
 * 带超时的 fetch。
 *
 * ⚠️ 不加超时会毁掉体验：RPC 不可达时 @solana/web3.js 会一直挂着，
 * 叠加下面的重试后单次扫描能拖到 55 秒以上。宁可快速失败并如实报告
 * 「数据不足」，也不要让用户对着转圈等一分钟。
 */
function timedFetch(timeoutMs: number): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}

/** 判断字符串是否像 base58 的 Solana 地址 */
export function isLikelyMint(value: string): boolean {
  const v = value.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return false;
  try {
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}

/**
 * 标记「值得重试」的错误。
 *
 * ⚠️ 只有**服务端临时故障**才值得重试。网络不通、DNS 失败、超时都**不该**重试：
 * 实测 RPC 不可达时，每个请求要挂 10.5 秒才报错，重试 3 次就把单次扫描
 * 从 21 秒拖到 65 秒 —— 用户只会看到长时间转圈，而结果并不会变好。
 */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

/**
 * 重试封装：只重试明确标记为 RetryableError 的错误。
 * 其余错误（超时、连接失败、4xx）立即失败，交给上层降级为「数据缺失」。
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!(err instanceof RetryableError)) throw err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw lastErr;
}

async function restFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = heliusApiKey();
  if (!key) throw new Error('未配置 Helius API key');
  const sep = path.includes('?') ? '&' : '?';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
  try {
    const res = await fetch(`${HELIUS_REST_BASE}${path}${sep}api-key=${key}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const message = `Helius API ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`;
      // 429 / 5xx 是服务端临时故障，值得重试；401/403/404 重试也没用
      if (res.status === 429 || res.status >= 500) throw new RetryableError(message);
      throw new Error(message);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── Token-2022 TLV 扩展解析 ─────────────────────────────────────────

const TLV_EXTENSION_NAMES: Record<number, string> = {
  1: 'transferFeeConfig',
  2: 'transferFeeAmount',
  4: 'mintCloseAuthority',
  6: 'interestBearing',
  9: 'permanentDelegate',
  10: 'nonTransferable',
  12: 'defaultAccountStateFrozen',
  14: 'transferHook',
};

/**
 * 解析 Token-2022 mint 账户的 TLV 扩展。
 * 布局：mint 基础数据之后是扩展区，每项 [u16 type][u16 length][payload]，
 * 以 type=0 结束。
 *
 * ⚠️ 不做这一步会漏掉 transferHook / permanentDelegate 这类「蜜罐级」扩展。
 */
export function parseToken2022Extensions(data: Buffer): {
  names: string[];
  transferFeeBps: number;
} {
  const names: string[] = [];
  let transferFeeBps = 0;
  let offset = 166; // Token-2022 mint 基础长度（含 padding）
  if (data.length < offset) offset = 82;
  if (data.length <= offset) return { names, transferFeeBps };

  let guard = 0;
  while (offset + 4 <= data.length && guard++ < 64) {
    const type = data.readUInt16LE(offset);
    const len = data.readUInt16LE(offset + 2);
    if (type === 0) break;
    const name = TLV_EXTENSION_NAMES[type];
    if (name) names.push(name);
    // transferFeeConfig: [authority(32)][withdrawAuthority(32)][older(bps u64 + max u64)][newer(...)]
    if (type === 1 && len >= 108) {
      try {
        const base = offset + 4 + 64;
        const olderFee = Number(data.readBigUInt64LE(base + 8));
        const newerFee = Number(data.readBigUInt64LE(base + 24));
        transferFeeBps = Math.max(olderFee, newerFee);
      } catch {
        /* 解析失败保持 0，由其它信号兜底 */
      }
    }
    offset += 4 + len;
  }
  return { names, transferFeeBps };
}

// ── 链上基础事实（标准 RPC）──────────────────────────────────────────

export interface OnChainResult {
  token: Partial<TokenInfo>;
  contract: ContractInfo | null;
  holders: RawHolder[];
  /** 部署者地址（来自 metadata creators；拿不到则为 undefined） */
  creator?: string;
  origins: Record<string, FieldOrigin>;
}

export async function fetchOnChain(mint: string, warnings: string[]): Promise<OnChainResult> {
  const origins: Record<string, FieldOrigin> = {};
  // 每个 RPC 请求 12s 超时，避免节点挂起时无限等待
  const connection = new Connection(rpcUrl(), {
    commitment: 'confirmed',
    fetch: timedFetch(RPC_TIMEOUT_MS),
  });
  const mintPk = new PublicKey(mint);

  const contract: ContractInfo = {};
  /** mint 账户是否真的读到了。读不到时绝不能返回空对象冒充「有数据」 */
  let contractRead = false;
  const token: Partial<TokenInfo> = { mint };
  let creator: string | undefined;

  // ── 三个数据源互不依赖，必须并行 ────────────────────────────────
  // 串行时任一数据源不可达都会把延迟叠加起来（实测 3 个全挂 = 65 秒）。
  const metaP = hasEnhancedApi()
    ? withRetry(() =>
        restFetch<TokenMetadataEntry[]>('/v0/token-metadata', {
          method: 'POST',
          body: JSON.stringify({ mintAccounts: [mint], includeOffChain: true }),
        }),
      )
    : null;

  const [accountRes, largestRes, metaRes] = await Promise.allSettled([
    withRetry(() => connection.getAccountInfo(mintPk)),
    withRetry(() => connection.getTokenLargestAccounts(mintPk)),
    metaP ?? Promise.resolve(null),
  ]);

  // ── 1. mint 账户：程序归属 + authority + 供应量 ───────────────────
  if (accountRes.status === 'fulfilled') {
    const info = accountRes.value;
    if (!info) {
      warnings.push(`链上未找到 mint 账户 ${mint} —— 地址可能错误，或不属于该网络。`);
      return { token, contract: null, holders: [], origins: { ...origins, contract: 'unavailable' } };
    }

    // ⚠️ 必须读 getAccountInfo().owner 判断代币程序。
    // getParsedAccountInfo 的 parsed.info.owner 是 **authority**，不是程序 id，
    // 混淆会导致「所有代币都是 Token-2022」的严重误判。
    const programId = info.owner.toBase58();
    contract.tokenProgram = programId;
    contractRead = true;
    origins.contract = 'onchain';

    const is2022 = programId === TOKEN_2022_PROGRAM_ID;
    if (!is2022 && programId !== TOKEN_PROGRAM_ID) {
      warnings.push(
        `mint 账户的 owner 是 ${programId}，既不是 SPL Token 也不是 Token-2022，需人工核对。`,
      );
    }

    const data = Buffer.from(info.data);
    if (data.length >= 82) {
      const ZERO_PK = '11111111111111111111111111111111';
      const mintAuthority = new PublicKey(data.subarray(4, 36)).toBase58();
      const supplyRaw = data.readBigUInt64LE(36);
      const decimals = data[44];
      const freezeAuthority = new PublicKey(data.subarray(46, 78)).toBase58();

      contract.mintAuthority = mintAuthority === ZERO_PK ? null : mintAuthority;
      contract.freezeAuthority = freezeAuthority === ZERO_PK ? null : freezeAuthority;
      token.decimals = decimals;
      token.supply = Number(supplyRaw) / 10 ** decimals;
      contract.supply = token.supply;
      origins.token = 'onchain';
    }

    if (is2022) {
      const { names, transferFeeBps } = parseToken2022Extensions(data);
      contract.extensions = names;
      contract.transferFeeBps = transferFeeBps;
    }
  } else {
    warnings.push(`读取 mint 账户失败：${msg(accountRes.reason)}`);
    origins.contract = 'unavailable';
  }

  // ── 2. 元数据与部署者 ────────────────────────────────────────────
  if (metaRes.status === 'fulfilled' && metaRes.value) {
    const entry = metaRes.value[0];
    const md = entry?.onChainMetadata?.metadata;
    if (md?.data) {
      token.name = md.data.name?.replace(/\0/g, '').trim() || token.name;
      token.symbol = md.data.symbol?.replace(/\0/g, '').trim() || token.symbol;
      contract.isMutableMetadata = md.isMutable ?? contract.isMutableMetadata;

      // ⚠️ 部署者取 creators[0]，不是 fee payer。
      // Pump.fun 的交易由用户钱包签名，fee payer 是买家，不是发币人。
      const c = md.data.creators?.find((x) => x.verified) ?? md.data.creators?.[0];
      if (c?.address) {
        creator = c.address;
        origins.developer = 'onchain';
      }
    }
    if (!token.name && entry?.legacyMetadata?.name) {
      token.name = entry.legacyMetadata.name;
      token.symbol = token.symbol ?? entry.legacyMetadata.symbol;
      token.imageUrl = entry.legacyMetadata.logoURI;
    }
    if (token.name || token.symbol) origins.token = origins.token ?? 'onchain';
  } else if (metaRes.status === 'rejected') {
    warnings.push(`读取代币元数据失败：${msg(metaRes.reason)}（symbol/name 与部署者身份将缺失）`);
  } else {
    warnings.push(
      '未配置 Helius API key，无法读取代币元数据与部署者身份 —— ' +
        '「开发者历史」维度将标记为未采集。设置 HELIUS_API_KEY 或使用带 api-key 的 RPC URL。',
    );
  }

  // ── 3. 最大持仓 ─────────────────────────────────────────────────
  const holders: RawHolder[] = [];
  if (largestRes.status === 'fulfilled') {
    const largest = largestRes.value;
    // 供应量读不到时 pct 无法计算 —— 标记为未知而不是算成 0，
    // 否则「读不到供应量」会被误判成「持仓极度分散」。
    const supply = token.supply ?? 0;
    const decimals = token.decimals ?? 0;

    const ownerResults = await Promise.allSettled(
      largest.value.slice(0, 20).map((acc) => connection.getParsedAccountInfo(acc.address)),
    );

    largest.value.slice(0, 20).forEach((acc, i) => {
      const amount = Number(acc.amount) / 10 ** decimals;
      const pct = supply > 0 ? (amount / supply) * 100 : 0;
      const res = ownerResults[i];
      let owner = acc.address.toBase58();
      if (res?.status === 'fulfilled') {
        const parsed = res.value.value?.data;
        if (parsed && 'parsed' in parsed && parsed.parsed?.info?.owner) {
          owner = parsed.parsed.info.owner as string;
        }
      }
      const isBurn = BURN_ADDRESSES.has(owner);
      // 池识别不在这里做：真实池地址是随机 base58，靠地址文本猜不出来。
      // 由 pools.ts 用确定性 PDA 推导 + DexScreener pair 完成，结果在
      // mergeInputs 里回填。此处只标记 burn。
      holders.push({
        address: owner,
        amount,
        pct,
        isBurn,
        label: isBurn ? 'burn' : undefined,
      });
    });
    origins.holders = 'onchain';
    if (holders.length > 0) {
      warnings.push(
        '链上仅返回前 20 大持仓账户；更深的分布需要索引器。若 AMM 池地址未被识别为池，' +
          '其持仓会计入集中度，导致 Top10 占比偏高。',
      );
    }
    if (supply === 0) {
      warnings.push('未能读到代币总供应量，持仓占比无法计算，集中度维度将标记为未采集。');
      origins.holders = 'unavailable';
      holders.length = 0;
    }
  } else {
    warnings.push(`读取持仓分布失败：${msg(largestRes.reason)}`);
    origins.holders = 'unavailable';
  }

  return { token, contract: contractRead ? contract : null, holders, creator, origins };
}

/** /v0/token-metadata 的返回结构（取用到的字段） */
interface TokenMetadataEntry {
  onChainMetadata?: {
    metadata?: {
      data?: {
        name?: string;
        symbol?: string;
        creators?: { address: string; verified: boolean }[];
      };
      updateAuthority?: string;
      isMutable?: boolean;
    };
  };
  legacyMetadata?: { name?: string; symbol?: string; logoURI?: string };
}

// ── 开发者履历（Helius Enhanced API）────────────────────────────────

export interface DeveloperResult {
  developer: DeveloperInfo | null;
  warnings: string[];
  origin: FieldOrigin;
}

/**
 * 采集部署者履历。
 *
 * 能做的事（全部来自 Enhanced API 的真实解析数据）：
 * - creator 的买入/卖出记录 → dev sold ratio、是否清仓
 * - creator 作为 fee payer 的 TOKEN_MINT → 批量发币识别
 * - creator 的资金来源 → 混币/中转钱包识别
 *
 * 明确**不做**的事：把 creator 的其它代币判定为 rug。
 * 「这个代币是不是 rug」需要价格与流动性历史，单次 RPC 查询无法负责任地断言。
 * 因此 priorRugCount 不猜 —— 宁可留空，也不用启发式编一个数字。
 */
export async function fetchDeveloper(
  mint: string,
  creator: string | undefined,
  warnings: string[],
): Promise<DeveloperResult> {
  if (!hasEnhancedApi()) {
    return {
      developer: null,
      warnings: [
        '未配置 Helius API key，「开发者历史」维度无法计算（历史发币、dev 卖出、资金来源都需要 Enhanced API）。',
      ],
      origin: 'unavailable',
    };
  }

  const dev: DeveloperInfo = creator ? { creator } : {};
  const localWarnings: string[] = [];

  // ── 1. 本代币最早一笔交易 → 发币时间（用于「快速出货」判定）───────
  // sort-order=asc 让 API 直接返回最旧的一笔，无需翻页到历史尽头。
  const oldestPromise = withRetry(() =>
    restFetch<HeliusTx[]>(`/v0/addresses/${mint}/transactions?limit=1&sort-order=asc`, {
      method: 'GET',
    }),
  );

  const fundingPromise = creator
    ? withRetry(() =>
        restFetch<{ funder?: string; funderName?: string | null; funderType?: string | null }>(
          `/v1/wallet/${creator}/funded-by`,
          { method: 'POST' },
        ),
      )
    : null;

  // token-accounts=balanceChanged：否则只返回 creator 直接签名的交易，
  // 会漏掉经由其 token account 发生的买卖。
  const creatorTxsPromise = creator
    ? withRetry(() =>
        restFetch<HeliusTx>(
          `/v0/addresses/${creator}/transactions?limit=100&token-accounts=balanceChanged`,
          { method: 'GET' },
        ),
      )
    : null;

  // 三个请求彼此独立，必须并行 —— 串行时网络慢会把单次扫描拖到一分钟以上
  const [oldestRes, fundingRes, creatorTxsRes] = await Promise.allSettled([
    oldestPromise,
    fundingPromise ?? Promise.resolve(null),
    creatorTxsPromise ?? Promise.resolve(null),
  ]);

  let createdAtSec: number | undefined;
  if (oldestRes.status === 'fulfilled') {
    const tx = oldestRes.value?.[0];
    createdAtSec = tx?.timestamp;
    // 创建交易的 fee payer 是部署者的**候选**值。
    // Pump.fun 的发币交易由 creator 签名，但 metadata 才是权威来源，
    // 因此这里只作为 metadata 缺失时的兜底。
    const candidate = tx?.feePayer;
    if (!dev.creator && candidate) {
      dev.creator = candidate;
      localWarnings.push(
        `元数据无 creators 字段，部署者取自发币交易的 fee payer（${candidate}）。` +
          '此为推断值，准确度低于 metadata，请人工确认。',
      );
    }
  } else {
    localWarnings.push(`查询发币时间失败：${msg(oldestRes.reason)}`);
  }

  if (!dev.creator) {
    return {
      developer: null,
      warnings: [
        ...localWarnings,
        '未能确定部署者地址（metadata 无 creators，且发币交易缺失），「开发者历史」无法计算。',
      ],
      origin: 'unavailable',
    };
  }

  const effectiveCreator = dev.creator;

  // 若 creator 是刚由上一步推断出来的，资金来源与交易历史的并行请求当时被跳过，
  // 这里补一次；否则直接用已经拿到的结果。
  const [funding, creatorTxs] = await Promise.all([
    fundingRes.status === 'fulfilled' && fundingRes.value !== null
      ? Promise.resolve(fundingRes.value)
      : withRetry(() =>
          restFetch<{ funder?: string; funderName?: string | null; funderType?: string | null }>(
            `/v1/wallet/${effectiveCreator}/funded-by`,
            { method: 'POST' },
          ),
        ).catch((err) => {
          localWarnings.push(`查询部署者资金来源失败：${msg(err)}`);
          return null;
        }),
    creatorTxsRes.status === 'fulfilled' && creatorTxsRes.value !== null
      ? Promise.resolve(creatorTxsRes.value)
      : withRetry(() =>
          restFetch<HeliusTx>(
            `/v0/addresses/${effectiveCreator}/transactions?limit=100&token-accounts=balanceChanged`,
            { method: 'GET' },
          ),
        ).catch((err) => {
          localWarnings.push(`查询部署者交易历史失败：${msg(err)}（dev 卖出与历史发币将缺失）`);
          return null;
        }),
  ]);

  // ── 2. 资金来源：识别混币/中转 ──────────────────────────────────
  if (fundingRes.status === 'rejected') {
    localWarnings.push(`查询部署者资金来源失败：${msg(fundingRes.reason)}`);
  }
  if (funding?.funder) {
    // funder 是已知交易所 = 正常提币；未知钱包 = 可能刻意中转
    if (!funding.funderName && funding.funderType == null) {
      dev.linkedWallets = [funding.funder];
    }
  }

  // ── 3. 交易历史：dev 卖出 + 历史发币 ────────────────────────────
  if (creatorTxsRes.status === 'rejected') {
    localWarnings.push(`查询部署者交易历史失败：${msg(creatorTxsRes.reason)}（dev 卖出与历史发币将缺失）`);
  }
  const list = Array.isArray(creatorTxs) ? creatorTxs : [];
  {
    let bought = 0;
    let sold = 0;
    let firstSellTs: number | undefined;
    const mintedMints = new Set<string>();

    for (const tx of list) {
      const ts = tx.timestamp;

      // creator 发起铸造的代币 → 历史发币记录
      if (tx.type === 'TOKEN_MINT') {
        for (const t of tx.tokenTransfers ?? []) if (t.mint) mintedMints.add(t.mint);
      }

      // 本代币上 creator 的净流向
      for (const t of tx.tokenTransfers ?? []) {
        if (t.mint !== mint) continue;
        const amt = t.tokenAmount ?? 0;
        if (t.toUserAccount === effectiveCreator) bought += amt;
        if (t.fromUserAccount === effectiveCreator) {
          sold += amt;
          if (ts && (firstSellTs === undefined || ts < firstSellTs)) firstSellTs = ts;
        }
      }
    }

    if (bought > 0) {
      dev.devSoldRatio = Math.min(1, sold / bought);
      // 注意：这是「相对其买入量」的剩余比例，不是占总量比例
      dev.devHoldingPct = Math.max(0, ((bought - sold) / bought) * 100);
      dev.devFullyExited = sold > 0 && sold >= bought * 0.999;
    } else if (sold > 0) {
      // 只有卖出没有买入（例如空投所得）→ 无法算比例，但可判定已卖出
      dev.devSoldRatio = 1;
      dev.devFullyExited = true;
    }

    if (firstSellTs !== undefined && createdAtSec !== undefined && firstSellTs >= createdAtSec) {
      dev.devFirstSellAgeSec = firstSellTs - createdAtSec;
    }

    const priorMints = [...mintedMints].filter((m) => m !== mint);
    if (priorMints.length > 0) {
      dev.priorTokens = priorMints.slice(0, 50).map((m) => ({ mint: m }));
    }

    // 近 7 天发币数 → 「广撒网」模式识别
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86_400;
    const recent = new Set<string>();
    for (const tx of list) {
      if (!tx.timestamp || tx.timestamp < weekAgo) continue;
      if (tx.type === 'TOKEN_MINT') {
        for (const t of tx.tokenTransfers ?? []) if (t.mint) recent.add(t.mint);
      }
    }
    if (recent.size > 0) dev.tokensLast7d = recent.size;

    if (list.length === 0) {
      localWarnings.push('部署者地址的交易历史为空，dev 卖出与历史发币无法验证。');
    }
  }

  return { developer: dev, warnings: localWarnings, origin: 'onchain' };
}

/** Helius Enhanced Transaction 的字段子集（见 openapi spec） */
interface HeliusTx {
  signature?: string;
  type?: string;
  timestamp?: number;
  feePayer?: string;
  tokenTransfers?: {
    fromUserAccount?: string;
    toUserAccount?: string;
    tokenAmount?: number;
    mint?: string;
  }[];
  nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[];
}

/** 社交数据：Helius 不提供，保留占位以便将来接第三方 */
export function fetchSocial(): SocialInfo | null {
  return null;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
