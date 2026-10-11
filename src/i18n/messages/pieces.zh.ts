/**
 * 组合句片段（组合句 = 分析器给出结构化片段、渲染层按语言组装的一整句）。
 *
 * 与 `findings.*` 的区别：
 * - `findings.*` 是**结论**（有 severity、出现在体检明细里、计入覆盖率）
 * - `pieces.*` 只是详情模板里引用的一段文字（例如「样本：…」），不是结论本身
 *
 * 单独放一份而不是塞进 `findings.*`：`findings` 的完整性测试断言
 * 「标题数 = 详情数」（每条约有 `.detail`），把片段混进去会破坏这个不变式。
 *
 * key 自带全前缀（`pieces.liquidity.sizeEvidence`），与 `findings` 一样是扁平表。
 */
export const piecesZh: Record<string, string> = {
  // ── 流动性：组合句（由分析器拼装、作为参数传给上面的详情模板） ──────
  //
  // 这些不是「结论」，所以没有 severity，但有独立的 key 组 —— 因为它们是
  // **一整句**，中英文的语序往往不同，不能靠拼接。分析器只给出结构化参数
  // （数字与 id），由渲染层按语言选模板。
  //
  // 命名约定：`pieces.*`。与 `findings.*` 的区别是它们不参与覆盖率统计，
  // 也不出现在「逐项体检明细」的结论列表里，只是详情里的一段引用文字。
  'pieces.liquidity.sizeEvidence':
    '样本：最近 {trades} 笔可判定方向的成交{windowText}。买单 {buyCount} 笔共 {buyVol} SOL（平均 {avgBuy}、中位 {medianBuy}），卖单 {sellCount} 笔共 {sellVol} SOL（平均 {avgSell}、中位 {medianSell}，平均是买单的 {sellRatio} 倍）。{maxSell}',
  'pieces.liquidity.sizeEvidence.windowHours': '，跨约 {hours} 小时',
  'pieces.liquidity.sizeEvidence.windowMinutes': '，跨约 {minutes} 分钟',
  'pieces.liquidity.sizeEvidence.maxSell':
    '最大单笔卖单 {maxSellSol} SOL，占卖出总额 {largestSharePct}%',
  'pieces.liquidity.sizeEvidence.maxSellNoLargest': '最大单笔卖单 {maxSellSol} SOL',
  'pieces.liquidity.sizeEvidence.top5': '；前 5 大卖单合计占 {top5Pct}%',
  'pieces.liquidity.sizeEvidence.tail': '。',

  'pieces.liquidity.sellEvidence.head':
    '最大 {n} 笔卖单（签名可在 Solscan 核对，完整明细见下方「大额卖单明细」）：',
  'pieces.liquidity.sellEvidence.row': '{sol} SOL @ {time}',
  'pieces.liquidity.sellEvidence.rowTrader': '，钱包 {trader}',
  'pieces.liquidity.sellEvidence.rowSignature': '，签名 {signature}',
  'pieces.liquidity.sellEvidence.sep': '；',
  'pieces.liquidity.sellEvidence.tail': '。',

  'pieces.liquidity.identity.head': '身份核对（针对最大的 {n} 笔卖单）：',
  'pieces.liquidity.identity.noWindow':
    '本次没取到该代币的最早成交，无法判断这些地址是不是开盘就买入的 —— 不要把它读成「不是狙击手」。',
  'pieces.liquidity.identity.creatorPart': '{creatorCount} 笔来自部署者；',
  'pieces.liquidity.identity.earlyPart': '{earlyCount} 笔来自开盘最早 {windowTrades} 笔成交内的地址（{detail}）',
  'pieces.liquidity.identity.noEarlyPart': '没有一笔来自开盘最早 {windowTrades} 笔成交内的地址',
  'pieces.liquidity.identity.stillHoldingPart':
    '；其中 {n} 个地址当前仍在前 20 大持仓里（最高 {maxPct}%）',
  'pieces.liquidity.identity.noneHoldingPart': '；这些地址都已不在当前前 20 大持仓里',
  'pieces.liquidity.identity.detailRow': '{identity} {sol} SOL',
  'pieces.liquidity.identity.detailSep': '、',
  'pieces.liquidity.identity.sellerIsCreator': '部署者',
  'pieces.liquidity.identity.sellerIsEarlyBuyer': '开盘最早 {windowTrades} 笔内的买家（第 {index} 笔）',
  'pieces.liquidity.identity.windowCaveat':
    '⚠️ 「不在最早窗口内」只代表它不是最早那 25 笔成交的付款方，不等于确定不是早期买家。',

  'pieces.liquidity.unitNote': '（金额为 {unit} 口径，拿不到单笔 SOL 量级，无法进一步核对。）',

  // ── 抛压：口径说明（组合句） ──────────────────────────────────────
  //
  // 原文是分析器拼好的整句，UI 用 `t('report.sellPressure.note1', { note })`
  // 把它插进一句话中间。英文界面下 `{note}` 位置会整段显示中文。
  'pieces.sellPressure.windowNote':
    '{deepPart}用成交窗口内能配对的 {paired} 笔成交估算（窗口共 {total} 笔）；已卖光的钱包不计入抛压；窗口估算的未卖量与实际余额不一致时取较小值。',
  'pieces.sellPressure.windowNote.deepPart':
    '{n} 个地址用逐地址**完整历史**算成本（真实值），其余',

  // ── 合约：LP 销毁的链上核对证据（组合句） ────────────────────────
  'pieces.contract.lpAudit':
    '链上核对该池 LP mint（{lpMint}）：历史铸造 {everMinted}、当前链上供应 {live}，差额 {burned} 已销毁、不可恢复',
  'pieces.contract.lpAudit.unknownMint': '地址未知',

  // ── 钻石手：最强个例句（组合句） ──────────────────────────────────
  'pieces.diamond.topSentence': '拿得最久的是 {address}…：持有 {holdDays} 天，买入 {buys} 次共 {buySol} SOL{holderPctTail}。',
  'pieces.diamond.topSentence.holderPctTail': '，当前占总供应 {holderPct}%',

  // ── 抛压：最强个例句（组合句） ────────────────────────────────────
  'pieces.sellPressure.biggestTail':
    '浮盈最大且仍有筹码的是 {address}…（+{pnlPct}%，还有 {unsold} 枚没卖）。',

  // ── 持币集中度：已知构成列表（组合句） ────────────────────────────
  'pieces.holders.kinds.item': '{kind} {n}',
  'pieces.holders.kinds.sep': '、',
  'pieces.holders.kinds.none': '无法分类',
  'pieces.holders.kind.pool': '流动性池',
  'pieces.holders.kind.dev': 'creator 本人',
  'pieces.holders.kind.related': '与部署者关联',
  'pieces.holders.kind.sniper': '狙击仓位',
  'pieces.holders.kind.retail': '散户',

  'pieces.holders.who.nonDev': '非 dev 钱包',
  'pieces.holders.who.custody': '程序托管仓位（{label}）',

  // ⚠️ 这里必须是中文 —— 曾经被误填成英文（从 en 复制过来），
  // 结果中文界面显示英文池名，而 keys.test.ts 那类测试查不出来
  // （它只验「能查到」，不验「查到的语言对不对」）。
  'pieces.poolLabels.rugcheck': 'RugCheck 池/金库账户',
  'pieces.poolLabels.pumpfunCurve': 'pump.fun 联合曲线',
  'pieces.poolLabels.pumpfunCurveAta': 'pump.fun 联合曲线账户',
  'pieces.poolLabels.dexscreenerPair': 'DexScreener 交易对',
  'pieces.poolLabels.dexscreenerPairAta': 'DexScreener 交易对账户',
  'pieces.poolLabels.observedPool': '观测到的池',
  'pieces.poolLabels.pumpswap': 'PumpSwap 池',
  'pieces.poolLabels.meteoraDlmm': 'Meteora DLMM 池',
  'pieces.poolLabels.raydiumV4': 'Raydium AMM v4 池',
  'pieces.poolLabels.raydiumCpmm': 'Raydium CPMM 池',
  'pieces.poolLabels.orcaWhirlpool': 'Orca Whirlpool 池',

  'pieces.contract.lpEvidence': 'RugCheck 记录的 LP 持有者：{evidence}。',

  'pieces.listSep': '、',

};
