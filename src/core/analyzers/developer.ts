/**
 * 维度 4：开发者历史
 *
 * 关键认知：
 * - 追溯路径：mint 的 create 交易 → fee payer / signer = creator。
 * - ⚠️「历史 rug 率」本工具**不计算**：那需要每个历史代币的价格与流动性历史，
 *   单次查询做不到。所以这里只报「发过几个币」，结局一律标为「未核实」，
 *   绝不输出「历史记录干净」这种没有数据支撑的利好。
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

  // ── 部署者身份本身要交代清楚 ────────────────────────────────────
  // 实测同一个代币上「创建交易付款方」与「程序记录的 creator」可以完全不同
  // （打包器发币、再把 creator 转给真 dev）。此时下面所有 dev 结论说的是
  // **creator**，不是那个付款的钱包 —— 不说清楚读者会追错人。
  if (!d.creator) {
    add(
      'medium',
      '部署者身份未知',
      '三级来源（curve 程序状态、metadata、创建交易）都没能确定 creator，' +
        '开发者维度的结论无法归属到任何具体地址。',
    );
  } else if (d.creatorSource === 'create-tx') {
    // 只能从付款方推断 = 可能追错人，必须说清楚这是推断值
    add(
      'medium',
      '部署者身份为推断值',
      `读不到 pump.fun 曲线或 metadata 里的 creator，只能取创建交易的付款方 \`${d.creator}\`` +
        '作为部署者 —— 用打包器/launchpad 发币时，这个地址是代付手续费的钱包，不是真正的 dev。' +
        '下面的 dev 买卖结论请按此折价看待。',
    );
  } else if (d.launchWallet) {
    // 有权威来源、但创建钱包是另一个地址：这是**披露**，不是风险
    add(
      'low',
      '创建钱包与 creator 不是同一个地址',
      `本报告的开发者维度按 creator \`${d.creator}\` 计算，` +
        `而创建交易的付款方是 \`${d.launchWallet}\` —— 付费发币的钱包不一定是 dev` +
        '（打包器 / launchpad 发币、再把 creator 转给真 dev 很常见），两者不要混为一谈。',
    );
  }

  // ── 历史发币 ────────────────────────────────────────────────────
  //
  // ⚠️ 这里曾经输出过一条**没有根据的利好**：`priorRugCount ?? priorTokens
  //  .filter(rugged)` 两边都是空（没有任何 provider 能判定历史代币是否 rug），
  // 于是只要有历史发币就报「历史记录干净」—— 把「不知道」说成了「没问题」。
  // 判断历史 rug 需要那些代币的价格与流动性历史，本工具只用单次查询，做不到，
  // 所以这里只报「发了几个」，结局一律标为未核实。
  if (priorTokens.length === 0) {
    add('medium', '无历史发币记录', 'creator 是全新钱包。既没有前科，也没有可验证的成功履历 —— 无法据此加分。');
  } else {
    add(
      'low',
      '历史发币结局未核实',
      `该 creator 还发行过 ${priorTokens.length} 个代币，但本工具不做价格/流动性历史回溯，` +
        '无法判断其中是否有 rug —— 请人工核对该地址的历史，不要当成「记录干净」。',
    );
  }

  // 同一 creator 短期批量发币 —— 典型「广撒网」模式
  if ((d.tokensLast7d ?? 0) >= 3) {
    add('high', '短期内批量发币', `该 creator 近 7 天发行了 ${d.tokensLast7d} 个代币。广撒网式发币通常意味着不打算长期经营。`);
  }

  // ── dev sell 检测 ───────────────────────────────────────────────
  //
  // ⚠️ 这一步不能只看「卖出/买入」的流水比例。
  // 实测踩到的坑：creator 用 dev buy 建仓后卖出一部分，
  // 但**链上余额仍持有 27.6% 的供应量**，流水比例却显示 sold/bought = 100%，
  // 于是报出「部署者已清仓」的硬否决 —— 与事实完全相反。
  //
  // 流水比例失真有两个来源：
  //   1. 交易历史窗口有限（只取最近 100 笔），买与卖可能落在不同窗口里
  //   2. 建仓与减仓的价位不同，比例本身不代表「还剩多少」
  //
  // 因此：**只有当链上余额确实为零时，才允许下「已清仓」这个硬否决。**
  // 余额未知时降级为「无法确认」，绝不因为流水比例就把项目判死。
  const soldRatio = d.devSoldRatio ?? 0;
  const exitConfirmed = d.devFullyExited === true;

  if (exitConfirmed) {
    veto('部署者已清仓', 'creator 已卖出全部持仓。项目方都跑光了，没有任何理由留下。');
  } else if (d.devFullyExited === false && soldRatio >= t.devSoldRatioDanger) {
    // 已确认「尚未清仓」，但仍在大额减持
    const early = (d.devFirstSellAgeSec ?? Infinity) < t.fastDumpWindowSec;
    add(
      early ? 'critical' : 'high',
      '部署者大额抛售',
      `已卖出其买入量的 ${(soldRatio * 100).toFixed(0)}%` +
        (early
          ? `，且首次卖出发生在发币后 ${Math.round((d.devFirstSellAgeSec ?? 0) / 60)} 分钟，属于快速出货。`
          : '。'),
    );
  } else if (soldRatio > 0) {
    // 流水比例有值但无法确认是否清仓 → 只提示，不升级为否决
    const sold = (soldRatio * 100).toFixed(0);
    add(
      soldRatio >= t.devSoldRatioDanger ? 'high' : soldRatio >= t.devSoldRatioWarn ? 'medium' : 'low',
      '部署者有过卖出',
      `按可获取的交易记录，卖出量约占其买入量的 ${sold}%（历史窗口有限，该比例可能失真）。` +
        '注意：部分回收成本在 meme 圈很常见，本身不等于 rug；' +
        '但链上持仓余额未能确认，请自行核对 creator 地址的当前持仓。',
    );
  } else if (d.devHoldingPct !== undefined) {
    add('good', '部署者未卖出', `creator 仍持有其买入量的 ${d.devHoldingPct.toFixed(1)}%，未见卖出行为。`);
  }

  // ── 资金来源与关联 ──────────────────────────────────────────────
  //
  // 只做一件事：creator 的首笔资金是谁给的。这是链上可核实的事实，
  // 但它**不是**「混币证据」（Helius 的 funded-by 接口已下线，跳数无法追溯），
  // 所以只作低强度提示，不升级为风险结论。
  if ((d.linkedWallets?.length ?? 0) > 0) {
    add(
      'low',
      'creator 的首笔资金来自其它钱包',
      `首笔交易的资金来自 ${d.linkedWallets![0]}。这只能说明资金来源，` +
        '无法据此判断是否为中介/混币 —— 请自行核对该钱包的性质。',
    );
  }

  return {
    dimension: 'developer',
    label: '开发者历史',
    score: vetoed ? 100 : scoreFromFindings(findings),
    vetoed,
    findings,
    metrics: {
      priorTokenCount: priorTokens.length,
      ...(d.creator ? { creator: d.creator } : {}),
      ...(d.creatorSource ? { creatorSource: d.creatorSource } : {}),
      ...(d.launchWallet ? { launchWallet: d.launchWallet } : {}),
      ...(d.tokensLast7d !== undefined ? { tokensLast7d: d.tokensLast7d } : {}),
      ...(d.devSoldRatio !== undefined ? { devSoldRatio: soldRatio } : {}),
      ...(d.devHoldingPct !== undefined ? { devHoldingPct: d.devHoldingPct } : {}),
    },
  };
}
