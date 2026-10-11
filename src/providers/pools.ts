/**
 * 池地址解析 —— 「持币集中度」准确率的关键。
 *
 * 为什么必须做：bonding curve 与 AMM 池天然持有大部分供应量。
 * 不把它们的地址识别出来剔除，任何正常项目都会被算成「Top10 控盘 80%」——
 * 这是整个模型最大的误报源。
 *
 * 为什么不能靠地址文本猜：真实池地址是随机 base58 字符串，
 * 用 /pool|vault|amm/ 这类正则去匹配**几乎永远匹配不到**，
 * 只会让人误以为已经处理过了。所以这里只用**确定性推导 + 权威数据源**：
 *
 *   1. pump.fun bonding curve 的地址由 mint 唯一确定
 *      （seeds = ["bonding-curve", mint]），可以直接算出来；
 *   2. pump.fun 的代币余额在 curve 的 ATA 里，(curve, mint) 也能唯一算出；
 *   3. DexScreener 的 pairAddress 是 AMM 池的直接来源；
 *   4. RugCheck 的 market.pubkey / liquidityA / liquidityB 是**真实存在**的
 *      池与金库账户（Raydium v4 这类独立 vault 只有它能给出）。
 *
 * ⚠️ 曾经这里还用 PDA 推导过 PumpSwap 池（seeds 里的 creator 取代币创建者）。
 * 实测该推导对真实代币算出的地址在链上**并不存在**（PumpSwap 建池者是迁移
 * 权限账户，不是代币创建者），也就是说它只是一串「看起来很像池」的随机地址。
 * 未经验证的推导比没有更糟（会让人以为已经覆盖了），已删除，
 * 改用 RugCheck 给出的真实池地址。
 */
import { PublicKey } from '@solana/web3.js';
import { warn } from '../core/warning';
import type { Warning } from '../core/types';

/** pump.fun bonding curve 程序 */
export const PUMP_BONDING_CURVE_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
/** SPL Associated Token Account 程序 */
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/** SPL Token 程序 */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

export interface PoolCandidates {
  /** 判定为池的地址集合（可能是池本身，也可能是池的 token account） */
  addresses: Set<string>;
  /** 每个候选地址的来源说明，用于 UI 展示与排错 */
  /** 池地址 → 中文标签（过渡期回退） */
  labels: Record<string, string>;
  /** 池地址 → 字典 key（`pieces.poolLabels.*`），与 labels 一一对应 */
  labelKeys: Record<string, string>;
  /** 推导过程中的告警 */
  warnings: Warning[];
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
 * 推导 pump.fun bonding curve 账户地址（seeds = ["bonding-curve", mint]）。
 *
 * 这个地址也是「阶段判据」的入口：账户里的 `complete` 标志直接说明
 * 是否已经毕业（见 decodeBondingCurve）—— 靠账户是否存在来判断是错的，
 * 实测毕业后账户常常仍然存在，只是余额被清空。
 */
export function deriveBondingCurve(mint: string): string | null {
  try {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()],
      new PublicKey(PUMP_BONDING_CURVE_PROGRAM),
    )[0].toBase58();
  } catch {
    return null;
  }
}

/** BondingCurve 账户判别符（8 字节，所有 curve 账户一致） */
const BONDING_CURVE_DISCRIMINATOR = Buffer.from('17b7f83760d8ac60', 'hex');

export interface BondingCurveState {
  /** true = 已毕业（迁移到 AMM），此时 curve 余额恒为 0 */
  complete: boolean;
  /** 曲线内真实 SOL（仅未毕业时有意义） */
  realSolReserves: number;
  /**
   * 程序状态里记录的 creator（第 49..81 字节）。
   *
   * 这是**比「创建交易的 fee payer」更权威**的部署者来源：它是 pump.fun 程序
   * 自己写的字段（creator fee 收款方），而且事后可被 `set_creator` 改写。
   * 实测同一个代币上二者会不一致（用打包器发币、再把 creator 转给真 dev），
   * 所以必须把两者都取出来对照，而不是默认 fee payer 就是 dev。
   * 账户太短（旧版本）时为 undefined。
   */
  creator?: string;
}

/**
 * 解码 pump.fun BondingCurve 账户。
 *
 * 布局（实测 4 个真实账户逐个字段核对过，含一个未毕业、两个已毕业）：
 *   0  .. 8   判别符 17b7f83760d8ac60
 *   8  .. 16  virtualTokenReserves
 *   16 .. 24  virtualSolReserves（未毕业时约 30 SOL，是曲线的虚拟储备）
 *   24 .. 32  realTokenReserves
 *   32 .. 40  realSolReserves    ← 真实 SOL
 *   40 .. 48  tokenTotalSupply
 *   48        complete (bool)    ← 是否已毕业
 *   49 .. 81  creator
 *
 * 必须校验 owner 与判别符：推导出的地址如果指向别的账户（或账户被别人占用），
 * 直接按内存布局读数字会得到一段完全无关的字节，进而编造出一个「curve 余额」。
 * 校验不过就返回 null —— 未知好过错误。
 */
export function decodeBondingCurve(owner: string, data: Buffer | Uint8Array): BondingCurveState | null {
  if (owner !== PUMP_BONDING_CURVE_PROGRAM) return null;
  if (data.length < 49) return null;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buf.subarray(0, 8).equals(BONDING_CURVE_DISCRIMINATOR)) return null;
  // 旧版本 curve 账户只有 81 字节前缀的一部分；不足 81 字节就没有 creator 字段，
  // 此时宁可返回 undefined，也不要用越界/错位的字节编一个地址出来。
  let creator: string | undefined;
  if (buf.length >= 81) {
    try {
      creator = new PublicKey(buf.subarray(49, 81)).toBase58();
    } catch {
      creator = undefined;
    }
  }
  return {
    complete: buf[48] === 1,
    realSolReserves: Number(buf.readBigUInt64LE(32)) / 1e9,
    ...(creator ? { creator } : {}),
  };
}

/** 解析一个 mint 可能关联的所有池地址 */
export function resolvePoolAddresses(mint: string, pairAddresses: string[] = []): PoolCandidates {
  const addresses = new Set<string>();
  const labels: Record<string, string> = {};
  const labelKeys: Record<string, string> = {};
  const warnings: Warning[] = [];

  const add = (addr: string | null, label: string, labelKey?: string) => {
    if (!addr) return;
    addresses.add(addr);
    labels[addr] = label;
    if (labelKey) labelKeys[addr] = labelKey;
  };

  try {
    new PublicKey(mint);
  } catch {
    return {
      addresses,
      labels,
      labelKeys,
      warnings: [
        warn('warnings.pools.mintUnparsable', { mint }, `mint 地址无法解析，跳过池推导：${mint}`),
      ],
    };
  }

  // ── 1. pump.fun bonding curve PDA + 它的 ATA ────────────────────
  const curve = deriveBondingCurve(mint);
  if (curve) {
    add(curve, 'pump.fun bonding curve', 'pumpfunCurve');
    // 池持有的代币在它的 ATA 里，所以 token account 地址也要能识别
    add(deriveAta(curve, mint), 'pump.fun bonding curve ATA', 'pumpfunCurveAta');
  }

  // ── 2. DexScreener 的 pair 地址（最直接的 AMM 池来源）───────────
  // 部分 AMM（如 Raydium v4）代币存在独立 vault 账户而非 ATA，
  // 这类由 RugCheck 的 liquidityA/liquidityB 补上（见 providers/index.ts）。
  for (const pair of pairAddresses) {
    add(pair, 'DexScreener pair', 'dexscreenerPair');
    add(deriveAta(pair, mint), 'DexScreener pair ATA', 'dexscreenerPairAta');
  }

  if (addresses.size === 0) {
    warnings.push(
      warn('warnings.pools.noneDerived', undefined, '未能推导出任何池地址，池持仓可能被计入集中度，Top10 占比会偏高。'),
    );
  }

  return { addresses, labels, labelKeys, warnings };
}
