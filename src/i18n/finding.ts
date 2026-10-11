/**
 * 把结构化结论（id + params）渲染成当前语言的文案。
 *
 * 设计要点：
 * - **回退链**：查 id → 查不到就用分析器给的中文 title/detail（过渡期兼容）→
 *   都没有就显示 id 本身。任何一步都不返回空字符串 —— 页面上少一句话
 *   比出现一个奇怪的 key 更难被发现。
 * - **title 与 detail 各自的 key**：约定 `findings.<id>` 是标题，
 *   `findings.<id>.detail` 是详情。这样一条结论在不同语言下可以
 *   有完全不同的断句与语序。
 *
 * ⚠️ 这个文件刻意**不 import React / Provider**：它是纯函数，
 * 因此可以被 node:test 直接加载（测试环境解析不了 .tsx）。
 * React 版本在 useFinding.ts 里。
 */
import type { Finding } from '../core/types';

export interface LocalizedFinding {
  severity: Finding['severity'];
  title: string;
  detail: string;
  veto?: true;
}

/**
 * 纯函数版本（便于测试，不依赖 React）。
 *
 * `t` 与 `n` 由调用方传入，因此这个函数可以在没有 Provider 的
 * 单元测试里直接验证。
 */
/**
 * 派生占位符。
 *
 * ── 为什么需要这一层 ──────────────────────────────────────────────
 * 分析器里有若干「可选后缀」的拼装，形如：
 *
 *   `由 ${locker} 持有` + (unlockAt ? `，锁定至 ${unlockAt}` : '') + `。`
 *
 * 注意后缀**自带前置标点**（逗号/括号）。如果直接把这句拆成
 * `...{unlockAtText}...`，那么当 unlockAt 为空时不能简单渲染成空串 ——
 * 句首会留下一个孤零零的逗号。所以标点必须和后缀一体进退。
 *
 * 因此约定：以 `Text` / `Tail` / `Sentence` 结尾的占位符由**这里**派生，
 * 分析器的 params 里不需要（也不应该）提供它们。派生函数负责连标点一起
 * 决定「给不给」。
 *
 * ⚠️ 关键安全点：**任何派生占位符都必须在这里有对应实现**。
 * 否则放不进去会渲染成裸露的 `{unlockAtText}` 字样出现在页面上。
 */

/**
 * 从 params 里取结构化片段。
 *
 * 为什么用 JSON 串而不是对象：`Finding.params` 的类型是
 * `Record<string, string | number>` —— 刻意保持扁平，因为它的用途是
 * 「模板插值」。而这三段组合句需要嵌套（行数组 + 可选字段）。
 * 为了不把 Finding 的类型改成递归结构（会波及所有分析器与测试），
 * 这里用 JSON 串做载体，解析失败就当作没有片段、走中文回退。
 *
 * ⚠️ 解析失败必须静默回退，不能抛 —— 一个文案片段解析不了，
 * 不该让整份报告渲染不出来。
 */
function parseParts<T>(raw: unknown): T | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

interface SizeParts {
  trades: number;
  windowSec?: number;
  buyCount: number;
  buyVol: string;
  avgBuy: string;
  medianBuy: string;
  sellCount: number;
  sellVol: string;
  avgSell: string;
  medianSell: string;
  sellRatio: string;
  maxSellSol?: number;
  largestSharePct?: string;
  top5Pct?: string;
}

interface SellRow {
  sol: string;
  time: string;
  trader?: string;
  signature: string;
}

interface SellParts {
  rows: SellRow[];
  identity:
    | { kind: 'noWindow' }
    | {
        kind: 'known';
        count: number;
        windowTrades: number;
        creatorCount: number;
        earlyCount: number;
        detail: { identityKind: 'creator' | 'early'; index?: number; sol: string }[];
        stillHolding: { count: number; maxPct: string } | null;
      };
}


/** 组装 sellEvidence（卖单行 + 身份核对）。片段缺失或字典缺 key 时返回空串。 */
function composeSell(
  p: Record<string, string | number>,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const parts = parseParts<SellParts>(p.sellParts);
  if (!parts) return '';
  const K = 'pieces.liquidity.sellEvidence';
  const tr = (key: string, params?: Record<string, string | number>): string => {
    const out = t(key, params);
    return out === key ? '' : out;
  };
  const head = tr(`${K}.head`, { n: parts.rows.length });
  if (!head) return '';
  const rows = parts.rows
    .map((r) => {
      let line = tr(`${K}.row`, { sol: r.sol, time: r.time });
      if (r.trader) line += tr(`${K}.rowTrader`, { trader: r.trader });
      return line + tr(`${K}.rowSignature`, { signature: r.signature });
    })
    .join(tr(`${K}.sep`));
  return head + rows + tr(`${K}.tail`) + composeIdentity(p, t);
}

/** 组装身份核对段（跟在卖单行之后）。 */
function composeIdentity(
  p: Record<string, string | number>,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const parts = parseParts<SellParts>(p.sellParts);
  if (!parts) return '';
  const K = 'pieces.liquidity.identity';
  const tr = (key: string, params?: Record<string, string | number>): string => {
    const out = t(key, params);
    return out === key ? '' : out;
  };
  const id = parts.identity;
  if (id.kind === 'noWindow') {
    const head = tr(`${K}.head`, { n: parts.rows.length });
    const body = tr(`${K}.noWindow`);
    return head && body ? head + body : '';
  }
  const head = tr(`${K}.head`, { n: id.count });
  if (!head) return '';
  const creator = id.creatorCount > 0 ? tr(`${K}.creatorPart`, { creatorCount: id.creatorCount }) : '';
  let earlyPart: string;
  if (id.earlyCount > 0) {
    const detail = id.detail
      .map((d) => {
        const identity =
          d.identityKind === 'creator'
            ? tr(`${K}.sellerIsCreator`)
            : tr(`${K}.sellerIsEarlyBuyer`, { windowTrades: id.windowTrades, index: (d.index ?? 0) + 1 });
        return identity ? tr(`${K}.detailRow`, { identity, sol: d.sol }) : '';
      })
      .filter(Boolean)
      .join(tr(`${K}.detailSep`));
    earlyPart = tr(`${K}.earlyPart`, { earlyCount: id.earlyCount, windowTrades: id.windowTrades, detail });
  } else {
    earlyPart = tr(`${K}.noEarlyPart`, { windowTrades: id.windowTrades });
  }
  const holding =
    id.stillHolding !== null
      ? tr(`${K}.stillHoldingPart`, { n: id.stillHolding.count, maxPct: id.stillHolding.maxPct })
      : tr(`${K}.noneHoldingPart`);
  const caveat = tr(`${K}.windowCaveat`);
  return head + creator + earlyPart + holding + caveat;
}

/** 组装 sizeEvidence。片段缺失或字典缺 key 时返回空串（上层回退中文）。 */
function composeSize(
  p: Record<string, string | number>,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const parts = parseParts<SizeParts>(p.sizeParts);
  if (!parts) return '';
  const K = 'pieces.liquidity.sizeEvidence';
  // t() 缺 key 时返回 key 本身 —— 用这个特性判断有没有译文
  const tr = (key: string, params?: Record<string, string | number>): string => {
    const out = t(key, params);
    return out === key ? '' : out;
  };
  const windowText =
    parts.windowSec === undefined
      ? ''
      : parts.windowSec >= 3600
        ? tr(`${K}.windowHours`, { hours: (parts.windowSec / 3600).toFixed(1) })
        : tr(`${K}.windowMinutes`, { minutes: Math.max(1, Math.round(parts.windowSec / 60)) });
  const maxSell =
    parts.maxSellSol === undefined || parts.maxSellSol <= 0
      ? ''
      : parts.largestSharePct !== undefined
        ? tr(`${K}.maxSell`, { maxSellSol: parts.maxSellSol.toFixed(3), largestSharePct: parts.largestSharePct })
        : tr(`${K}.maxSellNoLargest`, { maxSellSol: parts.maxSellSol.toFixed(3) });
  const top5 = parts.top5Pct !== undefined ? tr(`${K}.top5`, { top5Pct: parts.top5Pct }) : '';
  const main = tr(K, {
    trades: parts.trades,
    windowText,
    buyCount: parts.buyCount,
    buyVol: parts.buyVol,
    avgBuy: parts.avgBuy,
    medianBuy: parts.medianBuy,
    sellCount: parts.sellCount,
    sellVol: parts.sellVol,
    avgSell: parts.avgSell,
    medianSell: parts.medianSell,
    sellRatio: parts.sellRatio,
    maxSell: maxSell + top5 + (maxSell ? tr(`${K}.tail`) : ''),
  });
  return main;
}

/** 查 key + 插值；缺译文时返回 undefined（调用方回退中文）。 */
function fmt(
  t: (key: string, params?: Record<string, string | number>) => string,
  key: string,
  params?: Record<string, string | number>,
): string | undefined {
  const out = t(key, params);
  return out === key ? undefined : out;
}

function derivePlaceholders(
  params: Record<string, string | number>,
  t: (key: string, params?: Record<string, string | number>) => string,
): Record<string, string | number> {
  const p = { ...params };
  const s = (k: string) => (p[k] === undefined ? '' : String(p[k]));

  // 「，锁定至 X」/「，全部解锁 Y」 —— 解锁时间只在中英文都需要时才出现
  if (p.unlockAtText === undefined) {
    const first = s('firstUnlockAt');
    const all = s('allUnlockAt');
    p.unlockAtText = first ? `，锁定至 ${first}` : all ? `，全部解锁 ${all}` : '';
  }
  // 「（X）」—— RugCheck 报的锁定比例
  if (p.lockPctText === undefined) {
    const lp = s('lockerPct') || s('lockPct');
    p.lockPctText = lp ? `（${lp}）` : '';
  }
  // 「X。」—— 第三方审计结论，作为独立句尾
  //
  // auditText 是分析器拼好的中文整句；有 auditParts 时按当前语言重组，
  // 组不出来才用中文整句（与 sizeEvidence 同一套优先级，见下方注释）。
  {
    const parts = parseParts<{ lpMint: string; everMinted: string; live: string; burned: string }>(
      p.auditParts,
    );
    const K = 'pieces.contract.lpAudit';
    const composed = parts
      ? fmt(t, K, {
          lpMint: parts.lpMint || (fmt(t, `${K}.unknownMint`) ?? '地址未知'),
          everMinted: parts.everMinted,
          live: parts.live,
          burned: parts.burned,
        })
      : undefined;
    const a = composed ?? s('auditText');
    if (a) p.auditText = a;
    // ⚠️ 分析器显式传了 auditTextTail 时不得覆盖（有测试钉住这条）。
    if (p.auditTextTail === undefined) p.auditTextTail = a ? `${a}。` : '';
  }
  // 「RugCheck 记录的 LP 持有者：X。」—— 可选证据句尾，自带前置句号
  // 分析器只在有证据时才把它拼进正文（见 contract.ts 的 evidencePart）
  {
    const e = s('lpEvidence');
    const composed = e ? fmt(t, 'pieces.contract.lpEvidence', { evidence: e }) : undefined;
    // ⚠️ 分析器显式给了就不覆盖（与 auditTextTail 同一条不变式）
    if (p.lpEvidenceText === undefined) {
      p.lpEvidenceText = e ? (composed ?? `RugCheck 记录的 LP 持有者：${e}。`) : '';
    }
  }
  // 「拿得最久的是 X…：持有 N 天…。」—— 钻石手的最强个例句
  {
    const addr = s('topAddress');
    if (!addr) {
      p.topSentence = '';
    } else {
      const K = 'pieces.diamond.topSentence';
      const holderPct = s('topHolderPct');
      const composed = fmt(t, K, {
        address: addr,
        holdDays: s('topHoldDays'),
        buys: s('topBuys'),
        buySol: s('topBuySol'),
        holderPctTail: (holderPct ? fmt(t, `${K}.holderPctTail`, { holderPct }) : '') ?? '',
      });
      p.topSentence = composed ?? `拿得最久的是 ${addr}…：持有 ${s('topHoldDays')} 天，买入 ${s('topBuys')} 次共 ${s('topBuySol')} SOL${holderPct ? `，当前占总供应 ${holderPct}%` : ''}。`;
    }
  }
  // 「浮盈最大且仍有筹码的是 X…（+N%，还有 M 枚没卖）。」—— 抛压的最强个例句
  {
    const addr = s('biggestAddress');
    if (!addr) {
      p.biggestTail = '';
    } else {
      const K = 'pieces.sellPressure.biggestTail';
      const composed = fmt(t, K, {
        address: addr,
        pnlPct: s('biggestPnlPct'),
        unsold: s('biggestUnsold'),
      });
      p.biggestTail = composed ?? `浮盈最大且仍有筹码的是 ${addr}…（+${s('biggestPnlPct')}%，还有 ${s('biggestUnsold')} 枚没卖）。`;
    }
  }
  // 「Jupiter Lock（锁仓）」这类托管程序名 —— 分析器给的是 labelKeys（字典 key
  // 数组），这里按语言查表拼成「A、B」。中文整句作为回退。
  if (p.labelKeys !== undefined) {
    const keys = parseParts<string[]>(p.labelKeys);
    if (keys && keys.length > 0) {
      const names = keys
        .map((k) => fmt(t, `report.common.custodyPrograms.${k}`))
        .filter((x): x is string => Boolean(x));
      // 与「池 3、creator 1」共用同一个列表分隔符
      if (names.length > 0) p.labels = names.join(fmt(t, 'pieces.listSep') ?? '、');
    }
  }

  // 「非 dev 钱包」/「程序托管仓位（X）」—— 巨鲸结论里的主语短语。
  // 分析器给结构化形态（whoParts），这里按语言组装；中文整句作为回退。
  if (p.whoParts !== undefined) {
    const parts = parseParts<{ kind: 'nonDev' | 'custody'; label?: string }>(p.whoParts);
    if (parts) {
      const who =
        parts.kind === 'custody'
          ? fmt(t, 'pieces.holders.who.custody', { label: parts.label ?? '' })
          : fmt(t, 'pieces.holders.who.nonDev');
      if (who) p.who = who;
    }
  }

  // 「池 3、creator 1」—— 持币集中度里的已知构成列表。
  //
  // 分析器给的是 [{k,n}]（结构化），这里按语言组装；中文整句作为回退。
  if (p.kindsParts !== undefined) {
    const parts = parseParts<{ k: string; n: number }[]>(p.kindsParts);
    if (parts && parts.length > 0) {
      const K = 'pieces.holders.kinds';
      const items = parts
        .map(({ k, n }) => {
          const kind = fmt(t, `pieces.holders.kind.${k}`);
          return kind ? fmt(t, `${K}.item`, { kind, n }) : undefined;
        })
        .filter((x): x is string => Boolean(x));
      const sep = fmt(t, `${K}.sep`) ?? '、';
      if (items.length > 0) p.kinds = items.join(sep);
    }
  }

  // 「样本：…」—— 流动性量级证据。
  //
  // 优先用分析器给的结构化片段按当前语言组装（`sizeParts` 是一个 JSON 串，
  // 见下方 composeSize）；组装不出来时回退到分析器拼好的中文整句。
  // ⚠️ 顺序很重要：**有结构化片段时必须优先用片段组装**。
  // 分析器为了过渡期兼容，总是同时给出中文整句 `sizeEvidence`；
  // 如果这里写成「仅当 sizeEvidence 为空才组装」，组装就永远不会发生 ——
  // 英文界面继续显示中文整句，而且不报错。
  {
    const composed = composeSize(p, t);
    if (composed) p.sizeEvidence = composed;
    else if (p.sizeEvidence === undefined) p.sizeEvidence = '';
  }
  // 「最大 N 笔卖单…」+「身份核对…」—— 分析器把两段合成一个 sellEvidence
  {
    const composed = composeSell(p, t);
    if (composed) p.sellEvidence = composed;
    else if (p.sellEvidence === undefined) p.sellEvidence = '';
  }
  return p;
}


/**
 * 采集告警的本地化。
 *
 * 与 `localizeFinding` 同一套约定：查 `warnings.<key>`，查不到用中文回退。
 * ⚠️ 回退链不能返回空串 —— 告警是「数据不完整」的显式证据，
 * 少显示一条会让用户以为数据是全的。
 */
export function localizeWarning(
  w: { key: string; params?: Record<string, string | number>; text: string },
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  // 某些参数本身是「字典 key 列表」（逗号分隔），例如 AMM 池种类
  // （`pieces.poolLabels.pumpswap,pieces.poolLabels.meteoraDlmm`）——
  // 这些也要翻译，否则英文告警里会夹着中文的池类型名。
  const params = { ...(w.params ?? {}) };
  for (const [k, v] of Object.entries(params)) {
    if (typeof v !== 'string' || !k.endsWith('Keys') || v.length === 0) continue;
    const resolved = v
      .split(',')
      .map((key) => {
        const tr = t(key);
        return tr === key ? key : tr;
      })
      .join('、');
    // 把 `kindKeys` 的值写进对应的展示参数（`kinds`）
    params[k.replace(/Keys$/, '')] = resolved;
  }
  const out = t(w.key, params);
  return out === w.key ? w.text : out;
}

export function localizeFinding(
  f: Finding,
  t: (key: string, params?: Record<string, string | number>) => string,
): LocalizedFinding {
  const titleKey = `findings.${f.id}`;
  const detailKey = `findings.${f.id}.detail`;

  // 派生占位符与原始 params 合并后再插值 —— 派生值不覆盖分析器显式给的同名参数
  const params = derivePlaceholders(f.params ?? {}, t);
  const title = t(titleKey, params);
  const detail = t(detailKey, params);

  return {
    severity: f.severity,
    // t() 在缺 key 时返回 key 本身 → 用这个特性判断「有没有译文」
    title: title === titleKey ? f.title : title,
    detail: detail === detailKey ? f.detail : detail,
    ...(f.veto ? { veto: true as const } : {}),
  };
}
