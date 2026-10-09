/**
 * 维度 4：开发者历史
 *
 * 关键认知：
 * - 追溯路径：mint 的 create 交易 → fee payer / signer = creator。
 * - Rug 特征：creator 多个 mint 在数小时内陆续死亡。
 * - dev sell 检测：筛 user == creator 且 isBuy == false 的成交，
 *   算 devSoldRatio = 卖出 token / 买入 token。
 *
 * ⚠️ 重要误判提醒：dev 卖出**部分**回收成本极常见，不必然是 rug。
 * 因此只有「清仓 + 时间很早」才升级为高危，单纯卖出部分只给中等分。
 */
import { THRESHOLDS, scoreFromFindings } from '../constants';
import type { DimensionResult, Finding, ScanInput, Severity } from '../types';

export function analyzeDeveloper(data: ScanInput): DimensionResult {
  const d = data.developer ?? {};
  const t = THRESHOLDS.developer;
  const findings: Finding[] = [];
  let vetoed = false;

  const veto = (title: string, detail: string) => {
    vetoed = true;
    findings.push({ severity: 'critical', title, detail, veto: true });
  };
  const add = (severity: Severity, title: string, detail: string) =>
    findings.push({ severity, title, detail });

  // developer 段为空 = 完全没采集到开发者信息（需索引器）。
  // 此时不能按「priorTokens = []」去算 —— 那会输出「无历史发币记录」这种
  // 看起来像结论、实际只是「没数据」的判断，并让覆盖率虚高。
  if (data.developer == null) {
    return {
      dimension: 'developer',
      label: '开发者历史',
      score: 0,
      vetoed: false,
      findings: [
        {
          severity: 'medium',
          title: '开发者数据缺失',
          detail:
            '未采集到部署者信息。历史 rug 记录、dev 卖出比例、关联钱包都需要索引器支持，本次无法判断 —— 请人工核查 creator 地址的历史。',
        },
      ],
      metrics: { available: 0 },
    };
  }

  const priorTokens = d.priorTokens ?? [];
  const rugCount = d.priorRugCount ?? priorTokens.filter((p) => p.rugged).length;

  // ── 历史 rug ────────────────────────────────────────────────────
  if (rugCount >= t.priorRugDanger) {
    veto(
      '部署者有多次 rug 前科',
      `该 creator 历史发行 ${priorTokens.length} 个代币，其中 ${rugCount} 个被判定为 rug pull。`,
    );
  } else if (rugCount === t.priorRugWarn) {
    add('high', '部署者有 rug 前科', `历史 ${priorTokens.length} 个代币中有 ${rugCount} 个 rug。有过一次就很难相信第二次。`);
  } else if (priorTokens.length === 0) {
    add('medium', '无历史发币记录', 'creator 是全新钱包。既没有前科，也没有可验证的成功履历 —— 无法据此加分。');
  } else {
    add('good', '历史记录干净', `creator 发行过 ${priorTokens.length} 个代币，无 rug 记录。`);
  }

  // 同一 creator 短期批量发币 —— 典型「广撒网」模式
  if ((d.tokensLast7d ?? 0) >= 3) {
    add('high', '短期内批量发币', `该 creator 近 7 天发行了 ${d.tokensLast7d} 个代币。广撒网式发币通常意味着不打算长期经营。`);
  }

  // ── dev sell 检测 ───────────────────────────────────────────────
  const soldRatio = d.devSoldRatio ?? 0;
  if (d.devFullyExited) {
    veto('部署者已清仓', 'creator 已卖出全部持仓。项目方都跑光了，没有任何理由留下。');
  } else if (soldRatio >= t.devSoldRatioDanger) {
    const early = (d.devFirstSellAgeSec ?? Infinity) < t.fastDumpWindowSec;
    add(
      early ? 'critical' : 'high',
      '部署者大额抛售',
      `已卖出其买入量的 ${(soldRatio * 100).toFixed(0)}%` +
        (early
          ? `，且首次卖出发生在发币后 ${Math.round((d.devFirstSellAgeSec ?? 0) / 60)} 分钟，属于快速出货。`
          : '。'),
    );
  } else if (soldRatio >= t.devSoldRatioWarn) {
    add(
      'medium',
      '部署者部分减持',
      `已卖出买入量的 ${(soldRatio * 100).toFixed(0)}%。注意：部分回收成本在 meme 圈很常见，本身不等于 rug，但需持续跟踪。`,
    );
  } else if (soldRatio > 0) {
    add('low', '部署者有小额卖出', `卖出比例 ${(soldRatio * 100).toFixed(1)}%，属正常范围内的成本回收。`);
  } else if (d.devHoldingPct !== undefined) {
    add('good', '部署者未卖出', `creator 仍持有 ${d.devHoldingPct.toFixed(1)}%，未见卖出行为。`);
  }

  // ── 资金来源与关联 ──────────────────────────────────────────────
  if (d.fundedByMixer) {
    add('high', '资金来自混币/跳转钱包', `creator 资金经 ${d.hopCount ?? '多'} 跳中转转入，存在刻意隐藏资金来源的行为。`);
  }
  if ((d.linkedWallets?.length ?? 0) > 0) {
    add('medium', '存在关联钱包簇', `发现 ${d.linkedWallets!.length} 个与 creator 资金关联的钱包，可能存在协同操作。`);
  }
  if (d.twitterAgeDays !== undefined && d.twitterAgeDays < 7) {
    add('low', '项目方社交账号极新', `Twitter 账号创建仅 ${d.twitterAgeDays} 天。新号不等于骗子，但无法作为可信背书。`);
  }

  return {
    dimension: 'developer',
    label: '开发者历史',
    score: vetoed ? 100 : scoreFromFindings(findings),
    vetoed,
    findings,
    metrics: {
      priorTokenCount: priorTokens.length,
      priorRugCount: rugCount,
      tokensLast7d: d.tokensLast7d ?? 0,
      devSoldRatio: soldRatio,
      devHoldingPct: d.devHoldingPct ?? 0,
    },
  };
}
