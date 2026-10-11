/**
 * 维度 5：社交热度
 *
 * 关键认知：
 * - 链上拿不到社交数据，现实里靠 X/Twitter 提及量、TG 群活跃、DexScreener trending。
 * - 刷量识别：账号创建时间批量集中、粉丝/关注比异常、模板化文案、
 *   转发远多于回复、互动时间分布机器规律、TG 增长曲线阶跃而非平滑。
 * - ⚠️ 最重要：**不要把「账号新」等同于 bot**。meme 玩家本来就开新号，
 *   真实社区早期也是低质量账号。要看**行为聚类**，不是单看注册时间。
 * - 本维度不做否决，最高压到 85 —— 社交热度是软指标，不该一票判死。
 */
import { THRESHOLDS, scoreFromFindings } from '../constants';
import type { DimensionResult, Finding, ScanInput, Severity } from '../types';

export function analyzeSocial(data: ScanInput): DimensionResult {
  const s = data.social ?? {};
  const t = THRESHOLDS.social;
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

  const mentions = s.mentions24h ?? 0;
  const growth = s.mentionGrowthPct ?? 0;
  const engagementRatio = s.engagementRatio;
  const botRatio = s.suspectedBotRatio ?? 0;
  const hasData = Object.keys(s).length > 0;

  if (!hasData) {
    add(
      'medium',
      'social.noData',
      '社交数据缺失',
      '未能获取社交热度数据。链上无法推算社区质量，此项不计入评分，需要你自行核实项目方的 X / TG。',
    );
    return {
      dimension: 'social',
      label: '社交热度',
      score: 0,
      vetoed: false,
      findings,
      metrics: { mentions24h: 0, botRatio: 0, available: 0 },
    };
  }

  // ── 热度水平 ────────────────────────────────────────────────────
  if (mentions === 0) {
    add('high', 'social.zeroMentions', '零社交提及', '过去 24 小时未检测到任何社交提及。没有社区的项目很难有接盘深度。');
  } else if (mentions < t.lowMentionWarn) {
    add('medium', 'social.lowHype', '社交热度偏低', `24h 仅 ${mentions} 次提及，热度不足。`, { mentions });
  } else {
    add('good', 'social.goodHype', '社交热度充足', `24h ${mentions} 次提及，环比 ${growth >= 0 ? '+' : ''}${growth}%。`, {
      mentions,
      growth: `${growth >= 0 ? '+' : ''}${growth}`,
    });
  }

  // ── 刷量识别：行为聚类，而非「账号新」───────────────────────────
  if (botRatio >= t.botRatioDanger) {
    add(
      botRatio >= 0.8 ? 'critical' : 'high',
      'social.suspectedBots',
      '社交热度疑似刷量',
      `约 ${(botRatio * 100).toFixed(0)}% 的提及来自疑似机器人账号` +
        '（同批账号集中出现在多个 meme 下、模板化文案、互动时间分布异常）。',
      { pct: (botRatio * 100).toFixed(0) },
    );
  } else if (botRatio > 0.35) {
    add('medium', 'social.qualityDoubt', '社交互动质量存疑', `${(botRatio * 100).toFixed(0)}% 提及来自疑似 bot，真实社区占比需人工确认。`, {
      pct: (botRatio * 100).toFixed(0),
    });
  }

  // 转发远多于回复 —— 典型的买量特征
  if (s.retweetToReplyRatio !== undefined && s.retweetToReplyRatio > 8) {
    add('medium', 'social.retweetHeavy', '转发远多于回复', `转推/回复比 ${s.retweetToReplyRatio.toFixed(1)}，买量刷屏的常见形态（真实社区以讨论为主）。`, {
      ratio: s.retweetToReplyRatio.toFixed(1),
    });
  }

  if (s.telegramGrowthSpiky) {
    add('medium', 'social.tgSpiky', 'TG 群成员阶跃式增长', '成员数是突增而非平滑增长，符合买粉特征。');
  }

  if (s.uniqueAuthors !== undefined && mentions > 0) {
    const perAuthor = mentions / Math.max(s.uniqueAuthors, 1);
    if (perAuthor > 12) {
      add('medium', 'social.fewAuthors', '提及高度集中在少数账号', `平均每个账号发 ${perAuthor.toFixed(1)} 条，说明是靠少数账号反复刷屏。`, {
        perAuthor: perAuthor.toFixed(1),
      });
    }
  }

  if (growth < 0 && mentions > 0) {
    add('medium', 'social.decaying', '热度正在衰减', `提及量环比 ${growth}%，社区关注度在下降。`, { growth });
  }

  if (engagementRatio !== undefined && engagementRatio < 0.15 && mentions > t.lowMentionWarn) {
    add('medium', 'social.lowEngagement', '互动率偏低', `真实互动仅占 ${(engagementRatio * 100).toFixed(0)}%，热度可能虚高。`, {
      pct: (engagementRatio * 100).toFixed(0),
    });
  }

  return {
    dimension: 'social',
    label: '社交热度',
    // 上限 85：社交维度不做否决，也不该单独把总分推到「极高风险」
    score: Math.min(85, scoreFromFindings(findings, 85)),
    vetoed: false,
    findings,
    metrics: {
      mentions24h: mentions,
      mentionGrowthPct: growth,
      botRatio,
      uniqueAuthors: s.uniqueAuthors ?? 0,
      available: 1,
    },
  };
}
