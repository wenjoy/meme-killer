/**
 * 抛压分布：这些还没卖的筹码，值多少钱、在什么价位、谁拿着。
 *
 * 核心是**成本价**：用「该地址的 SOL 净变化 ÷ 它的代币净变化」得到每笔成交的单价，
 * 再按代币量加权平均 → 每个钱包的持仓成本。有了成本就能看出
 * 「哪些价位一旦回本/一旦有薄利，会有一堆人卖」。
 *
 * ⚠️ 四条必须写进结论的限制：
 *
 * 1. **只有能配对的成交才算得出来**。实测窗口内 100 笔里只有 42 笔能归因
 *    （其余 58 笔 fee payer 的代币净变化是 0 —— 成交发生在别人的账户上）。
 *    所以「可分析钱包数」远小于真实持仓人数，必须印在界面上。
 * 2. **已卖光的不算抛压**。按剩余持仓折算：卖了一半的只算剩下一半，
 *    卖掉 ≥90% 的归入「已出走」，不管它赚了多少（赚 20 倍但已经跑了的不是抛压）。
 * 3. **隐含现价是反推的**，不是行情接口的价。最近一笔成交太旧时不给盈亏结论。
 * 4. 窗口没覆盖的卖出看不到 → 未卖量**可能高估**。与全量枚举的实际余额不一致时，
 *    取两者较小值（保守），并标注差额。
 */
import { THRESHOLDS, scoreFromFindings } from '../constants';
import type {
  DimensionResult,
  Finding,
  ScanInput,
  SellPressureBucket,
  SellPressureInfo,
  SellPressureInput,
  SellPressureWallet,
  Severity,
} from '../types';

interface WalletAgg {
  address: string;
  boughtTokens: number;
  boughtSol: number;
  soldTokens: number;
  soldSol: number;
  /** 窗口内最近一笔成交时间 */
  lastTs?: number;
  firstTs?: number;
}

/**
 * 从逐笔成交聚合出每个钱包的成本与卖出情况。
 *
 * ⚠️ 只用「方向与数量都自洽」的成交：买单必须是付出 SOL 收到代币，
 * 卖单反之。不自洽的配对（DEX 内部中转、代币数量为 0）直接丢弃，
 * 宁可少算也不能把成本算错一个数量级。
 */
export function aggregateCostBasis(
  trades: {
    trader: string;
    side: 'buy' | 'sell';
    sol: number;
    tokenAmount: number;
    ts?: number;
    mintLike?: true;
  }[],
): { wallets: Map<string, WalletAgg>; paired: number; minted: Map<string, number> } {
  const wallets = new Map<string, WalletAgg>();
  const minted = new Map<string, number>();
  let paired = 0;
  for (const t of trades) {
    if (!(t.sol > 0) || !(t.tokenAmount > 0)) continue;
    // 铸造/创建拿到的代币：没有买入价，单独记账，不能混进成本加权。
    // 混进去会得到 1e-7 级别的假成本（实测报出「浮盈 +54771%」）。
    if (t.mintLike) {
      if (t.side === 'buy') minted.set(t.trader, (minted.get(t.trader) ?? 0) + t.tokenAmount);
      else minted.set(t.trader, (minted.get(t.trader) ?? 0) - t.tokenAmount);
      continue;
    }
    const w =
      wallets.get(t.trader) ??
      ({ address: t.trader, boughtTokens: 0, boughtSol: 0, soldTokens: 0, soldSol: 0 } as WalletAgg);
    if (t.side === 'buy') {
      w.boughtTokens += t.tokenAmount;
      w.boughtSol += t.sol;
    } else {
      w.soldTokens += t.tokenAmount;
      w.soldSol += t.sol;
    }
    if (t.ts !== undefined) {
      if (w.lastTs === undefined || t.ts > w.lastTs) w.lastTs = t.ts;
      if (w.firstTs === undefined || t.ts < w.firstTs) w.firstTs = t.ts;
    }
    wallets.set(t.trader, w);
    paired += 1;
  }
  return { wallets, paired, minted };
}

/** 从最近一笔可配对成交反推隐含现价（SOL/枚） */
function impliedPrice(
  trades: { side: 'buy' | 'sell'; sol: number; tokenAmount: number; ts?: number }[],
): { price?: number; priceTs?: number } {
  let best: { ts: number; price: number } | undefined;
  for (const t of trades) {
    if (!(t.sol > 0) || !(t.tokenAmount > 0) || t.ts === undefined) continue;
    if (!best || t.ts > best.ts) best = { ts: t.ts, price: t.sol / t.tokenAmount };
  }
  return best ? { price: best.price, priceTs: best.ts } : {};
}

/**
 * 现价不可靠时的替代分桶：按成本价的对数区间分布未卖筹码。
 *
 * 不涉及盈亏，只回答「这些还没卖的筹码是在什么价位买的」——
 * 在现价拿不到时这仍然是有用的信息（能看出筹码集中在高位还是低位）。
 */
function buildCostBuckets(rows: SellPressureWallet[]): SellPressureBucket[] {
  const priced = rows.filter((r) => r.avgCostSol > 0);
  if (priced.length === 0) return [];
  const costs = priced.map((r) => r.avgCostSol).sort((a, b) => a - b);
  const lo = costs[0];
  const hi = costs[costs.length - 1];
  const total = priced.reduce((s, r) => s + r.unsoldTokens, 0);
  const N = 5;
  const ratio = hi > lo ? Math.pow(hi / lo, 1 / N) : 1;
  const out: SellPressureBucket[] = [];
  for (let i = 0; i < N; i++) {
    const min = lo * Math.pow(ratio, i);
    const max = i === N - 1 ? Number.POSITIVE_INFINITY : lo * Math.pow(ratio, i + 1);
    const inB = priced.filter((r) => r.avgCostSol >= min && r.avgCostSol < max);
    out.push({
      label: `${min.toExponential(2)} – ${i === N - 1 ? hi.toExponential(2) : max.toExponential(2)} SOL/枚`,
      minPnlPct: min,
      ...(Number.isFinite(max) ? { maxPnlPct: max } : {}),
      unsoldTokens: inB.reduce((s, r) => s + r.unsoldTokens, 0),
      pctOfCirculating: total > 0 ? (inB.reduce((s, r) => s + r.unsoldTokens, 0) / total) * 100 : 0,
      wallets: inB.length,
      costSol: inB.reduce((s, r) => s + r.costSol, 0),
    });
  }
  return out.filter((b) => b.wallets > 0);
}

/**
 * 合并窗口成交与深度成交。
 *
 * ⚠️ 同一个地址**优先用深度数据**（完整历史），并且把该地址的窗口成交剔除 ——
 * 混在一起会把「同一时期的买入」重复计入，加权后的成本没有意义。
 */
export function mergeTradeSources(
  windowTrades: SellPressureInput['trades'],
  deepTrades: SellPressureInput['deepTrades'],
): { trades: SellPressureInput['trades']; deepAddresses: Set<string> } {
  const deepAddresses = new Set<string>();
  const deep: SellPressureInput['trades'] = [];
  for (const t of deepTrades ?? []) {
    deepAddresses.add(t.trader);
    deep.push(t);
  }
  const fromWindow = windowTrades.filter((t) => !deepAddresses.has(t.trader));
  return { trades: [...deep, ...fromWindow], deepAddresses };
}

export function analyzeSellPressure(data: ScanInput): DimensionResult {
  const t = THRESHOLDS.sellPressure;
  const findings: Finding[] = [];
  /**
   * 结论只带 id + 参数，文案由渲染层按语言决定。
   * `title`/`detail` 是过渡期的中文回退，迁完后删除。
   */
  const add = (
    severity: Severity,
    id: string,
    zhTitle: string,
    zhDetail: string,
    params?: Record<string, string | number>,
  ) => findings.push({ severity, id, ...(params ? { params } : {}), title: zhTitle, detail: zhDetail });

  const sp = data.sellPressure;
  if (!sp || sp.trades.length === 0) {
    add(
      'medium',
      'sellPressure.noData',
      '抛压分布无法计算',
      '没有取到可配对的逐笔成交（需要同时拿到某地址的 SOL 净变化与它的代币净变化），' +
        '因此算不出持仓成本。这不是「没有抛压」，是这一项没数据。',
    );
    return {
      dimension: 'sellPressure',
      label: '抛压分布',
      score: 0,
      vetoed: false,
      findings,
      metrics: { available: 0 },
    };
  }

  // 深度数据（完整历史）优先；被它覆盖的地址不再用窗口估算，避免重复计数
  const merged = mergeTradeSources(sp.trades, sp.deepTrades);
  const { wallets, paired, minted } = aggregateCostBasis(merged.trades);
  const deepAddresses = merged.deepAddresses;
  // ⚠️ 分母必须是**窗口内全部成交**（含配对失败的）。曾经用 sp.trades.length
  // 当分母 —— 但那个数组本身已经过滤过，算出来永远是 100%，
  // 于是「只有一小部分筹码能分析」这个最关键的警告永远不会出现。
  // ⚠️ 「成交配对率」只在**纯窗口口径**下有意义：它的分子分母都是窗口成交。
  // 深度模式下多数地址用的是完整历史（根本不经窗口配对），这个比例会失去意义 ——
  // 曾经因为分子含深度成交、分母仍是窗口笔数，报出过 3344%。
  // 所以深度模式下不再给这个数字（返回 undefined），改用「深度覆盖地址数」表达数据完整度。
  const deepCoverage = deepAddresses.size > 0;
  const windowOnlyTrades = merged.trades.filter((t) => !deepAddresses.has(t.trader)).length;
  // 分母 = 窗口内**全部**成交（含配对失败的，见 windowTrades 的定义）；
  // 分子 = 真正能配出成本的笔数。深度模式下不给这个数（分母不再是同一批数据）。
  const attributionPct: number | undefined = deepCoverage
    ? undefined
    : sp.windowTrades > 0
      ? Math.min(100, (windowOnlyTrades / sp.windowTrades) * 100)
      : 0;
  const deepWallets = [...deepAddresses].length;
  // ⚠️ 必须用**合并后**的成交反推现价：深度数据里往往有更新的成交，
  // 只用窗口成交会拿到一个陈旧的价格（实测因此把现价算错 10 倍，
  // 进而把浮亏的钱包报成浮盈）。
  const { price, priceTs } = impliedPrice(merged.trades);
  const priceAgeSec = priceTs !== undefined ? sp.nowSec - priceTs : undefined;

  // 现价太旧或算不出来：不给盈亏结论，只给成本分布
  const priceStale =
    price === undefined ||
    (priceAgeSec !== undefined && Math.abs(priceAgeSec) > t.maxPriceAgeSec);
  const priceForPnl = price !== undefined && !priceStale ? price : undefined;

  const circulatingTokens = sp.circulatingTokens;
  const rows: SellPressureWallet[] = [];
  let exited = 0;
  let distributing = 0;

  for (const w of wallets.values()) {
    if (w.boughtTokens <= 0) continue;
    const avgCost = w.boughtSol / w.boughtTokens;
    const soldPct = Math.min(100, (w.soldTokens / w.boughtTokens) * 100);
    // 按剩余持仓折算：只有还没卖的部分才构成抛压
    const unsoldFromWindow = Math.max(0, w.boughtTokens - w.soldTokens);
    const balance = sp.holderBalances?.get(w.address);
    // 窗口没覆盖的卖出看不到 → 未卖量可能高估。有实际余额时取较小值（保守）。
    const unsold = balance !== undefined ? Math.min(unsoldFromWindow, balance) : unsoldFromWindow;

    if (soldPct >= t.exitedSoldPct) {
      exited += 1;
      continue; // 已经走了，不构成抛压
    }
    if (soldPct >= t.distributingSoldPct) distributing += 1;
    if (unsold <= 0) continue;

    const pnlPct = priceForPnl !== undefined ? ((priceForPnl - avgCost) / avgCost) * 100 : 0;
    rows.push({
      address: w.address,
      avgCostSol: avgCost,
      pnlPct,
      boughtTokens: w.boughtTokens,
      soldTokens: w.soldTokens,
      soldPct,
      unsoldTokens: unsold,
      ...(balance !== undefined ? { currentBalance: balance } : {}),
      costSol: w.boughtSol,
      ...(w.lastTs !== undefined ? { lastTs: w.lastTs } : {}),
      ...(sp.kinds?.get(w.address) ? { kind: sp.kinds.get(w.address) } : {}),
      ...(deepAddresses.has(w.address) ? { source: 'deep' as const } : { source: 'window' as const }),
    });
  }

  // 分桶：按盈亏区间。
  // ⚠️ 现价不可靠时这一栏是空的（未知不能硬凑），但下面仍会给「按成本价分桶」的
  // 替代视图，否则整个维度在有数据的情况下也会显示成一片空白。
  const buckets: SellPressureBucket[] = t.pnlBuckets.map((def) => {
    const inB = rows.filter((r) => {
      if (priceForPnl === undefined) return false;
      return r.pnlPct >= def.min && r.pnlPct < def.max;
    });
    return {
      label: def.label,
      ...(Number.isFinite(def.min) ? { minPnlPct: def.min } : {}),
      ...(Number.isFinite(def.max) ? { maxPnlPct: def.max } : {}),
      unsoldTokens: inB.reduce((s, r) => s + r.unsoldTokens, 0),
      pctOfCirculating:
        circulatingTokens > 0
          ? (inB.reduce((s, r) => s + r.unsoldTokens, 0) / circulatingTokens) * 100
          : 0,
      wallets: inB.length,
      costSol: inB.reduce((s, r) => s + r.costSol, 0),
    };
  });

  const totalUnsold = rows.reduce((s, r) => s + r.unsoldTokens, 0);
  const totalCostSol = rows.reduce((s, r) => s + r.costSol, 0);
  const unsoldPctOfCirculating =
    circulatingTokens > 0 ? (totalUnsold / circulatingTokens) * 100 : 0;
  const inProfit = rows.filter((r) => r.pnlPct > 0);

  // ── 结论 ────────────────────────────────────────────────────────
  if (attributionPct !== undefined && attributionPct < t.minAttributionPct) {
    add(
      'medium',
      'sellPressure.lowAttribution',
      `只有 ${attributionPct.toFixed(0)}% 的成交能配对出成本`,
      `窗口内 ${sp.trades.length} 笔成交里只有 ${paired} 笔能同时拿到 SOL 与代币的净变化，` +
        '其余交易的代币变动记在别的账户上（中转/聚合器），无法归因到具体买家。' +
        '因此下面的分布**只覆盖一小部分筹码**，不能当作全貌。',
      { attributionPct: attributionPct.toFixed(0), windowTrades: sp.trades.length, paired },
    );
  }

  if (priceStale) {
    // 「算不出价格」与「价格太旧」是两种完全不同的说明 → 拆 id
    if (price === undefined) {
      add('medium', 'sellPressure.priceUnavailable', '隐含现价不可靠，盈亏一栏已停用', '窗口内没有可反推价格的成交。');
    } else {
      add(
        'medium',
        'sellPressure.priceTooOld',
        '隐含现价不可靠，盈亏一栏已停用',
        `窗口内最近一笔成交距现在 ${Math.round(Math.abs(priceAgeSec ?? 0) / 3600)} 小时，` +
          `超过 ${Math.round(t.maxPriceAgeSec / 3600)} 小时的时效上限，那个价格已不能代表现价。`,
        {
          ageHours: Math.round(Math.abs(priceAgeSec ?? 0) / 3600),
          maxAgeHours: Math.round(t.maxPriceAgeSec / 3600),
        },
      );
    }
  } else if (rows.length > 0) {
    const biggest = [...rows].sort((a, b) => b.unsoldTokens * (b.pnlPct > 0 ? 1 : 0) - a.unsoldTokens * (a.pnlPct > 0 ? 1 : 0))[0];
    const backToEven = buckets.find((b) => b.label.includes('回本区'));
    // ⚠️ 尾部有两段独立的可选句子（回本区 / 浮盈最大）。按规则只拆最关键的
    // 「回本区有货」这一处（它带明确的行为结论），「浮盈最大」保持拼接。
    const hasBackToEven = !!(backToEven && backToEven.wallets > 0);
    const hasBiggest = !!(biggest && biggest.pnlPct > 100);
    const unsoldParams = {
      unsoldPctOfCirculating: unsoldPctOfCirculating.toFixed(1),
      walletCount: rows.length,
      totalCostSol: totalCostSol.toFixed(2),
      inProfitCount: inProfit.length,
      ...(hasBackToEven
        ? {
            backToEvenWallets: backToEven!.wallets,
            backToEvenPct: backToEven!.pctOfCirculating.toFixed(2),
          }
        : {}),
      ...(hasBiggest
        ? {
            biggestAddress: biggest!.address.slice(0, 8),
            biggestPnlPct: biggest!.pnlPct.toFixed(0),
            biggestUnsold: biggest!.unsoldTokens.toFixed(0),
          }
        : {}),
    };
    const biggestTail = hasBiggest
      ? `浮盈最大且仍有筹码的是 ${biggest!.address.slice(0, 8)}…（+${biggest!.pnlPct.toFixed(0)}%，还有 ${biggest!.unsoldTokens.toFixed(0)} 枚没卖）。`
      : '';
    const unsoldTail = '⚠️ 这是**窗口内能配对出来的那部分**筹码，不是全部持仓。';
    if (hasBackToEven) {
      add(
        'low',
        'sellPressure.unsoldSummaryBackToEven',
        `未卖筹码 ${unsoldPctOfCirculating.toFixed(1)}% 流通盘（可分析部分）`,
        `${rows.length} 个钱包的未卖筹码按成本折算共 ${totalCostSol.toFixed(2)} SOL；` +
          `其中 ${inProfit.length} 个处于浮盈。` +
          `回本区（-10%~+10%）里有 ${backToEven!.wallets} 个钱包、合计 ${backToEven!.pctOfCirculating.toFixed(2)}% 流通盘 —— ` +
          '这个区间最容易触发卖出。' +
          biggestTail +
          unsoldTail,
        unsoldParams,
      );
    } else {
      add(
        'low',
        'sellPressure.unsoldSummary',
        `未卖筹码 ${unsoldPctOfCirculating.toFixed(1)}% 流通盘（可分析部分）`,
        `${rows.length} 个钱包的未卖筹码按成本折算共 ${totalCostSol.toFixed(2)} SOL；` +
          `其中 ${inProfit.length} 个处于浮盈。` +
          biggestTail +
          unsoldTail,
        unsoldParams,
      );
    }
  }

  // 免费拿到筹码的地址：单列说明，不混进「浮盈 +54771%」这类结论
  const mintedWallets = [...minted.entries()].filter(([, v]) => v > 0);
  const mintedUnsoldTokens = mintedWallets.reduce((s, [, v]) => s + v, 0);
  if (mintedWallets.length > 0) {
    add(
      'low',
      'sellPressure.mintedWallets',
      `${mintedWallets.length} 个地址的筹码是铸造/创建获得的（无买入价）`,
      `这些地址通过创建/铸造交易拿到约 ${mintedUnsoldTokens.toFixed(0)} 枚代币，` +
        '只付了网络手续费 —— 它们**没有买入成本**，因此不计入盈亏分桶' +
        '（把手续费当成本会算出「浮盈几十万%」这种假数字）。' +
        '这类筹码的抛压只能用「占比」衡量：它们在任何价位卖出都是纯利润。',
      { count: mintedWallets.length, tokens: mintedUnsoldTokens.toFixed(0) },
    );
  }

  if (deepWallets > 0) {
    add(
      'good',
      'sellPressure.deepCoverage',
      `${deepWallets} 个钱包的成本来自完整历史（不是窗口估算）`,
      `深度模式逐地址拉取了前 ${sp.deepAddresses ?? deepWallets} 名持有人的全部历史成交，` +
        `其中 ${deepWallets} 个能算出**真实成本**与**真实已卖比例**。` +
        '这些地址不受「成交窗口中段有缺口」影响 —— 它们的卖出记录是完整的，' +
        '因此表里标「完整历史」的行可信度明显高于「窗口估算」的行。',
      { deepWallets, deepAddresses: sp.deepAddresses ?? deepWallets },
    );
  }

  if (exited > 0) {
    // 「另有 N 个正在派发中」是一整句独立说明 → 拆 id
    const exitedParams = {
      exited,
      exitedSoldPct: t.exitedSoldPct,
      ...(distributing > 0
        ? { distributing, distributingSoldPct: t.distributingSoldPct }
        : {}),
    };
    if (distributing > 0) {
      add(
        'good',
        'sellPressure.exitedWithDistributing',
        `${exited} 个钱包已基本卖光`,
        `窗口内这些地址卖出 ≥ ${t.exitedSoldPct}% 的买入量，因此**不再计入抛压** —— ` +
          '不管它们当初赚了多少（赚了但已经跑了的筹码不会再来砸盘）。' +
          `另有 ${distributing} 个正在派发中（卖出 ${t.distributingSoldPct}%–${t.exitedSoldPct}%），只按剩余部分计入。`,
        exitedParams,
      );
    } else {
      add(
        'good',
        'sellPressure.exited',
        `${exited} 个钱包已基本卖光`,
        `窗口内这些地址卖出 ≥ ${t.exitedSoldPct}% 的买入量，因此**不再计入抛压** —— ` +
          '不管它们当初赚了多少（赚了但已经跑了的筹码不会再来砸盘）。',
        exitedParams,
      );
    }
  }

  // 现价不可靠时的替代视图：直接按**成本价相对区间**分布，不涉及盈亏。
  // 这仍然能回答「筹码集中在什么价位」——只是不能换算成「谁在赚谁在亏」。
  const costBuckets: SellPressureBucket[] =
    priceForPnl === undefined && rows.length > 0
      ? buildCostBuckets(rows)
      : [];

  const info: SellPressureInfo = {
    deepWallets,
    deepAddresses: sp.deepAddresses ?? 0,
    ...(priceForPnl !== undefined ? { priceSol: priceForPnl } : {}),
    ...(costBuckets.length > 0 ? { costBuckets, priceNote: '现价不可靠，改按成本价区间分布' } : {}),
    walletsAnalyzed: rows.length,
    ...(attributionPct !== undefined
      ? { attributionPct: Math.round(attributionPct * 10) / 10 }
      : {}),
    totalUnsoldTokens: totalUnsold,
    totalCostSol,
    unsoldPctOfCirculating,
    buckets,
    topHoldersAtProfit: [...rows]
      .filter((r) => r.pnlPct > 0)
      .sort((a, b) => b.unsoldTokens - a.unsoldTokens)
      .slice(0, t.maxWalletRows),
    exitedWallets: exited,
    distributingWallets: distributing,
    mintedWallets: mintedWallets.length,
    mintedUnsoldTokens,
    windowNote:
      `${deepWallets > 0 ? `${deepWallets} 个地址用逐地址**完整历史**算成本（真实值），其余` : ''}` +
      `用成交窗口内能配对的 ${paired} 笔成交估算（窗口共 ${sp.trades.length} 笔）；` +
      '已卖光的钱包不计入抛压；窗口估算的未卖量与实际余额不一致时取较小值。',
  };

  return {
    dimension: 'sellPressure',
    label: '抛压分布',
    score: scoreFromFindings(findings),
    vetoed: false,
    findings,
    metrics: { ...info, available: 1 },
  };
}
