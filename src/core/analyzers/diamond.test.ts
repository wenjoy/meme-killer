/**
 * 钻石手维度测试。
 *
 * 锁的是三类最容易骗人的地方：
 * 1. 「没数据」不能被渲染成「0 个钻石手」；
 * 2. 「窗口里没看到卖」不能被当成「没卖过」（低覆盖必须自己说出来）；
 * 3. 部署者自己没卖、机器人高频进出，都不能算社区钻石手。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeDiamond } from './diamond.ts';
import type { DiamondEvidence, DiamondInfo, ScanInput } from '../types.ts';

const DAY = 86_400;
const NOW = 1_800_000_000;

interface Trade {
  trader: string;
  side: 'buy' | 'sell';
  sol: number;
  ts: number;
}

function input(over: {
  trades?: Trade[];
  creator?: string;
  launchWallet?: string;
  relatedWallets?: string[];
  holderBalances?: Map<string, number>;
  windowCoveragePct?: number;
  gapDays?: number;
}): ScanInput {
  return {
    token: { mint: 'M', symbol: 'T', supply: 1000 },
    ...(over.trades
      ? {
          diamond: {
            trades: over.trades,
            nowSec: NOW,
            ...(over.creator ? { creator: over.creator } : {}),
            ...(over.launchWallet ? { launchWallet: over.launchWallet } : {}),
            relatedWallets: over.relatedWallets ?? [],
            ...(over.holderBalances ? { holderBalances: over.holderBalances } : {}),
            windowCoveragePct: over.windowCoveragePct ?? 100,
            ...(over.gapDays !== undefined ? { gapDays: over.gapDays } : {}),
          },
        }
      : {}),
  };
}

const info = (r: ReturnType<typeof analyzeDiamond>) => r.metrics as unknown as DiamondInfo;
const evidence = (r: ReturnType<typeof analyzeDiamond>) =>
  (info(r).evidence ?? []) as DiamondEvidence[];

test('没有成交数据时是「无法分析」，绝不能写成「钻石手 0 个」', () => {
  const r = analyzeDiamond(input({}));
  assert.equal(r.metrics!.available, 0, '必须标记为未采集，让总分把这一维排除');
  assert.equal(r.metrics!.diamondHands, undefined, '没有数据就不该有「0 个」这种结论');
  const f = r.findings[0];
  assert.ok(f.title.includes('无法分析'), `标题要说明是没数据，实际「${f.title}」`);
  assert.ok(f.detail.includes('不是「没有钻石手」'), '必须写明「没数据 ≠ 没有钻石手」');
});

test('只买未卖 + 仍持仓 + 超过最短持有期 → 算钻石手', () => {
  const balances = new Map([['diamond1', 100]]);
  const r = analyzeDiamond(
    input({
      trades: [
        { trader: 'diamond1', side: 'buy', sol: 1, ts: NOW - 30 * DAY },
        { trader: 'flipper', side: 'buy', sol: 1, ts: NOW - 30 * DAY },
        { trader: 'flipper', side: 'sell', sol: 1.1, ts: NOW - 2 * DAY },
      ],
      holderBalances: balances,
    }),
  );
  assert.equal(info(r).diamondHands, 1);
  assert.equal(evidence(r)[0].address, 'diamond1');
  assert.equal(evidence(r)[0].holdDays, 30);
  assert.equal(evidence(r)[0].added, false, '只买一次不算加仓');
});

test('买了又卖光的钱包不是钻石手（余额必须用全量枚举交叉验证）', () => {
  const r = analyzeDiamond(
    input({
      // 窗口内只看到买入（卖出发生在窗口缺口里），但它现在余额是 0
      trades: [{ trader: 'exited', side: 'buy', sol: 5, ts: NOW - 60 * DAY }],
      holderBalances: new Map([['exited', 0]]),
    }),
  );
  assert.equal(info(r).diamondHands, 0, '余额为 0 说明已经卖光，不能算钻石手');
});

test('持有时间不足最短期限的不算 —— 刚买的人当然没卖', () => {
  const r = analyzeDiamond(
    input({
      trades: [{ trader: 'justbought', side: 'buy', sol: 5, ts: NOW - 0.5 * DAY }],
      holderBalances: new Map([['justbought', 100]]),
    }),
  );
  assert.equal(info(r).diamondHands, 0);
  assert.ok(info(r).analyzedWallets > 0, '它仍然是被分析过的钱包，只是不符合条件');
});

test('部署者与关联钱包不能算社区钻石手', () => {
  const r = analyzeDiamond(
    input({
      creator: 'devaddr',
      launchWallet: 'launchwallet',
      relatedWallets: ['teamwallet'],
      trades: [
        { trader: 'devaddr', side: 'buy', sol: 10, ts: NOW - 100 * DAY },
        { trader: 'launchwallet', side: 'buy', sol: 10, ts: NOW - 100 * DAY },
        { trader: 'teamwallet', side: 'buy', sol: 10, ts: NOW - 100 * DAY },
      ],
      holderBalances: new Map([
        ['devaddr', 100],
        ['launchwallet', 100],
        ['teamwallet', 100],
      ]),
    }),
  );
  assert.equal(info(r).diamondHands, 0, 'dev 自己没卖不是社区行为');
  assert.equal(info(r).excludedCount, 3);
  assert.equal(info(r).analyzedWallets, 0);
});

test('高频买卖交替的钱包被归为机器人，不污染比例', () => {
  const trades: Trade[] = [];
  for (let i = 0; i < 8; i++) {
    trades.push({ trader: 'bot', side: 'buy', sol: 0.1, ts: NOW - (100 - i) * DAY });
    trades.push({ trader: 'bot', side: 'sell', sol: 0.11, ts: NOW - (99.5 - i) * DAY });
  }
  const r = analyzeDiamond(input({ trades, holderBalances: new Map([['bot', 50]]) }));
  assert.equal(info(r).robotCount, 1);
  assert.equal(info(r).diamondHands, 0, '机器人即使「只买未卖」也不是钻石手');
  assert.ok(r.findings.some((f) => f.title.includes('高频交易')), '要说明排除了多少个，不能静默丢弃');
});

test('多次买入标记为加仓，并按持有时长排序', () => {
  const r = analyzeDiamond(
    input({
      trades: [
        { trader: 'older', side: 'buy', sol: 1, ts: NOW - 90 * DAY },
        { trader: 'newer', side: 'buy', sol: 1, ts: NOW - 20 * DAY },
        { trader: 'newer', side: 'buy', sol: 1, ts: NOW - 10 * DAY },
      ],
      holderBalances: new Map([
        ['older', 100],
        ['newer', 100],
      ]),
    }),
  );
  const rows = evidence(r);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].address, 'older', '按持有时长从长到短排');
  assert.equal(rows.find((x) => x.address === 'newer')!.added, true, '买两次算加仓');
  assert.equal(info(r).addOnCount, 1);
  assert.equal(info(r).medianHoldDays, 55, '中位数 = (90+20)/2');
});

test('窗口覆盖不足时必须自己说出来，且不给「筹码稳定」的结论', () => {
  const trades: Trade[] = [];
  for (let i = 0; i < 20; i++) {
    trades.push({ trader: `dh${i}`, side: 'buy', sol: 1, ts: NOW - 50 * DAY });
  }
  const balances = new Map(trades.map((t) => [t.trader, 10]));
  const r = analyzeDiamond(
    input({ trades, holderBalances: balances, windowCoveragePct: 9, gapDays: 677 }),
  );
  const warn = r.findings.find((f) => f.title.includes('时间跨度'));
  assert.ok(warn, '必须有一条 finding 说明窗口只覆盖了多少');
  assert.ok(warn.detail.includes('低估'), '必须写明比例低估，而不是让读者以为这是全貌');
  assert.ok(
    !r.findings.some((f) => f.title.includes('长期持有者手里')),
    '覆盖率不足时不能给「筹码在长期持有者手里」这种结论',
  );
  // 但数据本身仍然要给（钻石手占比 100%），只是带着警告
  assert.equal(info(r).sharePct, 100);
  assert.equal(info(r).windowCoveragePct, 9);
});

test('落在最早窗口内的证据被单独计数（证据强度不同）', () => {
  const r = analyzeDiamond({
    token: { mint: 'M', symbol: 'T' },
    diamond: {
      nowSec: NOW,
      relatedWallets: [],
      windowCoveragePct: 100,
      // 最早窗口只覆盖到 60 天前
      earlyWindowEndSec: NOW - 60 * DAY,
      trades: [
        { trader: 'early', side: 'buy', sol: 1, ts: NOW - 100 * DAY },
        { trader: 'recent', side: 'buy', sol: 1, ts: NOW - 30 * DAY },
      ],
      holderBalances: new Map([
        ['early', 10],
        ['recent', 10],
      ]),
    },
  });
  const rows = evidence(r);
  assert.equal(rows.find((x) => x.address === 'early')!.inEarlyWindow, true);
  assert.equal(
    rows.find((x) => x.address === 'recent')!.inEarlyWindow,
    false,
    '最近窗口里刚买的钱包装进「证据最强」会把结论拔高',
  );
  assert.equal(info(r).strongEvidenceCount, 1);
});
