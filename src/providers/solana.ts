/**
 * Solana RPC Provider —— 链上事实的唯一可信来源。
 *
 * 这里只取**链上能确证的事实**：代币程序、mint/freeze authority、
 * Token-2022 扩展、供应量、最大持仓地址。
 *
 * 明确拿不到 / 不猜的东西：
 * - 社交数据、dev 历史 rug 数、狙击占比 —— 需要额外的索引器，标记为 unavailable
 * - bonding curve 内部储备、毕业阈值 —— 属于协议内部常量，需运行时解析 curve 账户
 *
 * 设计原则：**宁可标记「未知」，也不要编造一个看起来确定的数字**。
 * 未知会被 UI 显示为「数据缺失」，而错误的数据会直接误导买入决策。
 */
import { Connection, PublicKey } from '@solana/web3.js';
import {
  BURN_ADDRESSES,
  POOL_LABEL_PATTERN,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@/core/constants';
import type { ContractInfo, FieldOrigin, RawHolder, ScanInput, TokenInfo } from '@/core/types';

export const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

export function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC;
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

/** Token-2022 的 TLV 扩展类型编号 → 名称 */
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
 *
 * 布局：82 字节基础 mint 数据之后是扩展区，
 * 每项为 [u16 type][u16 length][payload...]，以 type=0 结束。
 * ⚠️ 不做这一步会漏掉 transferHook / permanentDelegate 这类「蜜罐级」扩展。
 */
export function parseToken2022Extensions(data: Buffer): { names: string[]; transferFeeBps: number } {
  const names: string[] = [];
  let transferFeeBps = 0;
  let offset = 166; // Token-2022 mint 基础长度（含 padding）
  // 兼容不同长度实现：若数据短于 166 则从 82 起尝试
  if (data.length < offset) offset = 82;
  if (data.length <= offset) return { names, transferFeeBps };

  let guard = 0;
  while (offset + 4 <= data.length && guard++ < 64) {
    const type = data.readUInt16LE(offset);
    const len = data.readUInt16LE(offset + 2);
    if (type === 0) break;
    const name = TLV_EXTENSION_NAMES[type];
    if (name) names.push(name);
    // transferFeeConfig: [authority(32)][withdrawAuthority(32)][older(8+8)][newer(8+8)]
    // fee 以 bps 为单位存在 u64 里，取两个 epoch 中较早的一个
    if (type === 1 && len >= 108) {
      const base = offset + 4 + 64;
      try {
        const olderFee = Number(data.readBigUInt64LE(base + 8));
        const newerFee = Number(data.readBigUInt64LE(base + 24));
        transferFeeBps = Math.max(olderFee, newerFee);
      } catch {
        /* 解析失败则保持 0，由 LP/税项其它信号兜底 */
      }
    }
    offset += 4 + len;
  }
  return { names, transferFeeBps };
}

interface RpcResult<T> {
  value: T;
  origin: FieldOrigin;
  warning?: string;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * 从链上采集基础事实。
 * 任何一项失败都不抛出，而是降级为 warning —— 部分数据也比没有数据好，
 * 但缺失必须在 meta.warnings 里如实呈现。
 */
export async function fetchOnChain(
  mint: string,
  warnings: string[],
): Promise<{
  token: Partial<TokenInfo>;
  contract: ContractInfo | null;
  holders: RawHolder[];
  origins: Record<string, FieldOrigin>;
  supply?: number;
}> {
  const origins: Record<string, FieldOrigin> = {};
  const connection = new Connection(rpcUrl(), 'confirmed');
  const mintPk = new PublicKey(mint);

  const contract: ContractInfo = {};
  const token: Partial<TokenInfo> = { mint };

  // ── 1. mint 账户：程序归属 + authority + 供应量 ─────────────────
  try {
    const info = await withRetry(() => connection.getAccountInfo(mintPk));
    if (!info) {
      warnings.push(`链上未找到 mint 账户 ${mint}，可能地址错误或不属于 Solana 主网。`);
      origins.contract = 'unavailable';
      return { token, contract: null, holders: [], origins };
    }

    // ⚠️ 必须读 getAccountInfo().owner 来判断代币程序。
    // getParsedAccountInfo 返回的 parsed.info.owner 是 **authority**，不是程序 id，
    // 混淆这两者会导致「所有代币都用了 Token-2022」的严重误判。
    const programId = info.owner.toBase58();
    contract.tokenProgram = programId;
    origins.contract = 'onchain';

    const is2022 = programId === TOKEN_2022_PROGRAM_ID;
    const isLegacy = programId === TOKEN_PROGRAM_ID;
    if (!is2022 && !isLegacy) {
      warnings.push(`mint 账户的 owner 是 ${programId}，既不是 SPL Token 也不是 Token-2022，需人工核对。`);
    }

    const data = Buffer.from(info.data);
    if (data.length >= 82) {
      const mintAuthority = new PublicKey(data.subarray(4, 36)).toBase58();
      const supplyRaw = data.readBigUInt64LE(36);
      const decimals = data[44];
      const freezeAuthority = new PublicKey(data.subarray(46, 78)).toBase58();

      const ZERO_PK = '11111111111111111111111111111111';
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
  } catch (err) {
    warnings.push(`读取 mint 账户失败：${err instanceof Error ? err.message : String(err)}`);
    origins.contract = 'unavailable';
  }

  // ── 2. 最大持仓 ─────────────────────────────────────────────────
  const holders: RawHolder[] = [];
  try {
    const largest = await withRetry(() => connection.getTokenLargestAccounts(mintPk));
    const supply = token.supply ?? 0;
    const decimals = token.decimals ?? 0;

    // 逐个取 owner，才能识别 pool / burn / dev
    const ownerResults = await Promise.allSettled(
      largest.value.slice(0, 20).map((acc) => connection.getParsedAccountInfo(acc.address)),
    );

    largest.value.slice(0, 20).forEach((acc, i) => {
      const amount = Number(acc.amount) / 10 ** decimals;
      const pct = supply > 0 ? (amount / supply) * 100 : 0;
      const res = ownerResults[i];
      let address = acc.address.toBase58();
      let label: string | undefined;
      if (res?.status === 'fulfilled') {
        const parsed = res.value.value?.data;
        if (parsed && 'parsed' in parsed && parsed.parsed?.info?.owner) {
          address = parsed.parsed.info.owner as string;
        }
      }
      if (BURN_ADDRESSES.has(address)) label = 'burn';
      // 已知 AMM 程序的 owner 无法直接识别为池，仅能靠标签模式兜底
      const isPool = BURN_ADDRESSES.has(address) === false && POOL_LABEL_PATTERN.test(label ?? '');
      holders.push({
        address,
        amount,
        pct,
        label,
        isBurn: BURN_ADDRESSES.has(address),
        isPool,
      });
    });
    origins.holders = 'onchain';
    if (largest.value.length > 0) {
      warnings.push(
        '链上仅能取到前 20 大持仓账户，且无法自动识别 AMM 池地址 —— ' +
          '池持仓可能未被剔除，Top10 集中度可能偏高。生产环境需接入池地址索引。',
      );
    }
  } catch (err) {
    warnings.push(`读取持仓分布失败：${err instanceof Error ? err.message : String(err)}`);
    origins.holders = 'unavailable';
  }

  return { token, contract, holders, origins };
}
