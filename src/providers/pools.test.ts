/**
 * 池地址推导的测试。
 *
 * 这个模块是「持币集中度」准确率的关键：漏掉池 → Top10 虚高 → 误报庄家控盘；
 * 误把正常钱包当池 → Top10 虚低 → 漏报真实集中度。两个方向都要锁住。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';

import { decodeBondingCurve, deriveAta, deriveBondingCurve, PUMP_BONDING_CURVE_PROGRAM, resolvePoolAddresses } from './pools.ts';
import { classifyHolder } from '../core/analyzers/holders.ts';

// 一个合法的 mint 地址（USDC，仅用于推导形状，与 pump.fun 无关）
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const CREATOR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

test('推导出的地址都是合法 base58，且确定性可复现', () => {
  const a = resolvePoolAddresses(MINT, []);
  assert.ok(a.addresses.size > 0, '至少应推导出 bonding curve');
  for (const addr of a.addresses) {
    assert.doesNotThrow(() => new PublicKey(addr), `${addr} 应为合法地址`);
  }
  // 同样输入必须得到同样输出，否则剔除逻辑会随机漂移
  const b = resolvePoolAddresses(MINT, []);
  assert.deepEqual([...a.addresses].sort(), [...b.addresses].sort());
});

test('bonding curve 与它的 ATA 都被识别为池', () => {
  const r = resolvePoolAddresses(MINT, []);
  const labels = Object.values(r.labels);
  assert.ok(labels.includes('pump.fun bonding curve'));
  assert.ok(
    labels.includes('pump.fun bonding curve ATA'),
    '池持有的代币在它的 ATA 里，只认池地址会漏掉真正的持仓账户',
  );
});

test('派生 ATA 与手工推导一致', () => {
  const ata = deriveAta(CREATOR, MINT);
  assert.ok(ata);
  const manual = PublicKey.findProgramAddressSync(
    [
      new PublicKey(CREATOR).toBuffer(),
      new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(),
      new PublicKey(MINT).toBuffer(),
    ],
    new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  )[0].toBase58();
  assert.equal(ata, manual);
});

test('不再推导未经校验的 PumpSwap 池地址（错的推导比没有更糟）', () => {
  // 实测：按 (creator, index 0) 推导出的 PumpSwap 池地址在链上并不存在
  // （建池者是迁移权限账户，不是代币创建者）。这类「看起来很像池」的随机地址
  // 会让人误以为 AMM 池已覆盖，因此已删除，改由 RugCheck 提供真实池地址。
  const r = resolvePoolAddresses(MINT, []);
  assert.ok(
    Object.values(r.labels).every((l) => !l.startsWith('PumpSwap')),
    '不应再有 PumpSwap 的猜测结果',
  );
});

test('DexScreener pair 地址及其 ATA 被纳入池集合', () => {
  const pair = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';
  const r = resolvePoolAddresses(MINT, [pair]);
  assert.ok(r.addresses.has(pair), 'pair 地址本身应被识别');
  assert.ok(r.labels[pair] === 'DexScreener pair');
  const pairAta = deriveAta(pair, MINT);
  if (pairAta) assert.ok(r.addresses.has(pairAta));
});

test('用推导结果剔除池持仓后，集中度不会被池的巨额持仓污染', () => {
  // 真实场景：bonding curve 持有 62% 供应量。
  // 若没识别出它，Top10 会虚高到 80%+ 并误报「庄家控盘」。
  const pools = resolvePoolAddresses(MINT, []);
  const curveAddr = [...pools.addresses][0];

  const holders = [
    { address: curveAddr, amount: 620_000_000, pct: 62 },
    ...Array.from({ length: 10 }, (_, i) => ({
      address: `RetailWallet${i}xxxxxxxxxxxxxxxxxxxxxxxxxxx`,
      amount: 10_000_000,
      pct: 1,
    })),
  ];

  // 未剔除池（没有传入 poolAddresses）→ 虚高
  const naive = classifyHolder(holders[0], {});
  assert.equal(naive, 'retail', '不传池地址时确实认不出来 —— 说明推导不可省');

  // 剔除池（传入推导结果）→ 正确
  const classified = classifyHolder(holders[0], { poolAddresses: pools.addresses });
  assert.equal(classified, 'pool');
});

test('非法 mint 不抛错，而是降级并给出告警', () => {
  const r = resolvePoolAddresses('not-a-valid-address', []);
  assert.equal(r.addresses.size, 0);
  assert.ok(r.warnings.length > 0, '必须显式告警，而不是静默返回空集合');
});

test('完全推导不出池时必须告警（否则用户不知道 Top10 偏高）', () => {
  const r = resolvePoolAddresses(MINT, []);
  // 这个 mint 能推出 bonding curve，所以不该告警
  assert.equal(r.warnings.length, 0);

  const bad = resolvePoolAddresses('x'.repeat(10), []);
  assert.ok(bad.warnings.some((w) => w.text.includes('mint 地址无法解析') || w.text.includes('未能推导')));
});

// ── bonding curve 解码 ───────────────────────────────────────────
// 阶段判定曾用「账户是否存在」来推断，结果给已毕业的代币报出
// 「尚未毕业 + curve 内 SOL 0」；正确判据是账户里的 complete 标志。
test('curve 账户的 complete 标志才是阶段判据，账户存在不能当未毕业', () => {
  const curve = deriveBondingCurve(MINT)!;
  const make = (complete: number, realSol: bigint) => {
    const data = Buffer.alloc(166);
    Buffer.from('17b7f83760d8ac60', 'hex').copy(data, 0);
    data.writeBigUInt64LE(30_000_000_000n, 16); // virtualSolReserves ≈ 30 SOL
    data.writeBigUInt64LE(realSol, 32);
    data.writeBigUInt64LE(1_000_000_000_000_000n, 40);
    data[48] = complete;
    return data;
  };

  const onCurve = decodeBondingCurve(PUMP_BONDING_CURVE_PROGRAM, make(0, 604_535_550n));
  assert.equal(onCurve?.complete, false);
  assert.ok(Math.abs((onCurve?.realSolReserves ?? 0) - 0.60453555) < 1e-9);

  const migrated = decodeBondingCurve(PUMP_BONDING_CURVE_PROGRAM, make(1, 0n));
  assert.equal(migrated?.complete, true, '已毕业的账户仍然存在，因此必须看标志而不是看存在性');

  // 校验不过就必须返回 null：按内存布局硬读会从无关账户里读出一个假余额
  assert.equal(decodeBondingCurve('SomeOtherProgram111111111111111111111111111', make(0, 5n)), null);
  assert.equal(decodeBondingCurve(PUMP_BONDING_CURVE_PROGRAM, Buffer.alloc(166)), null);
  assert.equal(decodeBondingCurve(PUMP_BONDING_CURVE_PROGRAM, Buffer.alloc(20)), null);
  assert.ok(curve, 'curve 地址应能推导出来');
});
