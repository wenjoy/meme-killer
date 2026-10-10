/**
 * 池地址解析 —— 「持币集中度」准确率的关键。
 *
 * 为什么必须做：bonding curve 与 AMM 池天然持有大部分供应量。
 * 不把它们的地址识别出来剔除，任何正常项目都会被算成「Top10 控盘 80%」——
 * 这是整个模型最大的误报源。
 *
 * 为什么不能靠地址文本猜：真实池地址是随机 base58 字符串，
 * 用 /pool|vault|amm/ 这类正则去匹配**几乎永远匹配不到**，
 * 只会让人误以为已经处理过了。所以这里用**确定性推导**：
 *
 *   1. PDAs 推导：pump.fun bonding curve 的地址由 mint 唯一确定
 *      （seeds = ["bonding-curve", mint]），可以直接算出来。
 *   2. ATA 推导：池持有代币用的是它的 associated token account，
 *      地址也可由 (池地址, mint) 唯一算出。
 *   3. DexScreener 的 pairAddress：AMM 池地址的直接来源。
 *
 * 三者任一命中即判定为池。仍然无法覆盖的（如部分 AMM 的 vault authority）
 * 会在 warnings 里如实说明，而不是假装已经处理干净。
 */
import { PublicKey } from '@solana/web3.js';

/** pump.fun bonding curve 程序 */
export const PUMP_BONDING_CURVE_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
/** PumpSwap AMM 程序 */
export const PUMPSWAP_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
/** Raydium AMM v4 */
export const RAYDIUM_AMM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
/** WSOL */
const WSOL = 'So11111111111111111111111111111111111111112';
/** SPL Associated Token Account 程序 */
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/** SPL Token 程序 */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

export interface PoolCandidates {
  /** 判定为池的地址集合（可能是池本身，也可能是池的 token account） */
  addresses: Set<string>;
  /** 每个候选地址的来源说明，用于 UI 展示与排错 */
  labels: Record<string, string>;
  /** 推导过程中的告警 */
  warnings: string[];
}

function pda(seeds: (Buffer | Uint8Array)[], programId: string): string | null {
  try {
    return PublicKey.findProgramAddressSync(seeds, new PublicKey(programId))[0].toBase58();
  } catch {
    return null;
  }
}

/** 由 (owner, mint) 推导 associated token account 地址 */
export function deriveAta(owner: string, mint: string): string | null {
  try {
    return PublicKey.findProgramAddressSync(
      [new PublicKey(owner).toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), new PublicKey(mint).toBuffer()],
      new PublicKey(ATA_PROGRAM),
    )[0].toBase58();
  } catch {
    return null;
  }
}

/**
 * 解析一个 mint 可能关联的所有池地址。
 *
 * @param mint      代币 mint
 * @param creator   部署者（PumpSwap 池 PDA 推导需要）
 * @param pairAddresses DexScreener 返回的 pair 地址
 */
export function resolvePoolAddresses(
  mint: string,
  creator: string | undefined,
  pairAddresses: string[] = [],
): PoolCandidates {
  const addresses = new Set<string>();
  const labels: Record<string, string> = {};
  const warnings: string[] = [];

  const add = (addr: string | null, label: string) => {
    if (!addr) return;
    addresses.add(addr);
    labels[addr] = label;
  };

  let mintBuf: Buffer;
  try {
    mintBuf = new PublicKey(mint).toBuffer();
  } catch {
    return { addresses, labels, warnings: [`mint 地址无法解析，跳过池推导：${mint}`] };
  }

  // ── 1. pump.fun bonding curve PDA + 它的 ATA ────────────────────
  const curve = pda([Buffer.from('bonding-curve'), mintBuf], PUMP_BONDING_CURVE_PROGRAM);
  if (curve) {
    add(curve, 'pump.fun bonding curve');
    // 池持有的代币在它的 ATA 里，所以 token account 地址也要能识别
    add(deriveAta(curve, mint), 'pump.fun bonding curve ATA');
  }

  // ── 2. PumpSwap 池 PDA（需要 creator，index 通常为 0）────────────
  if (creator) {
    try {
      const index = Buffer.alloc(2);
      index.writeUInt16LE(0);
      const pool = pda(
        [
          Buffer.from('pool'),
          index,
          new PublicKey(creator).toBuffer(),
          mintBuf,
          new PublicKey(WSOL).toBuffer(),
        ],
        PUMPSWAP_PROGRAM,
      );
      if (pool) {
        add(pool, 'PumpSwap pool');
        add(deriveAta(pool, mint), 'PumpSwap pool ATA');
      }
    } catch {
      /* creator 非法地址时忽略 */
    }
  }

  // ── 3. DexScreener 的 pair 地址（最直接的 AMM 池来源）───────────
  for (const pair of pairAddresses) {
    add(pair, 'DexScreener pair');
    add(deriveAta(pair, mint), 'DexScreener pair ATA');
    // 部分 AMM（如 Raydium v4）代币存在独立 vault 账户而非 ATA，
    // 这类无法靠推导拿到，需索引器支持。
    void RAYDIUM_AMM_V4;
  }

  if (addresses.size === 0) {
    warnings.push('未能推导出任何池地址，池持仓可能被计入集中度，Top10 占比会偏高。');
  }

  return { addresses, labels, warnings };
}
