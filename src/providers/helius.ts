/**
 * Helius Provider —— 链上事实与开发者履历。
 *
 * 两类接口，用途完全不同：
 *
 * 1. **Solana RPC**（`https://mainnet.helius-rpc.com/?api-key=...`）
 *    - 标准 RPC：mint 账户原始字节（权限、Token-2022 TLV 扩展）、最大持仓
 *    - **DAS `getAsset`**：元数据、供应量、代币程序、价格、mint 扩展
 * 2. **Helius Enhanced API**（`https://api.helius.xyz`）
 *    - `/v0/addresses/{a}/transactions`：交易历史（部署者身份、dev 卖出、买卖量）
 *
 * ⚠️ 几个必须显式处理的真实世界陷阱（都是对着真实接口实测出来的）：
 *
 * - **`/v0/token-metadata` 已下线**，返回 `Method no longer supported`。
 *   元数据必须改走 DAS `getAsset`。
 * - **真实 pump.fun 代币的 DAS `creators` 是空的**。
 *   部署者身份只能取自**创建交易的 fee payer**，不能指望 metadata。
 * - **`/v1/wallet/{w}/funded-by` 已下线**，返回 `Invalid method`。
 *   资金来源改为从创建者的最早交易里推断。
 * - **`tokenTransfers`/`nativeTransfers` 默认为空**（`token-accounts=none`），
 *   真实数据在 `accountData[].tokenBalanceChanges` 与 `events.swap` 里。
 * - **pump.fun AMM 的交易 `type` 是 `UNKNOWN` 且 `events` 为空**，
 *   只能靠 `accountData` 的余额变化判断买卖方向。
 */
import { Connection, PublicKey } from '@solana/web3.js';
import {
  AMM_PROGRAMS,
  BURN_ADDRESSES,
  CUSTODY_PROGRAMS,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@/core/constants';
import type {
  ContractInfo,
  DeveloperInfo,
  FieldOrigin,
  HolderCustody,
  LiquidityInfo,
  RawHolder,
  SocialInfo,
  TokenInfo,
} from '@/core/types';

// ── 环境配置 ────────────────────────────────────────────────────────
export const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
export const HELIUS_REST_BASE = 'https://api.helius.xyz';

export function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL?.trim() || process.env.HELIUS_RPC_URL?.trim() || DEFAULT_RPC;
}

/** Helius API key。缺省时从 RPC URL 里提取（Helius 两者共用同一个 key） */
export function heliusApiKey(): string | null {
  const explicit = process.env.HELIUS_API_KEY?.trim();
  if (explicit) return explicit;
  const m = rpcUrl().match(/[?&]api-key=([^&]+)/);
  return m ? m[1] : null;
}

export function hasEnhancedApi(): boolean {
  return heliusApiKey() !== null;
}

const RPC_TIMEOUT_MS = 15_000;
const REST_TIMEOUT_MS = 15_000;

/**
 * 带超时的 fetch。
 *
 * ⚠️ 不加超时会毁掉体验：RPC 不可达时请求会一直挂着，
 * 叠加重试后单次扫描能拖到 65 秒。宁可快速失败并如实报告「数据不足」。
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

/**
 * 标记「值得重试」的错误。
 *
 * ⚠️ 只有服务端临时故障（429/5xx）才值得重试。网络不通、超时都不该重试：
 * 实测 RPC 不可达时每个请求要挂 10.5 秒，重试 3 次把扫描从 10.5 秒拖到 65 秒。
 */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

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

/** Helius Enhanced API 调用 */
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
      if (res.status === 429 || res.status >= 500) throw new RetryableError(message);
      throw new Error(message);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** JSON-RPC 调用（标准 RPC 与 DAS 共用同一端点） */
async function rpcCall<T>(method: string, params: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(rpcUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const message = `RPC ${method} ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`;
      if (res.status === 429 || res.status >= 500) throw new RetryableError(message);
      throw new Error(message);
    }
    const json = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (json.error) throw new Error(`RPC ${method} 失败：${json.error.message}`);
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析 SPL Token Mint 账户（82 字节）。
 *
 * 布局：
 *   [0:4]    mint_authority   COption<Pubkey> 的 tag（0=None, 1=Some）
 *   [4:36]   mint_authority   Pubkey（**仅当 tag=1 时有意义**）
 *   [36:44]  supply           u64
 *   [44]     decimals         u8
 *   [45]     is_initialized   bool
 *   [46:50]  freeze_authority COption<Pubkey> 的 tag
 *   [50:82]  freeze_authority Pubkey（**仅当 tag=1 时有意义**）
 *
 * ⚠️ 这里曾经有两个 bug，都会给出与事实相反的结论，必须记住：
 *
 * 1. **不能用「pubkey 是否等于全零地址」判断权限是否放弃。**
 *    COption::None 只保证 tag=0，那 32 字节 payload **不保证是零** ——
 *    实测真实代币 6GmtGgjP…pump 的 tag=0，但 payload 是残留数据
 *    （base58 解出 TSLvdd1p…），于是「权限已放弃」被误报成
 *    「铸币权限未放弃」并触发硬否决：一个凭空捏造的危险信号。
 *    正确做法是先读 tag，tag≠1 就是已放弃。
 *
 * 2. **freeze authority 的 pubkey 在 [50:82]，不是 [46:78]。**
 *    读成 [46:78] 会把 4 字节 tag 当成地址开头，导致地址整体错位
 *    （多个不同代币都会解出以 4uQe 开头的假地址，因为 tag 都是 01 00 00 00）。
 *
 * `mintAuthority`/`freezeAuthority` 为 `null` 表示**已放弃**（COption::None）。
 */
export function parseMintAccount(data: Buffer): {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  supply: number;
  decimals: number;
} | null {
  if (data.length < 82) return null;
  const mintAuthority =
    data.readUInt32LE(0) === 1 ? new PublicKey(data.subarray(4, 36)).toBase58() : null;
  const supplyRaw = data.readBigUInt64LE(36);
  const decimals = data[44];
  const freezeAuthority =
    data.readUInt32LE(46) === 1 ? new PublicKey(data.subarray(50, 82)).toBase58() : null;
  return {
    mintAuthority,
    freezeAuthority,
    supply: Number(supplyRaw) / 10 ** decimals,
    decimals,
  };
}

/** 判断字符串是否像 base58 的 Solana 地址（长度不固定：32–44 字符） */
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

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
 * 布局：mint 基础数据之后是扩展区，每项 [u16 type][u16 length][payload]，type=0 结束。
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
    if (type === 1 && len >= 108) {
      // TransferFeeConfig 布局（实测真实账户 108 字节，紧凑编码）：
      //   [0:32]    transferFeeConfigAuthority
      //   [32:64]   withdrawWithheldAuthority
      //   [64:72]   withheldAmount (u64)
      //   [72:90]   older TransferFee = { epoch u64, maximumFee u64, bps u16 }  18 字节
      //   [90:108]  newer TransferFee = 同上
      //
      // ⚠️ 这里曾经读错字段：把 older.epoch（u64，实测值 1053）当成费率，
      // 于是真实 100 bps（=1%）的币被报成 69,009,508 bps（=690,095%）的
      // 「critical 存在转移税」。epoch 是 u64、数值必然很大，一读错就爆炸。
      // 费率是 u16，位置固定在 older 的 [88:90] 与 newer 的 [106:108]。
      const payload = offset + 4;
      try {
        const olderBps = data.readUInt16LE(payload + 88);
        const newerBps = data.readUInt16LE(payload + 106);
        transferFeeBps = Math.max(olderBps, newerBps);
      } catch {
        /* len 声明与实际长度不符时保持 0，由其它信号兜底 */
      }
    }
    offset += 4 + len;
  }
  return { names, transferFeeBps };
}

// ── DAS getAsset ────────────────────────────────────────────────────

interface DasAsset {
  interface?: string;
  content?: {
    metadata?: { name?: string; symbol?: string; description?: string };
    links?: { image?: string };
  };
  creators?: { address?: string; verified?: boolean; share?: number }[];
  mutable?: boolean;
  token_info?: {
    supply?: number;
    decimals?: number;
    token_program?: string;
    mint_authority?: string;
    freeze_authority?: string;
    price_info?: { price_per_token?: number; currency?: string };
  };
  mint_extensions?: Record<string, unknown>;
}

/**
 * 用 DAS `getAsset` 取代已下线的 `/v0/token-metadata`。
 * 一次调用拿到：名称/符号/图片、供应量、精度、代币程序、mint 扩展，
 * 以及（有价格时）单价 —— 信息比旧的 REST 接口更多。
 */
export async function dasGetAsset(mint: string): Promise<DasAsset | null> {
  try {
    return await withRetry(() => rpcCall<DasAsset>('getAsset', { id: mint }));
  } catch (err) {
    // DAS 对某些地址找不到资产会直接报错，这不算致命 —— 上层有 RPC 兜底
    if (/not found|Asset Not Found|does not exist/i.test(msg(err))) return null;
    throw err;
  }
}

// ── Enhanced API：交易历史 ──────────────────────────────────────────

interface TokenBalanceChange {
  userAccount?: string;
  tokenAccount?: string;
  mint?: string;
  rawTokenAmount?: { tokenAmount?: string; decimals?: number };
}

export interface HeliusTx {
  signature?: string;
  type?: string;
  source?: string;
  timestamp?: number;
  feePayer?: string;
  fee?: number;
  transactionError?: unknown;
  tokenTransfers?: {
    fromUserAccount?: string;
    toUserAccount?: string;
    tokenAmount?: number;
    mint?: string;
  }[];
  nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[];
  accountData?: {
    account?: string;
    nativeBalanceChange?: number;
    tokenBalanceChanges?: TokenBalanceChange[];
  }[];
  /** 交易里调用的指令（含 programId）—— 用于反查托管程序 */
  instructions?: { programId?: string; program?: string }[];
  events?: {
    swap?: {
      tokenInputs?: {
        userAccount?: string;
        mint?: string;
        rawTokenAmount?: { tokenAmount?: string; decimals?: number };
      }[];
      tokenOutputs?: {
        userAccount?: string;
        mint?: string;
        rawTokenAmount?: { tokenAmount?: string; decimals?: number };
      }[];
    };
  };
}

/** 拉取某个地址的交易历史。Enhanced API 单页上限 100 条。 */
export async function enhancedTxs(
  address: string,
  opts: { limit?: number; sortOrder?: 'asc' | 'desc'; tokenAccounts?: string } = {},
): Promise<HeliusTx[]> {
  const limit = Math.min(opts.limit ?? 100, 100);
  const sort = opts.sortOrder ?? 'desc';
  const ta = opts.tokenAccounts ?? 'balanceChanged';
  const q = `limit=${limit}&sort-order=${sort}&token-accounts=${ta}`;
  const res = await withRetry(() =>
    restFetch<HeliusTx[]>(`/v0/addresses/${address}/transactions?${q}`, { method: 'GET' }),
  );
  return Array.isArray(res) ? res : [];
}

// ── 链上基础事实（标准 RPC + DAS）───────────────────────────────────

export interface OnChainResult {
  token: Partial<TokenInfo>;
  contract: ContractInfo | null;
  holders: RawHolder[];
  origins: Record<string, FieldOrigin>;
}

export async function fetchOnChain(mint: string, warnings: string[]): Promise<OnChainResult> {
  const origins: Record<string, FieldOrigin> = {};
  const connection = new Connection(rpcUrl(), {
    commitment: 'confirmed',
    fetch: timedFetch(RPC_TIMEOUT_MS),
  });
  const mintPk = new PublicKey(mint);

  const contract: ContractInfo = {};
  let contractRead = false;
  const token: Partial<TokenInfo> = { mint };

  // ── 三个数据源互不依赖，必须并行 ────────────────────────────────
  // 串行时任一数据源不可达都会把延迟叠加起来（实测 3 个全挂 = 65 秒）。
  const [accountRes, largestRes, assetRes] = await Promise.allSettled([
    withRetry(() => connection.getAccountInfo(mintPk)),
    withRetry(() => connection.getTokenLargestAccounts(mintPk)),
    dasGetAsset(mint),
  ]);

  // ── 1. mint 账户原始字节：权限 + Token-2022 TLV ──────────────────
  if (accountRes.status === 'fulfilled') {
    const info = accountRes.value;
    if (!info) {
      warnings.push(`链上未找到 mint 账户 ${mint} —— 地址可能错误，或不属于该网络。`);
      return {
        token,
        contract: null,
        holders: [],
        origins: { ...origins, contract: 'unavailable' },
      };
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
    const parsedMint = parseMintAccount(data);
    if (parsedMint) {
      contract.mintAuthority = parsedMint.mintAuthority;
      contract.freezeAuthority = parsedMint.freezeAuthority;
      token.decimals = parsedMint.decimals;
      token.supply = parsedMint.supply;
      contract.supply = parsedMint.supply;
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

  // ── 2. DAS getAsset：元数据 / 供应量 / 价格 / 扩展 ───────────────
  if (assetRes.status === 'fulfilled') {
    const asset = assetRes.value;
    if (asset) {
      const md = asset.content?.metadata;
      if (md?.name) token.name = md.name.trim();
      if (md?.symbol) token.symbol = md.symbol.trim();
      if (asset.content?.links?.image) token.imageUrl = asset.content.links.image;
      if (asset.mutable !== undefined) contract.isMutableMetadata = asset.mutable;

      const ti = asset.token_info;
      if (ti) {
        // DAS 的供应量/精度作为 RPC 失败时的兜底
        if (token.supply === undefined && ti.supply !== undefined && ti.decimals !== undefined) {
          token.supply = ti.supply / 10 ** ti.decimals;
          contract.supply = token.supply;
          token.decimals = ti.decimals;
          origins.token = origins.token ?? 'onchain';
        }
        if (token.decimals === undefined && ti.decimals !== undefined) token.decimals = ti.decimals;
        if (!contract.tokenProgram && ti.token_program) contract.tokenProgram = ti.token_program;
        const price = ti.price_info?.price_per_token;
        if (typeof price === 'number' && price > 0) {
          token.priceUsd = price;
          if (token.supply) token.marketCapUsd = price * token.supply;
        }
      }

      // mint 扩展：补上 TLV 没覆盖到的（DAS 用 snake_case）
      const mapped = Object.keys(asset.mint_extensions ?? {})
        .map((k) => DAS_EXTENSION_MAP[k])
        .filter((v): v is string => Boolean(v));
      if (mapped.length) {
        contract.extensions = [...new Set([...(contract.extensions ?? []), ...mapped])];
      }
    }
  } else {
    warnings.push(`DAS getAsset 失败：${msg(assetRes.reason)}（名称/符号/价格可能缺失）`);
  }

  // ── 3. 最大持仓 ─────────────────────────────────────────────────
  const holders: RawHolder[] = [];
  if (largestRes.status === 'fulfilled') {
    const largest = largestRes.value;
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
      // 由 pools.ts 用确定性 PDA 推导 + DexScreener pair 完成，
      // 结果在 mergeInputs 里回填。此处只标记 burn。
      holders.push({
        address: owner,
        tokenAccount: acc.address.toBase58(),
        amount,
        pct,
        isBurn,
        label: isBurn ? 'burn' : undefined,
      });
    });

    // 托管持仓识别：区分「个人巨鲸」与「锁仓 / 多签 / 程序托管」。
    // 失败不影响主流程，但必须在 warnings 里说明，不能静默当作普通持仓。
    if (holders.length > 0 && supply > 0) {
      const { custody, pools: ammPools } = await detectCustody(
        connection,
        holders.map((h) => ({ owner: h.address, tokenAccount: h.tokenAccount ?? '' })),
        warnings,
      );
      // AMM 金库按池剔除（比地址正则可靠得多）
      for (const h of holders) {
        const amm = ammPools.get(h.address);
        if (amm) {
          h.isPool = true;
          h.label = amm;
        }
      }
      if (ammPools.size > 0) {
        warnings.push(
          `按控制程序识别出 ${ammPools.size} 个 AMM/联合曲线金库（${[...new Set(ammPools.values())].join('、')}），已按流动性池剔除。`,
        );
      }
      if (custody.size > 0) {
        for (const h of holders) {
          const c = custody.get(h.address);
          if (c) h.custody = c;
        }
        const locks = holders.filter((h) => h.custody?.kind === 'timelock');
        if (locks.length > 0) {
          const lockPct = locks.reduce((s, h) => s + (h.pct ?? 0), 0);
          warnings.push(
            `识别到 ${locks.length} 个时间锁仓持仓（合计 ${lockPct.toFixed(1)}%）：` +
              `${locks.map((h) => h.custody!.label).join('、')}。` +
              '已从集中度与巨鲸计算中剔除，并单独列出。解锁时间当前无法读取（托管账户是 PDA），标为「待接入」。',
          );
        }
      }
    }
    origins.holders = 'onchain';

    if (supply === 0) {
      warnings.push('未能读到代币总供应量，持仓占比无法计算，集中度维度将标记为未采集。');
      origins.holders = 'unavailable';
      holders.length = 0;
    } else if (holders.length > 0) {
      warnings.push(
        '链上仅返回前 20 大持仓账户；更深的分布需要索引器。若 AMM 池地址未被识别为池，' +
        '其持仓会计入集中度，导致 Top10 占比偏高。',
      );
    }
  } else {
    warnings.push(`读取持仓分布失败：${msg(largestRes.reason)}`);
    origins.holders = 'unavailable';
  }

  return { token, contract: contractRead ? contract : null, holders, origins };
}

/** DAS `mint_extensions` 的 snake_case key → 我们的扩展名 */
const DAS_EXTENSION_MAP: Record<string, string> = {
  transfer_hook: 'transferHook',
  permanent_delegate: 'permanentDelegate',
  transfer_fee_config: 'transferFeeConfig',
  non_transferable: 'nonTransferable',
  interest_bearing_config: 'interestBearing',
  mint_close_authority: 'mintCloseAuthority',
  default_account_state: 'defaultAccountStateFrozen',
  // metadata / metadata_pointer 是 pump.fun 的正常配置，不是风险项，故意不映射
};

// ── 交易历史推导：买卖结构 + dev 行为 ───────────────────────────────

interface TxActivity {
  buyCount: number;
  sellCount: number;
  buyVolumeSol: number;
  sellVolumeSol: number;
  /** 买单中交出代币的对手方 → 经验推断的池/金库地址 */
  poolCandidates: Map<string, number>;
  devSells: { ts?: number; amount: number }[];
  devBuys: number;
  mintedMints: Set<string>;
  firstSellTs?: number;
  uniqueTraders: Set<string>;
}

/**
 * 判断一笔交易的买卖方向并累计。
 *
 * 优先用 `events.swap`（解析度最高）；它为空时（pump.fun AMM 的
 * `type: UNKNOWN` 交易正是如此）退回用 fee payer 的 SOL 净变化：
 * 收到 SOL = 卖出代币，付出 SOL = 买入代币。
 */
function classifyTx(
  tx: HeliusTx,
  mint: string,
  acc: TxActivity,
  creator: string | undefined,
  decimals: number,
): void {
  const trader = tx.feePayer;
  const own = tx.accountData?.find((a) => a.account === trader);

  let side: 'buy' | 'sell' | undefined;
  const sw = tx.events?.swap;
  if (sw && (sw.tokenInputs?.length || sw.tokenOutputs?.length)) {
    const outMine = (sw.tokenOutputs ?? []).some((t) => t.mint === mint);
    const inMine = (sw.tokenInputs ?? []).some((t) => t.mint === mint);
    if (outMine && !inMine) side = 'buy';
    else if (inMine && !outMine) side = 'sell';
  }
  if (!side && own?.nativeBalanceChange !== undefined) {
    const net = own.nativeBalanceChange + (tx.fee ?? 0);
    if (net > 0) side = 'sell';
    else if (net < 0) side = 'buy';
  }
  if (!side) return;

  // 成交额（SOL）：fee payer 的净变化扣掉手续费
  let sol = 0;
  if (own?.nativeBalanceChange !== undefined) {
    sol = Math.max(0, Math.abs(own.nativeBalanceChange) - (tx.fee ?? 0)) / 1e9;
  } else {
    for (const n of tx.nativeTransfers ?? []) {
      if (n.fromUserAccount === trader || n.toUserAccount === trader) sol += (n.amount ?? 0) / 1e9;
    }
  }

  const ts = tx.timestamp;
  if (trader) acc.uniqueTraders.add(trader);

  if (side === 'buy') {
    acc.buyCount++;
    acc.buyVolumeSol += sol;
  } else {
    acc.sellCount++;
    acc.sellVolumeSol += sol;
  }

  // 经验推断池地址：买单里把代币交出来的对手方就是池/金库
  //
  // ⚠️ 这个信号**不可靠，因此不采纳**（保留代码仅为记录教训）。
  // 「买单里交出代币」无法区分「AMM 池提供流动性」与「dev/巨鲸在砸盘」——
  // 两者在数据上完全一样。实测后果很严重：dev 持有 46% 供应量、
  // 因为频繁卖出而被判成「池」并剔除，报告显示「持仓分布健康」，
  // 把一个高度集中的币判成了安全。宁可漏掉池（已在 warnings 里说明），
  // 也绝不能把 dev 的筹码当成流动性抹掉。
  for (const c of tx.accountData ?? []) {
    for (const t of c.tokenBalanceChanges ?? []) {
      if (t.mint !== mint) continue;
      const amt = Number(t.rawTokenAmount?.tokenAmount ?? 0);
      if (side === 'buy' && amt < 0 && t.userAccount && t.userAccount !== trader) {
        acc.poolCandidates.set(t.userAccount, (acc.poolCandidates.get(t.userAccount) ?? 0) + 1);
      }
    }
  }

  // dev 行为：creator 在本代币上的买卖
  if (creator) {
    for (const c of tx.accountData ?? []) {
      if (c.account !== creator) continue;
      for (const t of c.tokenBalanceChanges ?? []) {
        if (t.mint !== mint) continue;
        const raw = Number(t.rawTokenAmount?.tokenAmount ?? 0);
        const amt = Math.abs(raw) / 10 ** (t.rawTokenAmount?.decimals ?? decimals);
        if (raw > 0) acc.devBuys += amt;
        else if (raw < 0) {
          acc.devSells.push({ ts, amount: amt });
          if (ts !== undefined && (acc.firstSellTs === undefined || ts < acc.firstSellTs)) {
            acc.firstSellTs = ts;
          }
        }
      }
    }
    for (const t of tx.tokenTransfers ?? []) {
      if (t.mint !== mint) continue;
      if (t.toUserAccount === creator) acc.devBuys += t.tokenAmount ?? 0;
      if (t.fromUserAccount === creator) {
        acc.devSells.push({ ts, amount: t.tokenAmount ?? 0 });
        if (ts !== undefined && (acc.firstSellTs === undefined || ts < acc.firstSellTs)) {
          acc.firstSellTs = ts;
        }
      }
    }
  }

  // creator 发起的铸造 → 历史发币
  if (tx.type === 'CREATE' || tx.type === 'TOKEN_MINT') {
    for (const t of tx.tokenTransfers ?? []) if (t.mint) acc.mintedMints.add(t.mint);
    for (const c of tx.accountData ?? []) {
      for (const t of c.tokenBalanceChanges ?? []) if (t.mint) acc.mintedMints.add(t.mint);
    }
  }
}

function analyzeTxs(
  txs: HeliusTx[],
  mint: string,
  creator: string | undefined,
  decimals: number,
): TxActivity {
  const acc: TxActivity = {
    buyCount: 0,
    sellCount: 0,
    buyVolumeSol: 0,
    sellVolumeSol: 0,
    poolCandidates: new Map(),
    devSells: [],
    devBuys: 0,
    mintedMints: new Set(),
    uniqueTraders: new Set(),
  };
  for (const tx of txs) {
    if (tx.transactionError) continue; // 失败的交易不算成交
    classifyTx(tx, mint, acc, creator, decimals);
  }
  return acc;
}

// ── 市场数据（来自真实成交）─────────────────────────────────────────

export interface MintActivityResult {
  liquidity: Partial<LiquidityInfo>;
  poolCandidates: string[];
  creator?: string;
  createdSec?: number;
  origin: FieldOrigin;
}

/** 同一 mint 的成交分析结果缓存，避免 fetchMintActivity 与 fetchDeveloper 重复拉取 */
const activityCache = new Map<string, { act: TxActivity; createdAtSec?: number }>();

/**
 * 用真实成交推导市场指标，补充/替代 DexScreener。
 *
 * 这是「蜜罐」与「刷量」检测的核心输入，而且比 DexScreener 的聚合数字更原始：
 * 我们看的是每一笔成交的方向与金额，不是别人算好的汇总。
 */
export async function fetchMintActivity(
  mint: string,
  decimals: number,
  warnings: string[],
): Promise<MintActivityResult> {
  const liquidity: Partial<LiquidityInfo> = {};
  const poolCandidates: string[] = [];

  if (!hasEnhancedApi()) {
    return {
      liquidity,
      poolCandidates,
      origin: 'unavailable',
    };
  }

  // 最近成交（买卖结构）+ 最早一笔（部署者、发币时间）并行
  const [recentRes, oldestRes] = await Promise.allSettled([
    enhancedTxs(mint, { limit: 100, sortOrder: 'desc' }),
    enhancedTxs(mint, { limit: 1, sortOrder: 'asc' }),
  ]);

  let creator: string | undefined;
  let createdSec: number | undefined;

  if (oldestRes.status === 'fulfilled') {
    const tx = oldestRes.value[0];
    createdSec = tx?.timestamp;
    // ⚠️ 部署者 = 创建交易的 fee payer。
    // 真实 pump.fun 代币的 DAS creators 是空的，metadata 指望不上。
    if (tx?.feePayer) {
      creator = tx.feePayer;
      if (tx.type !== 'CREATE' && tx.type !== 'TOKEN_MINT') {
        warnings.push(
          '最早一笔交易不是创建交易，部署者身份取自该笔的 fee payer，' +
          '可能是首个买家而非发币人，请人工确认。',
        );
      }
    }
  } else {
    warnings.push(`拉取最早交易失败：${msg(oldestRes.reason)}（无法确定部署者与发币时间）`);
  }

  let origin: FieldOrigin = 'unavailable';
  if (recentRes.status === 'fulfilled') {
    const txs = recentRes.value;
    const act = analyzeTxs(txs, mint, creator, decimals);
    activityCache.set(mint, { act, createdAtSec: createdSec });

    if (act.buyCount + act.sellCount > 0) {
      liquidity.buyCount = act.buyCount;
      liquidity.sellCount = act.sellCount;
      liquidity.buyVolumeSol = Math.round(act.buyVolumeSol * 1e4) / 1e4;
      liquidity.sellVolumeSol = Math.round(act.sellVolumeSol * 1e4) / 1e4;
      origin = 'onchain';
    } else {
      warnings.push(
        `最近 ${txs.length} 笔交易里没有可识别的买卖方向（可能样本太少，或该交易类型未被 Helius 解析）。`,
      );
    }

    // ⚠️ 刻意**不**把「买单对手方」当作池地址 —— 见 classifyTx 里的说明。
    // 该信号无法区分 AMM 池与 dev 砸盘，误用会把 dev 的筹码抹成流动性。
    // 池地址只认 pools.ts 的确定性推导与 DexScreener 的 pair。
  } else {
    warnings.push(`拉取成交明细失败：${msg(recentRes.reason)}`);
  }

  return { liquidity, poolCandidates, creator, createdSec, origin };
}

// ── 开发者履历 ──────────────────────────────────────────────────────

export interface DeveloperResult {
  developer: DeveloperInfo | null;
  warnings: string[];
  origin: FieldOrigin;
}

/**
 * 采集部署者履历。
 *
 * 能做的事（全部来自真实成交数据）：
 * - creator 的买入/卖出 → dev sold ratio、是否清仓、首次卖出距发币多久
 * - creator 发起的铸造 → 历史发币、近 7 天是否广撒网
 * - creator 的最早交易 → 资金来源（是否为中介钱包）
 *
 * 明确**不做**的事：把 creator 的其它代币判定为 rug。
 * 那需要那些币的价格与流动性历史，单次查询无法负责任地断言 ——
 * 所以 priorRugCount 不猜，宁可留空。
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
        '未配置 Helius API key，「开发者历史」维度无法计算（dev 卖出、历史发币都需要 Enhanced API）。',
      ],
      origin: 'unavailable',
    };
  }
  if (!creator) {
    return {
      developer: null,
      warnings: [
        ...warnings,
        '未能确定部署者地址（创建交易缺失），「开发者历史」维度无法计算。',
      ],
      origin: 'unavailable',
    };
  }

  const dev: DeveloperInfo = { creator };
  const localWarnings: string[] = [];

  // ── 0. 权威判据：creator 在该代币上的**当前链上余额** ─────────────
  // 流水比例（卖出/买入）会被交易历史窗口截断而失真 —— 实测出现过
  // 「流水算出已清仓、链上却仍持有 27.6% 供应量」的严重误判。
  // 余额是事实，流水只是推断，所以必须查余额。
  const balanceRes = await Promise.allSettled([fetchOwnerTokenBalance(creator, mint)]);

  // 复用 fetchMintActivity 已经算好的本代币 dev 行为
  const cached = activityCache.get(mint);
  if (cached) {
    const { act, createdAtSec } = cached;
    const sold = act.devSells.reduce((s, x) => s + x.amount, 0);
    if (act.devBuys > 0) {
      dev.devSoldRatio = Math.min(1, sold / act.devBuys);
      dev.devHoldingPct = Math.max(0, ((act.devBuys - sold) / act.devBuys) * 100);
    } else if (act.devSells.length > 0) {
      dev.devSoldRatio = 1;
    }
    if (
      act.firstSellTs !== undefined &&
      createdAtSec !== undefined &&
      act.firstSellTs >= createdAtSec
    ) {
      dev.devFirstSellAgeSec = act.firstSellTs - createdAtSec;
    }
  }

  // 用链上余额覆盖流水推断：余额为 0 才算清仓，否则明确标记未清仓
  const bal = balanceRes[0];
  if (bal.status === 'fulfilled' && bal.value !== null) {
    const holding = bal.value;
    dev.devFullyExited = holding === 0 && (dev.devSoldRatio ?? 0) > 0;
    dev.devCurrentBalance = holding;
    if (dev.devFullyExited === false && holding > 0) {
      localWarnings.push(
        `creator 当前仍持有 ${holding.toLocaleString()} 枚该代币，` +
        '因此不会判定为「已清仓」（流水比例可能因历史窗口截断而偏高）。',
      );
    }
  } else {
    // 查不到余额 → 明确标记「未知」，让分析器只提示不否决
    dev.devFullyExited = undefined;
    localWarnings.push('未能读取 creator 的代币余额，无法确认其是否已清仓，将只作提示不作判死。');
  }

  // creator 自己的历史：历史发币 + 资金来源并行
  const [histRes, oldestRes] = await Promise.allSettled([
    enhancedTxs(creator, { limit: 100, sortOrder: 'desc' }),
    enhancedTxs(creator, { limit: 3, sortOrder: 'asc' }),
  ]);

  if (histRes.status === 'fulfilled') {
    const list = histRes.value;
    const mintedOthers = new Set<string>();
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86_400;
    const recent = new Set<string>();

    for (const tx of list) {
      if (tx.type !== 'CREATE' && tx.type !== 'TOKEN_MINT') continue;
      const mints = new Set<string>();
      for (const t of tx.tokenTransfers ?? []) if (t.mint) mints.add(t.mint);
      for (const c of tx.accountData ?? []) {
        for (const t of c.tokenBalanceChanges ?? []) if (t.mint) mints.add(t.mint);
      }
      for (const m of mints) {
        mintedOthers.add(m);
        if (tx.timestamp && tx.timestamp >= weekAgo) recent.add(m);
      }
    }

    const prior = [...mintedOthers].filter((m) => m !== mint);
    if (prior.length > 0) dev.priorTokens = prior.slice(0, 50).map((m) => ({ mint: m }));
    if (recent.size > 0) dev.tokensLast7d = recent.size;
    if (list.length === 0) {
      localWarnings.push('部署者地址没有交易历史，dev 卖出与历史发币无法验证。');
    }
  } else {
    localWarnings.push(`查询部署者历史失败：${msg(histRes.reason)}`);
  }

  // 资金来源：看 creator 最早一笔交易的 SOL 是谁给的。
  // ⚠️ `/v1/wallet/{w}/funded-by` 已下线（Invalid method），只能这样推断。
  if (oldestRes.status === 'fulfilled') {
    for (const tx of oldestRes.value) {
      const funder: string | undefined = (tx.nativeTransfers ?? []).find(
        (n) => n.toUserAccount === creator,
      )?.fromUserAccount;
      if (funder && funder !== creator) {
        dev.linkedWallets = [funder];
        break;
      }
    }
  } else {
    localWarnings.push(`查询部署者资金来源失败：${msg(oldestRes.reason)}`);
  }

  return { developer: dev, warnings: localWarnings, origin: 'onchain' };
}

/**
 * 解析 Jupiter Lock 的 `VestingEscrow` 账户，读出解锁时间表。
 *
 * 布局是**对着真实账户反推并交叉验证过**的，不是猜的：
 *   [8:40]   recipient
 *   [40:72]  token_mint      ← 解成 base58 后与查询的 mint 完全一致（锚点校验）
 *   [72:104] creator
 *   [104:136] base
 *   [136]    escrow_bump(u8) + 若干 u8 标志位，到 144 为止
 *   [144]    cliff_time            (u64, unix 秒) ← 首次解锁
 *   [152]    frequency             (u64, 秒)      实测 2592000 = 30 天
 *   [160]    cliff_unlock_amount   (u64, 最小单位)
 *   [168]    amount_per_period     (u64, 最小单位)
 *   [176]    number_of_period      (u64)
 *   [184]    total_claimed_amount  (u64)
 *   [192]    vesting_start_time    (u64, unix 秒)
 *
 * 三条互相独立的校验都通过，因此这个偏移是可信的：
 *  1. [40:72] 解出的 base58 **正好等于**该账户对应的 mint
 *  2. cliff_time（2026-10-01）− vesting_start_time（2026-09-01）= 1 个 frequency
 *  3. cliff 额度 + 每期额度 × 期数 = 10,000,000,000,000 + 同样值 × 71
 *     = 720,000,000,000,000 最小单位 = **720,000,000 枚**，
 *     与该托管账户实际持有的 720,000,002 枚（72% 供应量）吻合
 */
export function parseJupiterLockEscrow(data: Buffer): {
  cliffAt?: number;
  endsAt?: number;
  totalAmount?: number;
  claimedAmount?: number;
} | null {
  if (data.length < 200) return null;
  const cliffTime = Number(data.readBigUInt64LE(144));
  const frequency = Number(data.readBigUInt64LE(152));
  const cliffUnlock = Number(data.readBigUInt64LE(160));
  const perPeriod = Number(data.readBigUInt64LE(168));
  const periods = Number(data.readBigUInt64LE(176));
  const claimed = Number(data.readBigUInt64LE(184));
  const startTime = Number(data.readBigUInt64LE(192));

  // 合理性校验：时间戳必须落在 2020–2100，frequency 不能是天文数字。
  // 校验不过就当解析失败（宁可显示「待接入」也不要报一个错的日期）。
  const sane = (t: number) => t > 1_577_836_800 && t < 4_102_444_800;
  if (!sane(cliffTime) || !sane(startTime)) return null;
  if (frequency <= 0 || frequency > 400 * 24 * 3600) return null;

  // 最后一次解锁：cliff 之后每 frequency 一次，共 periods 次
  const endsAt = periods > 0 ? cliffTime + frequency * (periods - 1) : cliffTime;
  return {
    cliffAt: cliffTime,
    endsAt,
    totalAmount: cliffUnlock + perPeriod * periods,
    claimedAmount: claimed,
  };
}

/**
 * 判断一批持仓地址里，哪些是**由程序控制**（锁仓 / 多签 / 托管），
 * 而不是个人钱包。
 *
 * 判据是账户的 **owner 程序**，这是权威且廉价的：
 *   - owner 是 System Program        → 普通钱包
 *   - owner 是已知托管程序            → 锁仓 / 多签，可读出解锁时间
 *   - owner 是其它程序                → 程序控制（协议未确认）
 *   - **查不到账户**（PDA）           → 回退用 token account 的创建交易反查
 *
 * ⚠️ 这里曾经有一个会**给出错误结论**的 bug：
 * 旧代码把「owner 有账户」直接当成「普通钱包」而跳过。但 Jupiter Lock 的
 * 托管账户（VestingEscrow）**本身就是一个有数据的账户**（296 字节），
 * owner 正是 Lock 程序。于是 9raUVuzeWUk…pump 上那个占 **72% 供应量**的
 * 锁仓仓位被当成普通巨鲸，报告给出「持仓集中度过高」的硬否决 ——
 * 完全错误的结论。
 * 教训：**「有账户」不等于「是钱包」，要看 owner 程序是谁。**
 *
 * 铁律不变：只有 `timelock` 会被剔除；多签/未确认托管照常计入集中度。
 */
async function detectCustody(
  connection: Connection,
  holders: { owner: string; tokenAccount: string }[],
  warnings: string[],
): Promise<{ custody: Map<string, HolderCustody>; pools: Map<string, string> }> {
  const result = new Map<string, HolderCustody>();
  const pools = new Map<string, string>();
  if (holders.length === 0) return { custody: result, pools };

  const dedup = new Map<string, string>(); // owner -> tokenAccount
  for (const h of holders) {
    if (!h.owner || dedup.has(h.owner)) continue;
    dedup.set(h.owner, h.tokenAccount);
  }
  const owners = [...dedup.keys()];

  const noAccount: string[] = []; // PDA 候选，走回退路径
  try {
    for (let i = 0; i < owners.length; i += 100) {
      const chunk = owners.slice(i, i + 100).map((a) => new PublicKey(a));
      const infos = await connection.getMultipleAccountsInfo(chunk);
      infos.forEach((info, j) => {
        const owner = owners[i + j];
        if (info === null) {
          noAccount.push(owner);
          return;
        }
        const programId = info.owner.toBase58();
        if (programId === SYSTEM_PROGRAM_ID) return; // 普通钱包

        // AMM / 联合曲线程序拥有的账户 = 池子储备金库 → 剔除
        const amm = AMM_PROGRAMS[programId];
        if (amm) {
          pools.set(owner, amm);
          return;
        }

        const known = CUSTODY_PROGRAMS[programId];
        if (known) {
          const custody: HolderCustody = {
            programId,
            kind: known.kind,
            label: known.label,
          };
          // 锁仓：顺手从托管账户里读出解锁时间
          if (known.kind === 'timelock') {
            const schedule =
              programId === JUPITER_LOCK_PROGRAM_ID
                ? parseJupiterLockEscrow(Buffer.from(info.data))
                : null;
            if (schedule) {
              custody.unlockAt = new Date(schedule.cliffAt! * 1000).toISOString();
              custody.unlockEndAt = new Date(schedule.endsAt! * 1000).toISOString();
              custody.claimedAmount = schedule.claimedAmount;
              custody.totalAmount = schedule.totalAmount;
            } else {
              custody.unlockAtUnknown = true;
            }
          }
          result.set(owner, custody);
          return;
        }

        // owner 是一个程序，但不在核实名单里 —— 此时**可以**如实标注程序 id，
        // 因为这个 id 来自账户的 owner 字段（权威），不是从交易里猜的。
        result.set(owner, {
          programId,
          kind: 'unknown-program',
          label: `程序托管（${programId.slice(0, 6)}…）`,
        });
      });
    }
  } catch (err) {
    warnings.push(`托管持仓识别失败（无法批量读取 owner 账户）：${msg(err)}`);
    return { custody: result, pools };
  }

  // 回退：owner 没有账户 → PDA，用 token account 最早一笔交易反查控制程序
  if (noAccount.length > 0 && hasEnhancedApi()) {
    const CAP = 12;
    const probe = noAccount.slice(0, CAP);
    const unmatched: string[] = [];
    const traced = await Promise.allSettled(
      probe.map((owner) => enhancedTxs(dedup.get(owner)!, { limit: 1, sortOrder: 'asc' })),
    );
    probe.forEach((owner, i) => {
      const res = traced[i];
      if (res.status !== 'fulfilled') return;
      const tx = res.value[0];
      if (!tx) return;
      const programIds = new Set<string>();
      for (const ix of tx.instructions ?? []) if (ix.programId) programIds.add(ix.programId);
      // 只认核实过的程序：从交易里取的 id 不如 owner 字段权威，
      // 拿它去命名会翻车（曾把 SOLANA_PROGRAM_LIBRARY 当成托管方）。
      for (const pid of programIds) {
        const known = CUSTODY_PROGRAMS[pid];
        if (known) {
          result.set(owner, {
            programId: pid,
            kind: known.kind,
            label: known.label,
            unlockAtUnknown: known.kind === 'timelock',
          });
          return;
        }
      }
      unmatched.push(owner);
    });
    if (unmatched.length > 0) {
      warnings.push(
        `另有 ${unmatched.length} 个持仓的 owner 是 PDA，但控制程序不在已核实名单里，` +
          '因此不标注、也不剔除，按普通持仓计入集中度。',
      );
    }
    if (noAccount.length > CAP) {
      warnings.push(
        `有 ${noAccount.length} 个 PDA 持仓，只反查了前 ${CAP} 个；其余按普通持仓处理（偏保守）。`,
      );
    }
  } else if (noAccount.length > 0) {
    warnings.push(
      `发现 ${noAccount.length} 个 PDA 持仓，但未配置 Helius API key 无法反查控制程序，` +
        '一律按普通持仓计入集中度（不做剔除）。',
    );
  }

  return { custody: result, pools };
}

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const JUPITER_LOCK_PROGRAM_ID = 'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn';

/** 社交数据：Helius 不提供，保留占位以便将来接第三方 */
export function fetchSocial(): SocialInfo | null {
  return null;
}

/**
 * 查询某个 owner 在指定 mint 上的**当前**代币总余额（UI 单位）。
 *
 * 这是判断「部署者是否已清仓」的唯一权威依据 ——
 * 流水比例会被历史窗口截断，余额不会。
 *
 * 返回 `null` 表示查询失败/无法确认（**不等于 0**）：
 * 调用方必须把「查不到」与「确实是 0」区分开，否则又会出现
 * 「没查到 → 当成已清仓 → 误判跑路」的错误。
 */
export async function fetchOwnerTokenBalance(owner: string, mint: string): Promise<number | null> {
  try {
    const res = await rpcCall<{
      value?: {
        account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmountString?: string } } } } };
      }[];
    }>('getTokenAccountsByOwner', [
      owner,
      { mint },
      { encoding: 'jsonParsed' },
    ]);
    const accounts = res?.value ?? [];
    let total = 0;
    for (const a of accounts) {
      const s = a.account?.data?.parsed?.info?.tokenAmount?.uiAmountString;
      if (s) total += Number(s);
    }
    return total;
  } catch {
    return null;
  }
}
