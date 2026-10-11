/**
 * Helius provider 的纯逻辑测试。
 *
 * 覆盖两个「错了会静默误导用户」的地方：
 *  1. Token-2022 扩展解析 —— 漏掉 transferHook/permanentDelegate 会把蜜罐判成安全
 *  2. 重试策略 —— 网络不通时重试会把扫描从 10 秒拖到 65 秒
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PublicKey } from '@solana/web3.js';
import {
  RetryableError,
  buildLargeSells,
  buildTradeSizeAudit,
  isLikelyMint,
  parseJupiterLockEscrow,
  parseMintAccount,
  parseToken2022Extensions,
  withRetry,
} from './helius.ts';

// ── Token-2022 扩展解析 ────────────────────────────────────────────
// 布局：mint 基础数据(166) 之后是 [u16 type][u16 len][payload]，type=0 结束

function mintWithExtensions(entries: { type: number; payload: Buffer }[]): Buffer {
  const head = Buffer.alloc(166);
  const parts: Buffer[] = [head];
  for (const e of entries) {
    const h = Buffer.alloc(4);
    h.writeUInt16LE(e.type, 0);
    h.writeUInt16LE(e.payload.length, 2);
    parts.push(h, e.payload);
  }
  parts.push(Buffer.alloc(4)); // type=0 终止
  return Buffer.concat(parts);
}

test('解析出 transferHook —— 这是最危险的作恶扩展之一', () => {
  const buf = mintWithExtensions([{ type: 14, payload: Buffer.alloc(64) }]);
  const r = parseToken2022Extensions(buf);
  assert.deepEqual(r.names, ['transferHook']);
});

test('解析出 permanentDelegate —— 持币可被任意转走', () => {
  const buf = mintWithExtensions([{ type: 9, payload: Buffer.alloc(32) }]);
  assert.deepEqual(parseToken2022Extensions(buf).names, ['permanentDelegate']);
});

test('多个扩展全部识别，不遗漏', () => {
  const buf = mintWithExtensions([
    { type: 14, payload: Buffer.alloc(64) },
    { type: 9, payload: Buffer.alloc(32) },
    { type: 10, payload: Buffer.alloc(0) },
  ]);
  const r = parseToken2022Extensions(buf);
  assert.deepEqual(r.names.sort(), ['nonTransferable', 'permanentDelegate', 'transferHook']);
});

test('解析转移税：取新旧费率中的较大值（即将生效的更危险）', () => {
  // transferFeeConfig payload: authority(32) + withdrawAuthority(32)
  //   + older: feeBps(u64) + maxFee(u64) + newer: feeBps(u64) + maxFee(u64)
  const p = Buffer.alloc(108);
  p.writeBigUInt64LE(300n, 64 + 8); // older fee = 3%
  p.writeBigUInt64LE(900n, 64 + 24); // newer fee = 9%
  const r = parseToken2022Extensions(mintWithExtensions([{ type: 1, payload: p }]));
  assert.equal(r.transferFeeBps, 900, '应取较大值，否则会低估抛售成本');
  assert.ok(r.names.includes('transferFeeConfig'));
});

test('没有扩展时返回空，不报错（普通 SPL 代币的正常路径）', () => {
  const r = parseToken2022Extensions(Buffer.alloc(82));
  assert.deepEqual(r.names, []);
  assert.equal(r.transferFeeBps, 0);
});

test('数据被截断时不抛错、不死循环', () => {
  // 伪造一个 length 超大的 TLV 项：offset 会越过 buffer 末尾
  const buf = Buffer.concat([Buffer.alloc(166), Buffer.from([14, 0, 255, 255]), Buffer.alloc(8)]);
  const r = parseToken2022Extensions(buf);
  assert.ok(r.names.includes('transferHook'));
});

test('全零数据不产生任何扩展（type=0 立即终止）', () => {
  assert.deepEqual(parseToken2022Extensions(Buffer.alloc(200)).names, []);
});

// ── 地址校验 ───────────────────────────────────────────────────────
test('识别合法 mint，拒绝明显不是地址的输入', () => {
  assert.equal(isLikelyMint('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), true);

  // 含 base58 排除字符（0 O I l）的必须拒绝
  for (const bad of ['', 'hello', '0x1234', 'IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII', '0OIl']) {
    assert.equal(isLikelyMint(bad), false, `${bad} 不应被当成合法 mint`);
  }

  // 注意：地址长度不固定（32 字节 base58 后为 32–44 字符），
  // 所以不能靠「必须 44 位」来判断。这里用解码后不足 32 字节的串验证。
  assert.equal(isLikelyMint('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTD'), false);
});

// ── 重试策略（性能保证）────────────────────────────────────────────
test('只重试 RetryableError：临时故障重试 3 次', async () => {
  let calls = 0;
  const r = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new RetryableError('429');
    return 'ok';
  });
  assert.equal(r, 'ok');
  assert.equal(calls, 3);
});

test('网络错误不重试 —— 否则扫描耗时翻三倍', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw new TypeError('fetch failed');
    }),
  );
  assert.equal(calls, 1, '连接失败必须立即放弃，不能重试');
});

test('超时不重试', async () => {
  let calls = 0;
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw abort;
    }),
  );
  assert.equal(calls, 1);
});

test('RetryableError 用尽重试次数后抛出最后一次错误', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw new RetryableError('503');
    }),
  );
  assert.equal(calls, 3);
});

// ── 回归测试：转移税字节偏移（真实账户数据）────────────────────────
// 真实 mint HNHkQkiku8h1sWoWPtq7QC8paEFZYs2J3RpZkGKHSViz 的
// transferFeeConfig payload。真实费率 = 100 bps = 1%。
// 读错字段时会把 older.epoch(1053) 当费率，算出 69,009,508 bps。
const REAL_FEE_PAYLOAD =
  // configAuthority [0:32]
  '0783a81526210f94a0e8e84d2087003b3a4260d29ce79dacfe21a4ea771fa628' +
  // withdrawWithheldAuthority [32:64]
  '402d5caf7a97c53497658e561b2623d0e38f5340f208add50a4ef4540b0acb2e' +
  // withheldAmount [64:72]
  'eae6451027030000' +
  // older TransferFee [72:90]: epoch(u64) + maximumFee(u64) + bps(u16)
  '1d04000000000000' + '0080c6a47e8d0300' + '6400' +
  // newer TransferFee [90:108]
  '1d04000000000000' + '0080c6a47e8d0300' + '6400';

function mintAccountWithFeeConfig(): Buffer {
  const payload = Buffer.from(REAL_FEE_PAYLOAD, 'hex');
  assert.equal(payload.length, 108, '真实 payload 应为 108 字节');
  const tlv = Buffer.alloc(4);
  tlv.writeUInt16LE(1, 0); // transferFeeConfig
  tlv.writeUInt16LE(108, 2);
  const end = Buffer.alloc(2); // TLV 结束标记
  return Buffer.concat([Buffer.alloc(166), tlv, payload, end]);
}

test('转移税：从真实 Token-2022 字节里读出正确的 100 bps', () => {
  const data = mintAccountWithFeeConfig();
  const { names, transferFeeBps } = parseToken2022Extensions(data);
  assert.ok(names.includes('transferFeeConfig'));
  assert.equal(transferFeeBps, 100, `应为 100 bps（1%），实际 ${transferFeeBps}`);
  // 明确挡掉曾经读到的那个错值
  assert.notEqual(transferFeeBps, 69009508);
});

test('转移税：绝不把 epoch 当成费率（会高出几个数量级）', () => {
  const data = mintAccountWithFeeConfig();
  const { transferFeeBps } = parseToken2022Extensions(data);
  assert.ok(transferFeeBps < 10_000, `费率不应超过 10000 bps，实际 ${transferFeeBps}`);
});

test('转移税：没有该扩展时费率为 0', () => {
  const onlyMetadata = Buffer.concat([
    Buffer.alloc(166),
    Buffer.from('12004000', 'hex'), // metadataPointer, len=64
    Buffer.alloc(64),
    Buffer.alloc(2),
  ]);
  assert.equal(parseToken2022Extensions(onlyMetadata).transferFeeBps, 0);
});

// ── 回归测试：mint 账户权限解析（真实账户字节）──────────────────────
// 这两个 bug 都会输出与链上事实相反的结论，必须有真实数据锁住。

// 案例 A：真实代币 6GmtGgjP…pump。
// tag=0（权限已放弃），但 payload 是**非零残留数据**。
// 旧代码用「payload 是否等于全零地址」判断，于是误报「铸币权限未放弃」
// 并触发硬否决 —— 凭空捏造的危险信号。
const REAL_MINT_TAG0_GARBAGE =
  '00000000' + // tag = 0 → None，权限已放弃
  '06c5c1ce638d2567d26468b05eb951d1a28dcc6e123482b5c675149770e62bf2' + // 非零残留，旧代码在此翻车
  'd87546081d8d0300' + // supply
  '06' + // decimals = 6
  '01' + // is_initialized
  '00000000' + // freeze tag = 0 → 已放弃
  '00'.repeat(32);

// 案例 B：真实代币 CASHx9KJ…CASH，两个权限都存在。
// 旧代码把 freeze pubkey 读在 [46:78]，把 tag 混进地址，输出错位地址。
const REAL_MINT_BOTH_AUTHORITIES =
  '01000000' + // mint tag = 1 → Some
  'f2334a917c56ebea16ca2cf9fef67a492b1d6f2004553f8e78b2e25bc1ed69f2' +
  'e1dadc40ef730000' + // supply
  '06' + '01' +
  '01000000' + // freeze tag = 1 → Some
  '941e93413ec408e6222a65d0c695aa953b7db0375c0ab0c85cc7388f500a50b6' + // ← 起点是 50，不是 46
  '00'.repeat(0);

test('权限解析：tag=0 时即使 payload 非零，也必须判为「已放弃」', () => {
  const r = parseMintAccount(Buffer.from(REAL_MINT_TAG0_GARBAGE, 'hex'));
  assert.ok(r);
  assert.equal(r.mintAuthority, null, 'tag=0 就是已放弃，不能去看 payload 字节');
  assert.equal(r.freezeAuthority, null);
  assert.equal(r.decimals, 6);
});

test('权限解析：绝不把 COption 的残留 payload 当成有效地址', () => {
  const r = parseMintAccount(Buffer.from(REAL_MINT_TAG0_GARBAGE, 'hex'));
  // 旧代码在这里得到 'TSLvdd1p…' 并据此报「铸币权限未放弃」
  assert.notEqual(r?.mintAuthority, 'TSLvdd1p');
  assert.ok(!r?.mintAuthority, '不应产出任何地址');
});

test('权限解析：tag=1 时读出的两个地址都正确（freeze 在 [50:82]）', () => {
  const r = parseMintAccount(Buffer.from(REAL_MINT_BOTH_AUTHORITIES, 'hex'));
  assert.ok(r);
  assert.equal(r.mintAuthority, 'HJT2TXrhbWta2ax7V86vcnmX7ZmAVzua4v2yrGwchXB7');
  assert.equal(r.freezeAuthority, 'AyCP3oW19DHZKvx8oU6mvseW2qn7XfmQ5STrXPa6prY5');
});

test('权限解析：数据不足 82 字节时返回 null，而不是瞎猜', () => {
  assert.equal(parseMintAccount(Buffer.alloc(40)), null);
});

// ── Jupiter Lock 托管账户：解锁时间解析（真实账户原样字节）──────────
// 这是 9raUVuzeWUk53co63M4WXLWPWE4Xc6Lpn7RS9dnkpump 上那个占 72% 供应量的
// Jupiter Lock 托管账户（Fw398k4H48GSFnRhrBZPUSRqYQqubiaV5hBFQjRohhp）本体。
//
// 偏移不是猜的：该段 [40:72] 解成 base58 **正好等于上面这个 mint**，
// 且 cliff 额度 + 每期额度 × 期数 = 720,000,000,000,000 最小单位
// = 720,000,000 枚，与该账户实际持有量吻合。
const REAL_JUPITER_LOCK_ESCROW =
  'f477b704497487c3871ba52d7dd67f5b681fd262b6b06f28b3f3c1cae2f668f8d4516d39b682ba688390cdea340d6fa90790c1302ad12ade6df77a48f771d186' +
  'cb735754a0ad6f9f871ba52d7dd67f5b681fd262b6b06f28b3f3c1cae2f668f8d4516d39b682ba68226f6bbc62b30a188d75e1ba3440626408abad43c886bc1c' +
  '94079894e137a075ff00000000000000035cbe6a00000000008d27000000000000a0724e1809000000a0724e1809000047000000000000000000000000000000' +
  '03cf966a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' +
  '00000000000000000000000000000000000000000000000000000000000000000000000000000000';

test('Jupiter Lock：从真实托管账户读出解锁时间（首次 / 全部）', () => {
  const s = parseJupiterLockEscrow(Buffer.from(REAL_JUPITER_LOCK_ESCROW, 'hex'));
  assert.ok(s, '应能解析');
  assert.equal(new Date(s.cliffAt! * 1000).toISOString(), '2026-10-01T13:11:31.000Z');
  assert.equal(new Date(s.endsAt! * 1000).toISOString(), '2032-07-01T13:11:31.000Z');
  assert.equal(s.claimedAmount, 0, '尚未领取');
  // 10,000,000,000,000（cliff 额度）+ 同样值 × 71 期 = 720,000,000,000,000 最小单位
  assert.equal(s.totalAmount, 720_000_000_000_000);
});

test('Jupiter Lock：偏移锚点校验 —— [40:72] 必须就是该 mint', () => {
  const raw = Buffer.from(REAL_JUPITER_LOCK_ESCROW, 'hex');
  assert.equal(new PublicKey(raw.subarray(40, 72)).toBase58(),
    '9raUVuzeWUk53co63M4WXLWPWE4Xc6Lpn7RS9dnkpump');
  // 首次解锁必须晚于归属开始，且正好相差 1 个周期（30 天）
  const cliff = Number(raw.readBigUInt64LE(144));
  const freq = Number(raw.readBigUInt64LE(152));
  const start = Number(raw.readBigUInt64LE(192));
  assert.equal(freq, 2_592_000, '周期应为 30 天');
  assert.equal(cliff - start, freq, 'cliff 应正好是 start + 1 个周期');
});

test('Jupiter Lock：时间戳不合理时返回 null，绝不编一个日期出来', () => {
  // 全零账户：若不做合理性校验，会解析出 1970 年的「解锁时间」
  assert.equal(parseJupiterLockEscrow(Buffer.alloc(296)), null);
  // 长度不足
  assert.equal(parseJupiterLockEscrow(Buffer.alloc(100)), null);
});

// ── 逐笔量级证据（真实数据：9raUVuze…pump 的最近 100 笔）────────────
test('逐笔量级证据：真实成交分布能算出「小额买盘撑笔数、大额卖盘出货」', () => {
  // 实测数据：买单 64 笔共 1.847 SOL、卖单 14 笔共 2.285 SOL，
  // 其中最大一笔卖单 2.028 SOL（占卖出总额 88.8%）。
  const buys = [
    ...Array.from({ length: 56 }, () => 0.0066), // 小额买盘
    ...Array.from({ length: 8 }, () => 0.185), // 少数大额买盘
  ];
  const sells = [2.028, 0.108, 0.037, 0.029, 0.026, ...Array.from({ length: 9 }, () => 0.0064)];
  const audit = buildTradeSizeAudit({
    buyCount: buys.length,
    sellCount: sells.length,
    buySizesSol: buys,
    sellSizesSol: sells,
    sellVolumeSol: sells.reduce((s, x) => s + x, 0),
    minTs: 1_700_000_000,
    maxTs: 1_700_000_000 + 3925 * 60,
  })!;

  assert.equal(audit.trades, 78);
  assert.equal(audit.windowSec, 3925 * 60, '样本跨度必须透出来：100 笔可能跨几天');
  assert.ok(audit.sellMedianSol < audit.buyMedianSol * 5, `卖单中位数 ${audit.sellMedianSol}`);
  assert.equal(audit.sellMaxSol, 2.028);
  assert.ok(
    (audit.largestSellSharePct ?? 0) > 80,
    `最大一笔卖单应占卖出总额 80% 以上，实际 ${audit.largestSellSharePct}`,
  );
  assert.ok(
    (audit.top5SellSharePct ?? 0) > (audit.largestSellSharePct ?? 0),
    '前 5 大卖单占比必须 ≥ 最大单笔占比',
  );
});

test('只有单边成交时不给量级证据（避免「卖单中位数 0」被读成卖单很小）', () => {
  assert.equal(
    buildTradeSizeAudit({
      buyCount: 10,
      sellCount: 0,
      buySizesSol: [0.1, 0.2],
      sellSizesSol: [],
      sellVolumeSol: 0,
    }),
    undefined,
  );
  assert.equal(
    buildTradeSizeAudit({
      buyCount: 0,
      sellCount: 3,
      buySizesSol: [],
      sellSizesSol: [1, 2, 3],
      sellVolumeSol: 6,
    }),
    undefined,
  );
});

test('大额卖单明细：按金额取前 N 笔并保留签名，空/零额条目不得混进来', () => {
  const mk = (sol: number, sig: string) => ({ signature: sig, sol, ts: 1_700_000_000, trader: 'Wallet' });
  const top = buildLargeSells(
    [
      mk(0.026, 'sig-a'),
      mk(2.028, 'sig-big'),
      mk(0, 'sig-zero'), // 金额 0（判定不出成交额）→ 不能当成「大额卖单」
      { signature: '', sol: 9 }, // 没有签名 → 读者无法核对，剔除
      mk(0.108, 'sig-c'),
      mk(1.5, 'sig-d'),
    ],
    3,
  )!;
  assert.deepEqual(
    top.map((s) => s.signature),
    ['sig-big', 'sig-d', 'sig-c'],
  );
  assert.equal(top[0].sol, 2.028);
  assert.equal(buildLargeSells([]), undefined);
  assert.equal(buildLargeSells([mk(0, 'x')]), undefined);
});
