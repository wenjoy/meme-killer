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
import type { DimensionResult, Finding, ScanInput, Severity } from '../types';

export function analyzeLiquidity(data: ScanInput): DimensionResult {
  const l = data.liquidity ?? {};
  const t = THRESHOLDS.liquidity;
  const findings: Finding[] = [];
  let vetoed = false;

  const veto = (title: string, detail: string) => {
    vetoed = true;
    findings.push({ severity: 'critical', title, detail, veto: true });
  };
  const add = (severity: Severity, title: string, detail: string) =>
    findings.push({ severity, title, detail });

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
      'curve 内真实 SOL 极低',
      `仅 ${l.realSolReserves.toFixed(2)} SOL，价格极易被小额资金砸穿，滑点会非常高。`,
    );
  }

  if (phaseKnown && !graduated) {
    add(
      'medium',
      '尚未毕业（仍在 bonding curve）',
      `curve 内真实 SOL ${l.realSolReserves !== undefined ? l.realSolReserves.toFixed(2) : '未知'}。` +
        '此阶段没有真实流动性池，只有曲线深度。',
    );
  } else if (graduated) {
    add('good', '已毕业', '已迁移至 AMM，具备真实流动性池。');
  }

  // ── 买卖压力（双指标，避免刷量误判）─────────────────────────────
  // 金额口径：优先 SOL（逐笔成交），没有才退回 USD（推算），且只做占比判定
  const volUnit: 'SOL' | 'USD' | 'none' = solKnown ? 'SOL' : usdKnown ? 'USD' : 'none';
  const buyVol = solKnown ? buyVolSol ?? 0 : usdKnown ? buyVolUsd ?? 0 : 0;
  const sellVol = solKnown ? sellVolSol ?? 0 : usdKnown ? sellVolUsd ?? 0 : 0;
  const totalVol = buyVol + sellVol;
  // 净流入是 SOL 口径的概念：USD 推算值喂进来会得到一个假数字
  const netInflow = solKnown ? (buyVolSol ?? 0) - (sellVolSol ?? 0) : undefined;

  if (totalVol > 0) {
    const sellShare = (sellVol / totalVol) * 100;
    const countShare = totalCount > 0 ? (sellCount / totalCount) * 100 : 100;

    // ⚠️ 蜜罐特征：买盘一边倒，但**卖单笔数**极少。
    // 这看起来像「买盘主导」（利好），实际是「根本卖不出去」。
    // 正常强势项目的卖单笔数也会占 20–40%，不会低于 5%。
    const oneSided = sellShare < 10 && totalCount > 100 && countShare < 5;
    if (oneSided) {
      veto(
        '买入活跃但几乎无法卖出',
        `${totalCount} 笔成交中卖单仅 ${sellCount} 笔（${countShare.toFixed(1)}%）。` +
          '买单一边倒通常不是强势，而是卖出被限制 —— 典型的蜜罐（honeypot）特征。',
      );
    } else if (sellShare > t.sellPressureDanger) {
      add(
        sellShare > 75 ? 'critical' : 'high',
        '抛压主导',
        `卖方金额占比 ${sellShare.toFixed(1)}%` +
          (netInflow !== undefined
            ? `，净流入 ${netInflow.toFixed(2)} SOL。`
            : `（金额为 ${volUnit} 口径，无法换算净流入）。`),
      );
    } else if (netInflow !== undefined && netInflow > 0 && countShare >= 5) {
      add(
        'good',
        '买卖均衡且净流入为正',
        `卖方金额占比 ${sellShare.toFixed(1)}%，净流入 +${netInflow.toFixed(2)} SOL，买盘略强且卖压正常，换手健康。`,
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
        '疑似刷量',
        `${totalCount} 笔成交、成交额 ${totalVol.toFixed(1)} SOL，净流入仅 ${netInflow.toFixed(3)} SOL` +
          `（占成交额 ${(netRatio * 100).toFixed(1)}%），高笔数几乎零净流入通常是机器人对倒制造热度。`,
      );
    }
  } else if (totalCount > 50) {
    add(
      'low',
      '刷量无法判定',
      `拿到了 ${totalCount} 笔成交，但拿不到 SOL 口径的买卖金额（需要 Helius Enhanced API），` +
        '无法用净流入识别对倒刷量，只能看笔数。',
    );
  }

  // 笔数比与金额比背离：笔数很强，金额却在流出（比例判定，与单位无关）
  if (sellCount > 0 && totalVol > 0) {
    const countRatio = buyCount / sellCount;
    const volRatio = buyVol / Math.max(sellVol, 1e-9);
    if (countRatio > 2 && volRatio < 1) {
      add(
        'high',
        '笔数与金额背离',
        `买单笔数是卖单 ${countRatio.toFixed(1)} 倍，但买入金额只有卖出的 ${(volRatio * 100).toFixed(0)}%。` +
          '小额买盘撑笔数、大额卖盘出货。',
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
      ...(sniperPct !== undefined ? { sniperHoldPct: sniperPct } : {}),
      ...(l.holderCount !== undefined ? { holderCount: l.holderCount } : {}),
      ...(l.liquidityUsd !== undefined ? { liquidityUsd: l.liquidityUsd } : {}),
      volumeUnit: volUnit,
    },
  };
}
