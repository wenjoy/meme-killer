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
function derivePlaceholders(params: Record<string, string | number>): Record<string, string | number> {
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
  if (p.auditTextTail === undefined) {
    const a = s('auditText');
    p.auditTextTail = a ? `${a}。` : '';
  }
  // 「RugCheck 记录的 LP 持有者：X。」—— 可选证据句尾，自带前置句号
  // 分析器只在有证据时才把它拼进正文（见 contract.ts 的 evidencePart）
  if (p.lpEvidenceText === undefined) {
    const e = s('lpEvidence');
    p.lpEvidenceText = e ? `RugCheck 记录的 LP 持有者：${e}。` : '';
  }
  // 「拿得最久的是 X…：持有 N 天…。」—— 钻石手的最强个例句
  if (p.topSentence === undefined) {
    const addr = s('topAddress');
    if (addr) {
      const holdDays = s('topHoldDays');
      const buys = s('topBuys');
      const buySol = s('topBuySol');
      const holderPct = s('topHolderPct');
      p.topSentence =
        `拿得最久的是 ${addr}…：持有 ${holdDays} 天，买入 ${buys} 次共 ${buySol} SOL` +
        (holderPct ? `，当前占总供应 ${holderPct}%` : '') +
        '。';
    } else {
      p.topSentence = '';
    }
  }
  // 「浮盈最大且仍有筹码的是 X…（+N%，还有 M 枚没卖）。」—— 抛压的最强个例句
  if (p.biggestTail === undefined) {
    const addr = s('biggestAddress');
    p.biggestTail = addr
      ? `浮盈最大且仍有筹码的是 ${addr}…（+${s('biggestPnlPct')}%，还有 ${s('biggestUnsold')} 枚没卖）。`
      : '';
  }
  // 「样本：…」—— 流动性量级证据，分析器已拼好整句（含句尾句号），直接透传
  if (p.sizeEvidence === undefined) p.sizeEvidence = s('sizeEvidence');
  // 「最大 N 笔卖单…」—— 同为已拼好的整句
  if (p.sellEvidence === undefined) p.sellEvidence = s('sellEvidence');
  return p;
}

export function localizeFinding(
  f: Finding,
  t: (key: string, params?: Record<string, string | number>) => string,
): LocalizedFinding {
  const titleKey = `findings.${f.id}`;
  const detailKey = `findings.${f.id}.detail`;

  // 派生占位符与原始 params 合并后再插值 —— 派生值不覆盖分析器显式给的同名参数
  const params = derivePlaceholders(f.params ?? {});
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
