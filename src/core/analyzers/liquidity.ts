/**
 * 维度 2：流动性 & 资金流
 *
 * 关键认知：
 * - 毕业前没有真实 LP，「流动性」= bonding curve 账户里的**真实 SOL**。
 *   表面市值是小额资金推动的，滑点估算绝不能按市值算。
 * - 抽池判定：curve 未完成却 SOL 大幅下降 —— 快照差分比单点可靠。
 * - 刷量识别：买卖**笔数**高但**净 SOL 流入 ≈ 0**。必须双指标，不能只看笔数。
 * - 狙击识别要排除 creator 自买与官方路由，否则毕业瞬间的脏数据会误报。
 */
import { THRESHOLDS, scoreFromFindings } from '../constants';
import type { DimensionResult, Finding, ScanInput, Severity } from '../types';

export function analyzeLiquidity(data: ScanInput): DimensionResult {
  const l = data.liquidity ?? {};
  const dev = data.developer ?? {};
  const t = THRESHOLDS.liquidity;
  const findings: Finding[] = [];
  let vetoed = false;

  const veto = (title: string, detail: string) => {
    vetoed = true;
    findings.push({ severity: 'critical', title, detail, veto: true });
  };
  const add = (severity: Severity, title: string, detail: string) =>
    findings.push({ severity, title, detail });

  // 流动性数据整段缺失：成交量、深度、买卖笔数全都拿不到。
  // 此时**不能**按「未毕业 + 储备为 0」去算 —— 那会凭空生成一个高风险结论。
  if (data.liquidity == null) {
    return {
      dimension: 'liquidity',
      label: '流动性 & 资金流',
      score: 0,
      vetoed: false,
      findings: [
        {
          severity: 'medium',
          title: '流动性数据缺失',
          detail: '未能获取池深度、成交量与买卖笔数，无法判断抽池、刷量与蜜罐风险。此项不计入评分，请自行在 DexScreener 上核实。',
        },
      ],
      metrics: { available: 0 },
    };
  }

  const graduated = l.graduated ?? l.complete ?? false;

  // ── 抽池检测 ────────────────────────────────────────────────────
  if (l.liquidityPulled) {
    veto('流动性已被抽走', '检测到池内资金被移出，这是典型的 rug pull 特征。');
  }
  if (dev.pulledLiquidity) {
    veto('部署者抽走流动性', 'creator 地址发起了撤池操作。');
  }
  // 只有在**确实读到**储备数值时才判断深度；undefined 是未知，不是 0
  if (!graduated && l.realSolReserves !== undefined && l.realSolReserves < t.minRealSolReserves) {
    add(
      'high',
      'curve 内真实 SOL 极低',
      `仅 ${(l.realSolReserves ?? 0).toFixed(2)} SOL，价格极易被小额资金砸穿，滑点会非常高。`,
    );
  }

  // ── 阶段与深度 ──────────────────────────────────────────────────
  // graduated 只在明确读到时才下结论：undefined 表示「不知道是否已毕业」，
  // 把它当作「未毕业」会凭空造出一条风险提示。
  const phaseKnown = l.graduated !== undefined || l.complete !== undefined;
  if (phaseKnown && !graduated) {
    add(
      'medium',
      '尚未毕业（仍在 bonding curve）',
      `curve 内真实 SOL ${l.realSolReserves !== undefined ? l.realSolReserves.toFixed(2) : '未知'}，` +
        `毕业阈值约 ${l.graduationTargetSol ?? '未知'} SOL。此阶段没有真实流动性池，只有曲线深度。`,
    );
  } else if (graduated) {
    add('good', '已毕业', '已迁移至 AMM，具备真实流动性池。');
    if (l.lpLockedOrBurned === false) {
      add('high', '毕业但 LP 未见锁定', '迁移后的 LP 若未锁定或销毁，仍可被撤回。');
    } else if (l.lpLockedOrBurned === undefined) {
      add('medium', 'LP 锁定状态未知', '未能确认迁移后的 LP 是否已锁定或销毁，存在撤池风险。');
    }
  }

  // ── 买卖压力（双指标，避免刷量误判）─────────────────────────────
  const buyVol = l.buyVolumeSol ?? 0;
  const sellVol = l.sellVolumeSol ?? 0;
  const totalVol = buyVol + sellVol;
  const buyCount = l.buyCount ?? 0;
  const sellCount = l.sellCount ?? 0;
  const totalCount = buyCount + sellCount;
  const netInflow = buyVol - sellVol;

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
        `卖方金额占比 ${sellShare.toFixed(1)}%，净流入 ${netInflow.toFixed(2)} SOL。`,
      );
    } else if (netInflow > 0 && countShare >= 5) {
      add(
        'good',
        '买卖均衡且净流入为正',
        `卖方金额占比 ${sellShare.toFixed(1)}%，净流入 +${netInflow.toFixed(2)} SOL，买盘略强且卖压正常，换手健康。`,
      );
    }
  }

  // 刷量：笔数活跃但净流入趋近于零
  if (totalCount > 50 && Math.abs(netInflow) < t.washTradeNetInflowSol) {
    add(
      'high',
      '疑似刷量',
      `${totalCount} 笔成交但净 SOL 流入仅 ${netInflow.toFixed(3)}，高笔数低净流入通常是机器人对倒制造热度。`,
    );
  }

  // 笔数比与金额比背离：笔数很强，金额却在流出
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

  // ── 狙击机器人 ──────────────────────────────────────────────────
  const sniperPct = l.sniperHoldPct ?? 0;
  if (sniperPct > t.sniperWalletDanger) {
    add(
      sniperPct > 45 ? 'high' : 'medium',
      '狙击机器人持仓偏高',
      `首区块买入的钱包合计持有 ${sniperPct.toFixed(1)}%，这些筹码随时可能砸盘。（已排除 creator 自买与官方路由）`,
    );
  }

  // ── 持有人增长 ──────────────────────────────────────────────────
  if ((l.holderGrowth24h ?? 0) < 0) {
    add('medium', '持有人数下降', '24h 内持有人数减少，说明有人在离场。');
  }

  return {
    dimension: 'liquidity',
    label: '流动性 & 资金流',
    score: vetoed ? 100 : scoreFromFindings(findings),
    vetoed,
    findings,
    metrics: {
      realSolReserves: l.realSolReserves ?? 0,
      graduated: graduated ? 1 : 0,
      sellSharePct: totalVol > 0 ? (sellVol / totalVol) * 100 : 0,
      netInflowSol: netInflow,
      totalTrades: totalCount,
      sniperHoldPct: sniperPct,
      holderCount: l.holderCount ?? 0,
      liquidityUsd: l.liquidityUsd ?? 0,
    },
  };
}
