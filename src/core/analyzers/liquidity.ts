/**
 * 维度 2：流动性 & 资金流
 *
 * 关键认知：
 * - 毕业前没有真实 LP，「流动性」= bonding curve 账户里的**真实 SOL**，
 *   这个值直接读 curve 账户余额（providers/helius.ts），不再靠猜。
 * - **单位纪律**（本文件最容易写错的地方）：
 *   `buyVolumeSol`/`sellVolumeSol` 只可能是 Helius 逐笔成交（真的是 SOL）；
 *   `buyVolumeUsd`/`sellVolumeUsd` 是 DexScreener 按笔数占比推算的 USD。
 *   净流入、刷量阈值都是 SOL 口径 —— 拿 USD 去算会让净流入虚高上百倍、
 *   让刷量判定永远不触发。没有 SOL 口径时只保留与单位无关的占比判定。
 * - 刷量识别：买卖**笔数**高但**净 SOL 流入 ≈ 0**。必须双指标，不能只看笔数。
 * - 狙击识别要排除 creator 自买，并且只覆盖「仍在前 20 大持仓里」的部分（下限）。
 * - LP 锁定/销毁**不在这里判**：那是合约安全维度的 `contract.lp`。
 *   同一个事实在两个维度各判一次会重复计分（这里曾有一份永远拿不到值的副本）。
 */
import { THRESHOLDS, scoreFromFindings } from '../constants';
import type {
  DimensionResult,
  Finding,
  LargeSellEvidence,
  RawHolder,
  ScanInput,
  Severity,
} from '../types';

/** 截断长 base58（地址/签名）：只用于展示，完整值在明细里 */
function short(v: string, head = 4, tail = 4): string {
  return v.length > head + tail + 1 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}

/** Unix 秒 → `MM-DD HH:mm UTC`（链上核对时用它对齐 Solscan 显示的时间） */
function utcTime(ts?: number): string {
  if (ts === undefined) return '时间未知';
  return `${new Date(ts * 1000).toISOString().slice(5, 16).replace('T', ' ')} UTC`;
}

export function analyzeLiquidity(data: ScanInput): DimensionResult {
  const l = data.liquidity ?? {};
  const t = THRESHOLDS.liquidity;
  const findings: Finding[] = [];
  let vetoed = false;

  /**
   * 结论只带 id + 参数，文案由渲染层按语言决定。
   * `zhTitle`/`zhDetail` 是过渡期的中文回退，迁完后删除。
   *
   * 参数顺序与 social.ts 保持一致：severity, id, 中文回退, params。
   */
  const add = (
    severity: Severity,
    id: string,
    zhTitle: string,
    zhDetail: string,
    params?: Record<string, string | number>,
  ) => findings.push({ severity, id, ...(params ? { params } : {}), title: zhTitle, detail: zhDetail });
  /** 硬否决：同样是 id + params，额外带 `veto: true` */
  const veto = (
    id: string,
    zhTitle: string,
    zhDetail: string,
    params?: Record<string, string | number>,
  ) => {
    vetoed = true;
    findings.push({
      severity: 'critical',
      id,
      ...(params ? { params } : {}),
      title: zhTitle,
      detail: zhDetail,
      veto: true,
    });
  };

  const buyVolSol = l.buyVolumeSol;
  const sellVolSol = l.sellVolumeSol;
  const solKnown = buyVolSol !== undefined || sellVolSol !== undefined;
  const buyVolUsd = l.buyVolumeUsd;
  const sellVolUsd = l.sellVolumeUsd;
  const usdKnown = buyVolUsd !== undefined || sellVolUsd !== undefined;
  const buyCount = l.buyCount ?? 0;
  const sellCount = l.sellCount ?? 0;
  const totalCount = buyCount + sellCount;

  // 只有「真的有流动性/成交数据」才算本维度可评。
  // 只拿到 holderCount 这类附加字段不算 —— 否则「什么都不知道」会被渲染成
  // 「0 分 = 没发现问题」，这是最危险的一种误导。
  const flowKnown =
    solKnown ||
    usdKnown ||
    totalCount > 0 ||
    l.realSolReserves !== undefined ||
    l.graduated !== undefined ||
    l.complete !== undefined;
  if (!flowKnown) {
    return {
      dimension: 'liquidity',
      label: '流动性 & 资金流',
      score: 0,
      vetoed: false,
      findings: [
        {
          severity: 'medium',
          id: 'liquidity.noData',
          title: '流动性数据缺失',
          detail:
            '未能获取池深度、成交量与买卖笔数，无法判断抽池、刷量与蜜罐风险。此项不计入评分，请自行在 DexScreener 上核实。',
        },
      ],
      metrics: {
        available: 0,
        ...(l.holderCount !== undefined ? { holderCount: l.holderCount } : {}),
      },
    };
  }

  // ── RugCheck 的 rug 判定（真实数据，不是启发式）─────────────────
  if (l.rugged) {
    add(
      'critical',
      'liquidity.rugDetected',
      'RugCheck 判定该代币已 rug',
      'RugCheck 依据链上流动性与价格历史已把该代币标记为 rug。此类标的没有讨论仓位的意义。',
    );
  }

  // ── 阶段与深度 ──────────────────────────────────────────────────
  // graduated 只在明确读到时才下结论：undefined 表示「不知道是否已毕业」，
  // 把它当作「未毕业」会凭空造出一条风险提示。
  const graduated = l.graduated ?? l.complete ?? false;
  const phaseKnown = l.graduated !== undefined || l.complete !== undefined;

  // 只有在**确实读到**储备数值时才判断深度；undefined 是未知，不是 0
  if (!graduated && l.realSolReserves !== undefined && l.realSolReserves < t.minRealSolReserves) {
    add(
      'high',
      'liquidity.lowCurveReserves',
      'curve 内真实 SOL 极低',
      `仅 ${l.realSolReserves.toFixed(2)} SOL，价格极易被小额资金砸穿，滑点会非常高。`,
      { sol: l.realSolReserves.toFixed(2) },
    );
  }

  if (phaseKnown && !graduated) {
    add(
      'medium',
      'liquidity.notGraduated',
      '尚未毕业（仍在 bonding curve）',
      `curve 内真实 SOL ${l.realSolReserves !== undefined ? l.realSolReserves.toFixed(2) : '未知'}。` +
        '此阶段没有真实流动性池，只有曲线深度。',
      { sol: l.realSolReserves !== undefined ? l.realSolReserves.toFixed(2) : '未知' },
    );
  } else if (graduated) {
    add('good', 'liquidity.graduated', '已毕业', '已迁移至 AMM，具备真实流动性池。');
  }

  // ── 买卖压力（双指标，避免刷量误判）─────────────────────────────
  // 金额口径：优先 SOL（逐笔成交），没有才退回 USD（推算），且只做占比判定
  const volUnit: 'SOL' | 'USD' | 'none' = solKnown ? 'SOL' : usdKnown ? 'USD' : 'none';
  const buyVol = solKnown ? buyVolSol ?? 0 : usdKnown ? buyVolUsd ?? 0 : 0;
  const sellVol = solKnown ? sellVolSol ?? 0 : usdKnown ? sellVolUsd ?? 0 : 0;
  const totalVol = buyVol + sellVol;
  // 净流入是 SOL 口径的概念：USD 推算值喂进来会得到一个假数字
  const netInflow = solKnown ? (buyVolSol ?? 0) - (sellVolSol ?? 0) : undefined;

  // ── 逐笔量级证据 ────────────────────────────────────────────────
  // 「笔数 4.6 倍、金额 81%」这种话读者没法核对。必须给出单笔量级与卖单集中度，
  // 才能看出「小额买盘撑笔数、大额卖盘出货」是真结论还是错觉。
  const audit = l.tradeSizeAudit;
  const avgBuySol = buyCount > 0 ? buyVol / buyCount : undefined;
  const avgSellSol = sellCount > 0 ? sellVol / sellCount : undefined;
  const windowText =
    audit?.windowSec === undefined
      ? ''
      : audit.windowSec >= 3600
        ? `，跨约 ${(audit.windowSec / 3600).toFixed(1)} 小时`
        : `，跨约 ${Math.max(1, Math.round(audit.windowSec / 60))} 分钟`;
  // 单位是 SOL 才谈单笔量级：USD 口径的单笔金额受价格波动影响，说不清「多大算大」
  const sizeEvidence =
    audit && avgBuySol !== undefined && avgSellSol !== undefined && volUnit === 'SOL'
      ? `样本：最近 ${audit.trades} 笔可判定方向的成交${windowText}。` +
        `买单 ${buyCount} 笔共 ${buyVol.toFixed(3)} SOL（平均 ${avgBuySol.toFixed(4)}、中位 ${audit.buyMedianSol.toFixed(4)}），` +
        `卖单 ${sellCount} 笔共 ${sellVol.toFixed(3)} SOL（平均 ${avgSellSol.toFixed(4)}、中位 ${audit.sellMedianSol.toFixed(4)}，` +
        `平均是买单的 ${(avgSellSol / Math.max(avgBuySol, 1e-9)).toFixed(1)} 倍）。` +
        (audit.sellMaxSol > 0
          ? `最大单笔卖单 ${audit.sellMaxSol.toFixed(3)} SOL` +
            (audit.largestSellSharePct !== undefined
              ? `，占卖出总额 ${audit.largestSellSharePct.toFixed(1)}%`
              : '') +
            (audit.top5SellSharePct !== undefined
              ? `；前 5 大卖单合计占 ${audit.top5SellSharePct.toFixed(1)}%`
              : '') +
            '。'
          : '')
      : '';

  if (totalVol > 0) {
    const sellShare = (sellVol / totalVol) * 100;
    const countShare = totalCount > 0 ? (sellCount / totalCount) * 100 : 100;

    // ⚠️ 蜜罐特征：买盘一边倒，但**卖单笔数**极少。
    // 这看起来像「买盘主导」（利好），实际是「根本卖不出去」。
    // 正常强势项目的卖单笔数也会占 20–40%，不会低于 5%。
    const oneSided = sellShare < 10 && totalCount > 100 && countShare < 5;
    if (oneSided) {
      veto(
        'liquidity.honeypot',
        '买入活跃但几乎无法卖出',
        `${totalCount} 笔成交中卖单仅 ${sellCount} 笔（${countShare.toFixed(1)}%）。` +
          '买单一边倒通常不是强势，而是卖出被限制 —— 典型的蜜罐（honeypot）特征。',
        { totalTrades: totalCount, sellTrades: sellCount, countSharePct: countShare.toFixed(1) },
      );
    } else if (sellShare > t.sellPressureDanger) {
      add(
        sellShare > 75 ? 'critical' : 'high',
        netInflow !== undefined ? 'liquidity.sellPressureDominant' : 'liquidity.sellPressureDominantNoSol',
        '抛压主导',
        `卖方金额占比 ${sellShare.toFixed(1)}%` +
          (netInflow !== undefined
            ? `，净流入 ${netInflow.toFixed(2)} SOL。`
            : `（金额为 ${volUnit} 口径，无法换算净流入）。`) +
          (sizeEvidence ? sizeEvidence : ''),
        {
          sellSharePct: sellShare.toFixed(1),
          ...(netInflow !== undefined
            ? { netInflowSol: netInflow.toFixed(2) }
            : { volumeUnit: volUnit }),
          ...(sizeEvidence ? { sizeEvidence } : {}),
        },
      );
    } else if (netInflow !== undefined && netInflow > 0 && countShare >= 5) {
      add(
        'good',
        'liquidity.balancedInflow',
        '买卖均衡且净流入为正',
        `卖方金额占比 ${sellShare.toFixed(1)}%，净流入 +${netInflow.toFixed(2)} SOL，买盘略强且卖压正常，换手健康。`,
        { sellSharePct: sellShare.toFixed(1), netInflowSol: netInflow.toFixed(2) },
      );
    }
  }

  // 刷量：笔数活跃但净流入趋近于零。**只有 SOL 口径能算**。
  // ⚠️ 必须同时看绝对值和相对值：只看绝对值时，成交 40 SOL、净流出 0.3 SOL
  // 的正常代币也会被扣上刷量帽子（实测真实币撞上过）。
  if (netInflow !== undefined) {
    const netRatio = totalVol > 0 ? Math.abs(netInflow) / totalVol : 1;
    if (totalCount > 50 && Math.abs(netInflow) < t.washTradeNetInflowSol && netRatio < t.washTradeNetRatio) {
      add(
        'high',
        'liquidity.washTrading',
        '疑似刷量',
        `${totalCount} 笔成交、成交额 ${totalVol.toFixed(1)} SOL，净流入仅 ${netInflow.toFixed(3)} SOL` +
          `（占成交额 ${(netRatio * 100).toFixed(1)}%），高笔数几乎零净流入通常是机器人对倒制造热度。`,
        {
          totalTrades: totalCount,
          totalVolSol: totalVol.toFixed(1),
          netInflowSol: netInflow.toFixed(3),
          netRatioPct: (netRatio * 100).toFixed(1),
        },
      );
    }
  } else if (totalCount > 50) {
    add(
      'low',
      'liquidity.washTradeUnknown',
      '刷量无法判定',
      `拿到了 ${totalCount} 笔成交，但拿不到 SOL 口径的买卖金额（需要 Helius Enhanced API），` +
        '无法用净流入识别对倒刷量，只能看笔数。',
      { totalTrades: totalCount },
    );
  }

  // 最大几笔卖单的链上凭据：签名 + 时间 + 钱包。没有这个，「最大单笔 2.028 SOL」
  // 只是个无法验证的数字；有了它，读者能点到 Solscan 看到是谁什么时候砸的。
  const topSells = volUnit === 'SOL' ? (l.largeSells ?? []) : [];
  // 身份核对：这些砸盘的钱包是不是开盘那批人？现在还拿着多少？
  // 「开盘就买的狙击手在出货」与「半路进场的持有人止盈」是两件不同的事，
  // 只报金额会把两者混为一谈。
  const holderByAddr = new Map<string, RawHolder>(
    (data.holders ?? []).map((h): [string, RawHolder] => [h.address, h]),
  );
  const enrichedSells: (LargeSellEvidence & { holderPctNow?: number; sniperNow?: boolean })[] =
    topSells.map((x) => {
    const h = x.trader ? holderByAddr.get(x.trader) : undefined;
      return {
        ...x,
        ...(h?.pct !== undefined ? { holderPctNow: h.pct } : {}),
        ...(h?.isSniper !== undefined ? { sniperNow: h.isSniper } : {}),
      };
    });
  const windowTrades = t.sniperWindowTrades;
  const identityOf = (x: (typeof enrichedSells)[number]): string =>
    x.isCreator
      ? '部署者'
      : x.earlyBuyerIndex !== undefined
        ? `开盘最早 ${windowTrades} 笔内的买家（第 ${x.earlyBuyerIndex + 1} 笔）`
        : '';
  const earlyCount = enrichedSells.filter((x) => x.earlyBuyerIndex !== undefined).length;
  const creatorCount = enrichedSells.filter((x) => x.isCreator).length;
  const stillHolding = enrichedSells.filter((x) => x.holderPctNow !== undefined);
  const identityNote =
    enrichedSells.length > 0 && l.earlyBuyerWindowKnown === false
      ? `身份核对（针对最大的 ${enrichedSells.length} 笔卖单）：` +
        '本次没取到该代币的最早成交，无法判断这些地址是不是开盘就买入的 —— ' +
        '不要把它读成「不是狙击手」。'
      : enrichedSells.length
    ? `身份核对（针对最大的 ${enrichedSells.length} 笔卖单）：` +
      (creatorCount > 0 ? `${creatorCount} 笔来自部署者；` : '') +
      (earlyCount > 0
        ? `${earlyCount} 笔来自开盘最早 ${windowTrades} 笔成交内的地址` +
          `（${enrichedSells
            .filter((x) => x.earlyBuyerIndex !== undefined || x.isCreator)
            .map((x) => `${identityOf(x)} ${x.sol.toFixed(3)} SOL`)
            .join('、')}）`
        : `没有一笔来自开盘最早 ${windowTrades} 笔成交内的地址`) +
      (stillHolding.length > 0
        ? `；其中 ${stillHolding.length} 个地址当前仍在前 20 大持仓里（最高 ${Math.max(
            ...stillHolding.map((x) => x.holderPctNow ?? 0),
          ).toFixed(2)}%）`
        : '；这些地址都已不在当前前 20 大持仓里') +
      '。⚠️ 「不在最早窗口内」只代表它不是最早那 25 笔成交的付款方，不等于确定不是早期买家。'
    : '';
  const sellEvidence = topSells.length
    ? `最大 ${topSells.length} 笔卖单（签名可在 Solscan 核对，完整明细见下方「大额卖单明细」）：` +
      topSells
        .slice(0, 3)
        .map(
          (x) =>
            `${x.sol.toFixed(3)} SOL @ ${utcTime(x.ts)}` +
            (x.trader ? `，钱包 ${short(x.trader)}` : '') +
            `，签名 ${short(x.signature, 6, 6)}`,
        )
        .join('；') +
      '。' +
      identityNote
    : '';

  // 笔数比与金额比背离：笔数很强，金额却在流出（比例判定，与单位无关）
  if (sellCount > 0 && totalVol > 0) {
    const countRatio = buyCount / sellCount;
    const volRatio = buyVol / Math.max(sellVol, 1e-9);
    if (countRatio > 2 && volRatio < 1) {
      const ratioBody =
        `买单笔数是卖单 ${countRatio.toFixed(1)} 倍，但买入金额只有卖出的 ${(volRatio * 100).toFixed(0)}%。` +
        '小额买盘撑笔数、大额卖盘出货。';
      // (c)：没有单笔证据、又不是 SOL 口径 → 正文里要补一句单位说明，单独一个 id
      const unitNote =
        !sizeEvidence && volUnit !== 'SOL'
          ? `（金额为 ${volUnit} 口径，拿不到单笔 SOL 量级，无法进一步核对。）`
          : '';
      add(
        'high',
        unitNote ? 'liquidity.countVolumeDivergenceNoSol' : 'liquidity.countVolumeDivergence',
        '笔数与金额背离',
        ratioBody + (sizeEvidence || unitNote) + sellEvidence,
        {
          countRatio: countRatio.toFixed(1),
          volRatioPct: (volRatio * 100).toFixed(0),
          ...(sizeEvidence ? { sizeEvidence } : {}),
          ...(unitNote ? { volumeUnit: volUnit } : {}),
          ...(sellEvidence ? { sellEvidence } : {}),
        },
      );
    }
  }

  // ⚠️ 狙击判定只在「持币集中度」维度做（那里能同时看到全部仓位结构）。
  // 两个维度各判一次会让同一个事实重复扣分，这里只保留指标用于展示。
  const sniperPct = l.sniperHoldPct;

  return {
    dimension: 'liquidity',
    label: '流动性 & 资金流',
    score: vetoed ? 100 : scoreFromFindings(findings),
    vetoed,
    findings,
    metrics: {
      // 三态：只有真的读到才写，绝不用 `?? 0` 造一个「确定的事实」
      ...(l.realSolReserves !== undefined ? { realSolReserves: l.realSolReserves } : {}),
      ...(phaseKnown ? { graduated: graduated ? 1 : 0 } : {}),
      ...(totalVol > 0 ? { sellSharePct: (sellVol / totalVol) * 100 } : {}),
      ...(netInflow !== undefined ? { netInflowSol: netInflow } : {}),
      ...(totalCount > 0 ? { totalTrades: totalCount } : {}),
      ...(buyCount > 0 && sellCount > 0 ? { buyTrades: buyCount, sellTrades: sellCount } : {}),
      ...(audit && avgBuySol !== undefined && avgSellSol !== undefined && volUnit === 'SOL'
        ? {
            avgBuySol: Math.round(avgBuySol * 1e6) / 1e6,
            avgSellSol: Math.round(avgSellSol * 1e6) / 1e6,
            sellMaxSol: audit.sellMaxSol,
          }
        : {}),
      ...(audit?.windowSec !== undefined
        ? { sampleWindowMin: Math.max(1, Math.round(audit.windowSec / 60)) }
        : {}),
      // 明细列表交给 UI 渲染成可点击的 Solscan 链接
      ...(enrichedSells.length > 0 ? { largeSells: enrichedSells } : {}),
      ...(enrichedSells.length > 0 && l.earlyBuyerWindowKnown !== undefined
        ? { earlyBuyerWindowKnown: l.earlyBuyerWindowKnown ? 1 : 0 }
        : {}),
      ...(sniperPct !== undefined ? { sniperHoldPct: sniperPct } : {}),
      ...(l.holderCount !== undefined ? { holderCount: l.holderCount } : {}),
      ...(l.liquidityUsd !== undefined ? { liquidityUsd: l.liquidityUsd } : {}),
      volumeUnit: volUnit,
    },
  };
}
