/**
 * 维度 3：持币集中度
 *
 * 关键认知 —— **最大的误报源**：
 * bonding curve / AMM pool 天然持有大部分供应量。若不先把池地址、金库、
 * burn 地址剔除，任何正常项目都会被算成「Top10 控盘 80%」。
 * 所以正确顺序是：**先分类剔除 → 再算非池持仓占比**。
 */
import {
  BURN_ADDRESSES,
  EXCLUDED_HOLDER_KINDS,
  POOL_LABEL_PATTERN,
  THRESHOLDS,
  scoreFromFindings,
} from '../constants';
import type {
  CustodyMetric,
  DimensionResult,
  Finding,
  HolderRow,
  RawHolder,
  ScanInput,
  Severity,
} from '../types';

/**
 * `timelock` = 时间锁仓（从集中度剔除，但单独列出）
 * `custody`  = 其他程序托管（多签/未知托管）：**不剔除**，因为它们能随时转出
 */
export type HolderKind =
  | 'pool'
  | 'burn'
  | 'timelock'
  | 'custody'
  /** creator 本人 */
  | 'dev'
  /**
   * 与部署者关联的钱包（创建交易的付款方、给 creator 首笔交易出资的钱包）。
   *
   * ⚠️ 单独一类而不是算「散户」：它出钱发币、还常常持有 LP，
   * 把它显示成散户会让读者低估这条筹码的可控性。
   * 但它**计入集中度**（能随时卖出，不是托管）。
   */
  | 'related'
  | 'sniper'
  | 'retail';

/** 该持仓是否从流通盘/集中度里剔除 */
export function isExcludedKind(kind: HolderKind): boolean {
  return EXCLUDED_HOLDER_KINDS.has(kind);
}

/** 把一个持有者归类 */
export function classifyHolder(
  holder: RawHolder,
  opts: {
    creator?: string;
    relatedWallets?: Set<string>;
    poolAddresses?: Set<string>;
    burnAddresses?: Set<string>;
  } = {},
): HolderKind {
  const { creator, relatedWallets, poolAddresses, burnAddresses = BURN_ADDRESSES } = opts;
  const addr = holder.address ?? '';
  // 优先级原则：**链上确认的事实 > 文本启发式**。
  // 池标签只是拿地址/标签字符串正则碰运气，而 custody 是从链上反查出来的
  // 确证事实。曾经把文本启发式排在前面，结果地址里带 "vault" 的
  // 已确认锁仓仓位被误判成池并静默剔除 —— 既没列出、也没算进集中度。
  if (poolAddresses?.has(addr)) return 'pool';
  if (holder.isPool) return 'pool';
  if (holder.isBurn || burnAddresses.has(addr)) return 'burn';
  // 托管判定放在 dev 之前：锁仓仓位即便属于 dev，也不该按「可随时砸盘」算
  if (holder.custody?.kind === 'timelock') return 'timelock';
  if (holder.custody) return 'custody';
  if (POOL_LABEL_PATTERN.test(addr) || POOL_LABEL_PATTERN.test(holder.label ?? '')) return 'pool';
  if (creator && addr === creator) return 'dev';
  if (relatedWallets?.has(addr)) return 'related';
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
  // 与部署者关联的钱包：创建交易的付款方 + 给 creator 首笔交易出资的钱包。
  // 只是**标注**，不剔除 —— 它们能随时卖出。
  const relatedWallets = new Set(
    [data.developer?.launchWallet, ...(data.developer?.linkedWallets ?? [])].filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    ),
  );
  const classified = raw
    .map((h) => {
      const pct = h.pct ?? (supply > 0 ? (h.amount / supply) * 100 : 0);
      return { ...h, pct, kind: classifyHolder(h, { creator, relatedWallets, poolAddresses }) };
    })
    // 按持仓从大到小排，保证 Top10 取的是真正的前十
    .sort((a, b) => b.pct - a.pct);

  const byKind: Record<HolderKind, number> = {
    pool: 0,
    burn: 0,
    timelock: 0,
    custody: 0,
    dev: 0,
    related: 0,
    sniper: 0,
    retail: 0,
  };
  let excludedPct = 0;
  for (const h of classified) {
    byKind[h.kind] += h.pct;
    if (isExcludedKind(h.kind)) excludedPct += h.pct;
  }

  // ⚠️ custody（多签/未知托管）**不剔除** —— 它们能随时把币转出来，
  // 计入集中度才是保守且正确的做法。
  const circulating = classified.filter((h) => !isExcludedKind(h.kind));
  const top10Pct = circulating.slice(0, 10).reduce((s, h) => s + h.pct, 0);
  const largest = circulating[0];
  // dev 本人（链上确认的 creator 地址）＋ 与部署者关联的钱包。
  // ⚠️「关联」只采信链上事实：出钱发币的付款方、给 creator 首笔交易出资的钱包。
  // 更远的「团队钱包」需要资金图谱佐证，没有数据源就不猜。
  const devClusterPct = circulating
    .filter((h) => h.kind === 'dev' || h.kind === 'related')
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
      `剔除 ${excludedPct.toFixed(1)}% 的池 / burn / 锁仓持仓后再计算集中度，避免把正常流动性误判为庄家控盘。` +
        `真实流通盘 ${(100 - excludedPct).toFixed(1)}%。`,
    );
  }

  if (top10Pct > t.top10Danger) {
    veto(
      'Top10 持仓过度集中',
      `剔除池 / burn / 锁仓后，前 10 大持有者占流通盘 ${top10Pct.toFixed(1)}%（阈值 ${t.top10Danger}%）。少数地址可轻易砸盘。`,
    );
  } else if (top10Pct > t.top10Warn) {
    add('medium', 'Top10 持仓偏集中', `前 10 大持有者占流通盘 ${top10Pct.toFixed(1)}%，超过 ${t.top10Warn}% 警戒线。`);
  } else if (classified.length > 0) {
    add('good', '持仓分布健康', `前 10 大持有者仅占流通盘 ${top10Pct.toFixed(1)}%。`);
  }

  // 巨鲸判断针对「能随时卖出」的持仓。多签/托管能随时转出，所以算；
  // 时间锁仓不能卖，已在 circulating 里被剔除，不会走到这里。
  if (largest && largest.kind !== 'dev' && largest.pct > t.singleWalletWarn) {
    const who = largest.custody ? `程序托管仓位（${largest.custody.label}）` : '非 dev 钱包';
    add(
      largest.pct > 20 ? 'high' : 'medium',
      '存在单一巨鲸',
      `${who} ${largest.address} 持有 ${largest.pct.toFixed(1)}%，其抛售会造成显著滑点。` +
        (largest.custody ? '（托管不等于锁定：多签可随时签名转出，故仍计入巨鲸判定。）' : ''),
    );
  }

  // ── 托管持仓：锁仓剔除但必须列出，多签只列出不剔除 ──────────────
  const custodyList: CustodyMetric[] = classified
    // 余额为 0 的托管账户是「锁仓已全部解锁/领取」后留下的空账户，
    // 列出来只会变成噪音（实测某 pump.fun 代币的 Jupiter Lock 账户余额就是 0）。
    .filter((h) => h.custody && h.pct > 0)
    .map((h) => ({
      address: h.address,
      kind: h.custody!.kind,
      label: h.custody!.label,
      pct: h.pct,
      amount: h.amount,
      unlockAt: h.custody!.unlockAt,
      unlockEndAt: h.custody!.unlockEndAt,
      claimedAmount: h.custody!.claimedAmount,
      totalAmount: h.custody!.totalAmount,
      unlockAtUnknown: h.custody!.unlockAtUnknown,
    }));
  const timelockPct = byKind.timelock;
  const otherCustodyPct = byKind.custody;

  // ── 前 20 大持仓明细：把分类结果逐行交给 UI ──────────────────────
  // 链上 RPC 只返回前 20 个账户，这份明细就是「能核对到的全部」，
  // 更深的分布需要索引器 —— 这句话必须跟着这份表一起出现。
  //
  // ⚠️ 只取前 20 行有个坑：如果前 20 个账户里被剔除的（池/销毁/锁仓）太多，
  // 「计入集中度」的行就不够 10 行，读者用这张表**加不出** Top10 ——
  // 界面上那句「Top10 = 下表计入的前 10 行合计」就成了假等式。
  // 所以必要时往后补几行，保证计入的行至少 10 行。
  const toRow = (h: (typeof classified)[number]): HolderRow => ({
    address: h.address,
    amount: h.amount,
    pct: h.pct,
    kind: h.kind,
    counted: !isExcludedKind(h.kind),
    ...(h.label ? { label: h.label } : {}),
    ...(h.custody ? { custody: { kind: h.custody.kind, label: h.custody.label } } : {}),
  });
  const topHolders: HolderRow[] = (() => {
    const rows = classified.slice(0, 20).map(toRow);
    const shown = rows.filter((r) => r.counted).length;
    if (shown >= 10) return rows;
    const extra = classified
      .slice(20)
      .filter((h) => !isExcludedKind(h.kind))
      .slice(0, 10 - shown);
    return [...rows, ...extra.map(toRow)];
  })();

  if (timelockPct > 0) {
    const locks = custodyList.filter((c) => c.kind === 'timelock');
    add(
      'good',
      `锁仓持仓 ${timelockPct.toFixed(1)}%（已从集中度中剔除）`,
      `${locks.length} 个时间锁仓仓位（${[...new Set(locks.map((l) => l.label))].join('、')}）合计 ${timelockPct.toFixed(1)}%，` +
        '解锁前无法卖出，因此不计入 Top10 与巨鲸判断。' +
        (locks.some((l) => l.unlockAt)
          ? `解锁时间：首次 ${locks.find((l) => l.unlockAt)!.unlockAt!.slice(0, 10)}` +
            `，全部解锁 ${locks.find((l) => l.unlockEndAt)?.unlockEndAt?.slice(0, 10) ?? '—'}。` +
            '⚠️ 锁仓会随时间线性释放，解锁后即可抛售。'
          : '⚠️ 解锁时间读不到，如实标为「待接入」——这不是「已解锁」，到期日需另行留意。'),
    );
  }

  // 尘埃级托管（< custodyWarnPct）不出 finding：0.0% 的持仓提示只会淹没真正重要的信号
  if (otherCustodyPct >= t.custodyWarnPct) {
    const others = custodyList.filter((c) => c.kind !== 'timelock');
    add(
      'medium',
      `程序托管持仓 ${otherCustodyPct.toFixed(1)}%（未剔除）`,
      `${others.length} 个仓位由程序控制（${[...new Set(others.map((o) => o.label))].join('、')}），合计 ${otherCustodyPct.toFixed(1)}%。` +
        '⚠️ 多签/托管**不是时间锁**，可随时签名转出，因此仍然计入集中度，只是单独列出让你看得见。',
    );
  }

  const devPct = circulating.filter((h) => h.kind === 'dev').reduce((s, h) => s + h.pct, 0);
  const relatedPct = circulating.filter((h) => h.kind === 'related').reduce((s, h) => s + h.pct, 0);
  if (devClusterPct > t.devClusterDanger) {
    add(
      'high',
      'dev 持仓偏高',
      `creator 地址持有流通盘 ${devPct.toFixed(1)}%、与部署者关联的钱包持有 ${relatedPct.toFixed(1)}%，` +
        `合计 ${devClusterPct.toFixed(1)}%（阈值 ${t.devClusterDanger}%）。`,
    );
  } else if (devClusterPct > 0) {
    add(
      'good',
      'dev 持仓在合理范围',
      `creator 地址持有 ${devPct.toFixed(1)}%` +
        (relatedPct > 0 ? `，关联钱包持有 ${relatedPct.toFixed(1)}%` : '') +
        `，合计 ${devClusterPct.toFixed(1)}%。`,
    );
  }

  if (sniperPct > t.sniperWalletDanger) {
    add(
      sniperPct > 45 ? 'high' : 'medium',
      '狙击钱包筹码偏多',
      `最早成交的钱包目前合计持有 ${sniperPct.toFixed(1)}%，随时可能砸盘。` +
        '（已排除 creator 自买；只统计仍留在前 20 大持仓里的部分，因此是下限。未知时不会出现在这里。）',
    );
  }

  // 持有人总数来自 RugCheck；undefined = 拿不到，不是 0
  const holderCount = data.liquidity?.holderCount;
  if (holderCount !== undefined && holderCount > 0 && holderCount < t.minHolderCount && top10Pct > t.top10Warn) {
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
      ...(holderCount !== undefined ? { holderCount } : {}),
      circulatingCount: circulating.length,
      byKind,
      custody: custodyList,
      topHolders,
      timelockPct,
      otherCustodyPct,
    },
  };
}
