/**
 * Helius provider 的纯逻辑测试。
 *
 * 覆盖两个「错了会静默误导用户」的地方：
 *  1. Token-2022 扩展解析 —— 漏掉 transferHook/permanentDelegate 会把蜜罐判成安全
 *  2. 重试策略 —— 网络不通时重试会把扫描从 10 秒拖到 65 秒
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RetryableError, isLikelyMint, parseToken2022Extensions, withRetry } from './helius.ts';

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
