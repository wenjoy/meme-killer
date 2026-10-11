/**
 * 维度 6：钻石手（持仓行为）
 *
 * ⚠️ 这个维度**权重为 0**：它不参与总分、不否决、也不影响风险等级。
 * 理由见 README §19 —— pump.fun 上九成钱包买了就卖，把「拿得住」直接当成利好，
 * 会让维度系统性地偏向「还没到卖出阶段的新币」。所以它只回答一个问题：
 * 「这只币的筹码是谁在拿、拿了多久」，不回答「该不该买」。
 *
 * 三个信号（全部来自**逐地址**成交，不是聚合数字）：
 * 1. 买了不卖 —— 窗口内只有买入记录、没有卖出记录，且**现在仍持仓**（用全量枚举交叉验证）
 * 2. 拿得住   —— 首次买入到现在的时长
 * 3. 还在加仓 —— 多次买入（不是一把梭）
 *
 * 三条必须写进结论的边界：
 * - 窗口中段（最早窗口结束 → 最近窗口开始）没拉到，所以「没看到卖」≠「没卖过」。
 *   只有落在最早窗口内的钱包，其「至今未卖」才是有力证据（覆盖时间最长）。
 * - 排除 creator / 关联钱包 / 狙击地址：部署者自己没卖不是社区钻石手。
 * - 排除高频机器人：买卖交替十几次的钱包既不是钻石手也不是散户，混进来会污染比例。
 */
import { THRESHOLDS, scoreFromFindings } from '../constants';
import type {
  DiamondEvidence,
  DiamondInfo,
  DimensionResult,
  Finding,
  HolderRow,
  ScanInput,
  Severity,
} from '../types';

/** 从逐地址成交里聚出一个钱包的行为画像 */
interface WalletBehavior {
  trader: string;
  buys: number;
  sells: number;
  buySol: number;
  sellSol: number;
  firstBuyTs?: number;
  lastSellTs?: number;
}

function buildBehaviors(
  trades: { trader: string; side: 'buy' | 'sell'; sol: number; ts?: number }[],
): Map<string, WalletBehavior> {
  const map = new Map<string, WalletBehavior>();
  for (const t of trades) {
    const b = map.get(t.trader) ?? { trader: t.trader, buys: 0, sells: 0, buySol: 0, sellSol: 0 };
    if (t.side === 'buy') {
      b.buys += 1;
      b.buySol += t.sol;
      if (t.ts !== undefined && (b.firstBuyTs === undefined || t.ts < b.firstBuyTs)) {
        b.firstBuyTs = t.ts;
      }
    } else {
      b.sells += 1;
      b.sellSol += t.sol;
      if (t.ts !== undefined && (b.lastSellTs === undefined || t.ts > b.lastSellTs)) {
        b.lastSellTs = t.ts;
      }
    }
    map.set(t.trader, b);
  }
  return map;
}

function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function analyzeDiamond(data: ScanInput): DimensionResult {
  const t = THRESHOLDS.diamond;
  const findings: Finding[] = [];
  const add = (severity: Severity, title: string, detail: string) =>
    findings.push({ severity, title, detail });

  const d = data.diamond;
  // 没有逐地址成交 = 未知。**不能用 0 表示**，否则界面上会变成「钻石手 0 个」。
  if (!d || d.trades.length === 0) {
    add(
      'medium',
      '持仓行为无法分析',
      '没有取到逐地址成交明细（Helius 增强接口不可用或该代币还没有成交），' +
        '因此无法判断谁买了不卖。这不是「没有钻石手」，是这一项没数据。',
    );
    return {
      dimension: 'diamond',
      label: '钻石手',
      score: 0,
      vetoed: false,
      findings,
      metrics: { available: 0 },
    };
  }

  const behaviors = buildBehaviors(d.trades);
  const excluded = new Set(
    [d.creator, d.launchWallet, ...d.relatedWallets].filter((x): x is string => !!x),
  );
  const holders = new Map<string, HolderRow>(
    (d.topHolders ?? []).map((h) => [h.address, h]),
  );
  const holderBalances = d.holderBalances ?? new Map<string, number>();

  const evidence: DiamondEvidence[] = [];
  let robotCount = 0;
  let excludedCount = 0;
  const holdDurationsDays: number[] = [];

  for (const b of behaviors.values()) {
    // 排除 creator / 关联钱包：部署者自己没卖不是社区行为
    if (excluded.has(b.trader)) {
      excludedCount += 1;
      continue;
    }
    // 排除高频机器人：买卖交替超过阈值，既不是钻石手也不是散户
    if (b.buys + b.sells >= t.robotTrades) {
      robotCount += 1;
      continue;
    }
    if (b.buys === 0) continue;

    // 当前持仓：优先全量枚举（含零余额账户），没有则退回前 20 名表
    const count = holderBalances.size > 0 ? holderBalances.get(b.trader) : undefined;
    const heldAmount = count ?? holderBalances.get(b.trader);
    const inTop = holders.get(b.trader);
    const stillHolds =
      holderBalances.size > 0
        ? (heldAmount ?? 0) > 0
        : inTop !== undefined && inTop.amount > 0;

    const holdsNeverSold = b.sells === 0;
    const ageDays =
      b.firstBuyTs !== undefined && d.nowSec > b.firstBuyTs
        ? (d.nowSec - b.firstBuyTs) / 86_400
        : undefined;

    if (!holdsNeverSold) continue;
    if (!stillHolds) continue; // 买了又卖光、或者余额已归零：不是钻石手
    if (ageDays === undefined || ageDays < t.minHoldDays) continue;

    const holderPct = inTop?.pct;
    evidence.push({
      address: b.trader,
      buys: b.buys,
      buySol: Math.round(b.buySol * 1e4) / 1e4,
      holdDays: Math.round(ageDays * 10) / 10,
      ...(b.firstBuyTs !== undefined ? { firstBuyTs: b.firstBuyTs } : {}),
      /** 是否落在最早窗口内（覆盖时间最长，「至今未卖」的证据力最强） */
      inEarlyWindow:
        d.earlyWindowEndSec !== undefined &&
        b.firstBuyTs !== undefined &&
        b.firstBuyTs <= d.earlyWindowEndSec,
      ...(holderPct !== undefined ? { holderPct } : {}),
      added: b.buys >= t.addOnBuys,
      ...(inTop?.kind ? { kind: inTop.kind } : {}),
    });
    holdDurationsDays.push(ageDays);
  }

  evidence.sort((a, b) => b.holdDays - a.holdDays);

  // 统计口径：分母是「窗口内出现过的独立交易者」，不是全部持有人 ——
  // 窗口外的持有人根本没有行为数据，拿他们当分母会把比例稀释成假的低。
  const analyzed = behaviors.size - excludedCount - robotCount;
  const withEvidence = evidence.length;
  const sharePct = analyzed > 0 ? (withEvidence / analyzed) * 100 : 0;
  const medianHoldDays = median(holdDurationsDays);
  const addOnCount = evidence.filter((e) => e.added).length;
  const strongEvidence = evidence.filter((e) => e.inEarlyWindow).length;

  // ⚠️ 窗口覆盖不足时，所有比例都只是「窗口内看到的」，必须先说清楚。
  // 这个币的实测：只覆盖了 9% 的时间跨度（中间缺 677 天），
  // 此时「钻石手 3 个」几乎肯定低估 —— 那些在缺口期间买入并一直持有的钱包
  // 根本不在样本里，它们既没出现在最早窗口、也没出现在最近窗口。
  const coverageLow = d.windowCoveragePct < t.minWindowCoveragePct;
  if (coverageLow) {
    add(
      'medium',
      `成交窗口只覆盖了 ${d.windowCoveragePct.toFixed(1)}% 的时间跨度`,
      `最近成交只取到最后 ${d.trades.length} 笔、最早只取到前 ${THRESHOLDS.liquidity.sniperWindowTrades} 笔，` +
        (d.gapDays !== undefined ? `中间有约 ${Math.round(d.gapDays)} 天没有数据。` : '') +
        '因此下面的人数与比例**只是窗口内的观测值，几乎肯定低估**：' +
        '缺口期间买入并一直持有的钱包不在样本里。要拿到完整画像需要逐地址拉历史（未实现）。',
    );
  }

  if (withEvidence === 0) {
    add(
      'low',
      '没有发现长期持有的钱包',
      `在 ${analyzed} 个可分析的钱包里，没有一个符合「只买未卖、仍持仓、持有超过 ${t.minHoldDays} 天」。` +
        (d.gapDays !== undefined
          ? `⚠️ 成交窗口中间有约 ${Math.round(d.gapDays)} 天没拉到，所以这只能说「窗口内没看到」，不能断言没人长期持有。`
          : ''),
    );
  } else {
    add(
      'good',
      `钻石手 ${withEvidence} 个（中位持有 ${medianHoldDays?.toFixed(1) ?? '—'} 天）`,
      `${analyzed} 个可分析钱包里有 ${withEvidence} 个符合「只买未卖 + 仍持仓 + 持有 ≥ ${t.minHoldDays} 天」，` +
        `占 ${sharePct.toFixed(1)}%` +
        (coverageLow ? `（⚠️ 窗口只覆盖 ${d.windowCoveragePct.toFixed(1)}% 的时间跨度，实际人数应该更多）` : '') +
        `；其中 ${strongEvidence} 个落在最早成交窗口内（证据最强），` +
        `${addOnCount} 个有过加仓。` +
        (evidence[0]
          ? `拿得最久的是 ${evidence[0].address.slice(0, 8)}…：持有 ${evidence[0].holdDays} 天，买入 ${evidence[0].buys} 次共 ${evidence[0].buySol} SOL` +
            (evidence[0].holderPct !== undefined ? `，当前占总供应 ${evidence[0].holderPct.toFixed(2)}%` : '') +
            '。'
          : ''),
    );
  }

  if (robotCount > 0) {
    add(
      'low',
      `排除 ${robotCount} 个高频交易地址`,
      `这些地址在窗口内买卖交替 ≥ ${t.robotTrades} 次，属于机器人/做市行为，` +
        '既不是钻石手也不是散户，因此不计入比例（否则会把持仓结构完全带偏）。',
    );
  }

  // 钻石手占比很高时，只做**描述**，不给「利好」结论（见文件头说明）
  if (withEvidence > 0 && sharePct >= t.strongSharePct && !coverageLow) {
    add(
      'good',
      '筹码集中在长期持有者手里',
      `钻石手占可分析钱包的 ${sharePct.toFixed(1)}%，说明这批筹码大概率不会马上砸出来。` +
        '⚠️ 这只是持仓结构描述，不构成买入理由 —— 老币的持有者天然比新币待得久。',
    );
  }

  const info: DiamondInfo = {
    analyzedWallets: analyzed,
    diamondHands: withEvidence,
    sharePct,
    strongEvidenceCount: strongEvidence,
    addOnCount,
    ...(medianHoldDays !== undefined
      ? { medianHoldDays: Math.round(medianHoldDays * 10) / 10 }
      : {}),
    evidence: evidence.slice(0, t.maxEvidenceRows),
    robotCount,
    excludedCount,
    tradesAnalyzed: d.trades.length,
    windowCoveragePct: d.windowCoveragePct,
    ...(d.gapDays !== undefined ? { gapDays: Math.round(d.gapDays) } : {}),
  };

  return {
    dimension: 'diamond',
    label: '钻石手',
    // 中性维度：分值只反映「持仓稳定性」，不进入总分（WEIGHTS.diamond = 0）
    score: scoreFromFindings(findings),
    vetoed: false,
    findings,
    metrics: { ...info, available: 1 },
  };
}
