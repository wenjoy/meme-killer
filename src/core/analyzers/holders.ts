/**
 * 维度 3：持币集中度
 *
 * 关键认知 —— **最大的误报源**：
 * bonding curve / AMM pool 天然持有大部分供应量。若不先把池地址、金库、
 * burn 地址剔除，任何正常项目都会被算成「Top10 控盘 80%」。
 * 所以正确顺序是：**先分类剔除 → 再算非池持仓占比**。
 */
import { BURN_ADDRESSES, POOL_LABEL_PATTERN, THRESHOLDS, scoreFromFindings } from '../constants';
import type { DimensionResult, Finding, RawHolder, ScanInput, Severity } from '../types';

export type HolderKind = 'pool' | 'burn' | 'dev' | 'team' | 'sniper' | 'retail';

/** 把一个持有者归类 */
export function classifyHolder(
  holder: RawHolder,
  opts: { creator?: string; poolAddresses?: Set<string>; burnAddresses?: Set<string> } = {},
): HolderKind {
  const { creator, poolAddresses, burnAddresses = BURN_ADDRESSES } = opts;
  const addr = holder.address ?? '';
  // 显式池地址（从链上解析到的 curve / AMM vault）优先级最高
  if (poolAddresses?.has(addr)) return 'pool';
  if (holder.isPool) return 'pool';
  if (POOL_LABEL_PATTERN.test(addr) || POOL_LABEL_PATTERN.test(holder.label ?? '')) return 'pool';
  if (holder.isBurn || burnAddresses.has(addr)) return 'burn';
  if (creator && addr === creator) return 'dev';
  if (holder.isTeamWallet) return 'team';
  if (holder.isSniper) return 'sniper';
  return 'retail';
}

export function analyzeHolders(data: ScanInput): DimensionResult {
  const t = THRESHOLDS.holders;
  const creator = data.developer?.creator;
  const supply = data.token?.supply ?? data.contract?.supply ?? 1_000_000_000;

  const raw = data.holders ?? [];

  // 没有持仓数据时不能报「持仓分布健康」—— 那是把「没看到」当成「没问题」。
  // 集中度是本模型权重第三的维度，缺失必须让覆盖率如实下降。
  if (raw.length === 0) {
    return {
      dimension: 'holders',
      label: '持币集中度',
      score: 0,
      vetoed: false,
      findings: [
        {
          severity: 'medium',
          title: '持仓数据缺失',
          detail:
            '未能获取持有者分布，无法判断是否存在庄家控盘。此项不计入评分，请到 RugCheck / Solscan 查看 holders 分布。',
        },
      ],
      metrics: { available: 0 },
    };
  }

  const poolAddresses = new Set(data.liquidity?.poolAddresses ?? []);
  const classified = raw
    .map((h) => {
      const pct = h.pct ?? (supply > 0 ? (h.amount / supply) * 100 : 0);
      return { ...h, pct, kind: classifyHolder(h, { creator, poolAddresses }) };
    })
    // 按持仓从大到小排，保证 Top10 取的是真正的前十
    .sort((a, b) => b.pct - a.pct);

  const byKind: Record<HolderKind, number> = { pool: 0, burn: 0, dev: 0, team: 0, sniper: 0, retail: 0 };
  let excludedPct = 0;
  for (const h of classified) {
    byKind[h.kind] += h.pct;
    if (h.kind === 'pool' || h.kind === 'burn') excludedPct += h.pct;
  }

  const circulating = classified.filter((h) => h.kind !== 'pool' && h.kind !== 'burn');
  const top10Pct = circulating.slice(0, 10).reduce((s, h) => s + h.pct, 0);
  const largest = circulating[0];
  const devClusterPct = circulating
    .filter((h) => h.kind === 'dev' || h.kind === 'team')
    .reduce((s, h) => s + h.pct, 0);
  const sniperPct = circulating.filter((h) => h.kind === 'sniper').reduce((s, h) => s + h.pct, 0);

  const findings: Finding[] = [];
  let vetoed = false;
  const veto = (title: string, detail: string) => {
    vetoed = true;
    findings.push({ severity: 'critical', title, detail, veto: true });
  };
  const add = (severity: Severity, title: string, detail: string) =>
    findings.push({ severity, title, detail });

  if (classified.length > 0) {
    add(
      'good',
      '已剔除池与销毁地址',
      `剔除 ${excludedPct.toFixed(1)}% 的池/burn 持仓后再计算集中度，避免把正常流动性误判为庄家控盘。` +
        `真实流通盘 ${(100 - excludedPct).toFixed(1)}%。`,
    );
  }

  if (top10Pct > t.top10Danger) {
    veto(
      'Top10 持仓过度集中',
      `剔除池与 burn 后，前 10 大持有者占流通盘 ${top10Pct.toFixed(1)}%（阈值 ${t.top10Danger}%）。少数地址可轻易砸盘。`,
    );
  } else if (top10Pct > t.top10Warn) {
    add('medium', 'Top10 持仓偏集中', `前 10 大持有者占流通盘 ${top10Pct.toFixed(1)}%，超过 ${t.top10Warn}% 警戒线。`);
  } else if (classified.length > 0) {
    add('good', '持仓分布健康', `前 10 大持有者仅占流通盘 ${top10Pct.toFixed(1)}%。`);
  }

  if (largest && largest.kind === 'retail' && largest.pct > t.singleWalletWarn) {
    add(
      largest.pct > 20 ? 'high' : 'medium',
      '存在单一巨鲸',
      `非 dev/team 钱包 ${largest.address} 持有 ${largest.pct.toFixed(1)}%，其抛售会造成显著滑点。`,
    );
  }

  if (devClusterPct > t.devClusterDanger) {
    add('high', 'dev 及关联钱包持仓偏高', `dev/团队关联钱包合计持有 ${devClusterPct.toFixed(1)}%（阈值 ${t.devClusterDanger}%）。`);
  } else if (devClusterPct > 0) {
    add('good', 'dev 持仓在合理范围', `dev/团队合计 ${devClusterPct.toFixed(1)}%。`);
  }

  if (sniperPct > t.sniperWalletDanger) {
    add('medium', '狙击钱包筹码偏多', `狙击机器人合计持有 ${sniperPct.toFixed(1)}%，随时可能砸盘。`);
  }

  const holderCount = data.liquidity?.holderCount ?? 0;
  if (holderCount > 0 && holderCount < t.minHolderCount && top10Pct > t.top10Warn) {
    add('high', '持有人少且集中', `仅 ${holderCount} 个持有人，配合 ${top10Pct.toFixed(1)}% 的集中度，缺乏出货深度。`);
  }

  return {
    dimension: 'holders',
    label: '持币集中度',
    score: vetoed ? 100 : scoreFromFindings(findings),
    vetoed,
    findings,
    metrics: {
      top10Pct,
      excludedPct,
      devClusterPct,
      sniperPct,
      holderCount,
      circulatingCount: circulating.length,
      byKind,
    },
  };
}
