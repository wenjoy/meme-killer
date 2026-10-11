/**
 * 分析器结论文案（中文）。
 *
 * key 约定见 `src/i18n/finding.ts`：
 * - `findings.<id>`        → 标题
 * - `findings.<id>.detail` → 详情
 *
 * 这里的文案**与 `src/core/analyzers/*.ts` 里的中文回退逐字一致**：
 * 迁移期两边并存，分析器仍带着 `zhTitle`/`zhDetail` 作为兜底，
 * 查表失败时用它渲染。因此这个文件不是「另一份文案」，而是同一份文案的
 * 集中存放处 —— 改这里而不改分析器，两边就会漂移。
 *
 * 占位符用 `{name}`，名字必须与 `Finding.params` 的 key 一致
 * （由 `findings.i18n.test.ts` 断言）。
 */
export const findingsZh: Record<string, string> = {
  // ── 合约安全 ──────────────────────────────────────────────────────
  'findings.contract.noData': '合约数据缺失',
  'findings.contract.noData.detail':
    '未能读取 mint 账户，mint/freeze 权限与 Token-2022 扩展是否安全均无法判断。请勿据此认为「没有发现问题」。',
  'findings.contract.mintNotRevoked': '铸币权限未放弃',
  'findings.contract.mintNotRevoked.detail':
    'mintAuthority = {authority}。项目方可无限增发，稀释你的持仓。',
  'findings.contract.freezeNotRevoked': '冻结权限未放弃',
  'findings.contract.freezeNotRevoked.detail':
    'freezeAuthority = {authority}。项目方可冻结你的账户，让你无法卖出。',
  'findings.contract.authoritiesRevoked': '权限已放弃',
  'findings.contract.authoritiesRevoked.detail':
    'mint 与 freeze authority 均为 null，符合 Pump.fun 正常发币状态。',
  'findings.contract.authorityUnknown': '权限状态未知',
  'findings.contract.authorityUnknown.detail':
    '未能确认 mint/freeze authority 是否已放弃，需人工核实。',
  'findings.contract.maliciousExtension': '作恶扩展：{label}',
  'findings.contract.maliciousExtension.detail': '{why}',
  'findings.contract.extension': '扩展：{label}',
  'findings.contract.extension.detail': '{why}',
  'findings.contract.token2022Clean': 'Token-2022 代币，未检出作恶扩展',
  'findings.contract.token2022Clean.detail':
    '新版 pump.fun 代币本身就发行在 Token-2022 上，使用该程序不是风险信号。关键看扩展：未检出 transferHook / permanentDelegate 等可限制卖出的扩展。',
  'findings.contract.transferFee': '存在转移税',
  'findings.contract.transferFee.detail': '卖出税 {feePct}%，会显著侵蚀利润。',
  'findings.contract.lpNotCreated': '尚未建立 LP',
  'findings.contract.lpNotCreated.detail': '仍在 bonding curve 阶段，没有真实流动性池。',
  'findings.contract.lpBurned': 'LP 已销毁',
  'findings.contract.lpBurned.detail': '流动性凭证已永久销毁，无法撤池（{lockPct}）。{auditTextTail}',
  'findings.contract.lpBurnedNoPct': 'LP 已销毁',
  'findings.contract.lpBurnedNoPct.detail': '流动性凭证已永久销毁，无法撤池。{auditTextTail}',
  'findings.contract.lpLockedByLocker': 'LP 已锁定/不可撤',
  'findings.contract.lpLockedByLocker.detail':
    '由 {locker} 持有{unlockAtText}{lockPctText}，无法撤池。',
  'findings.contract.lpLockedByProgram': 'LP 已锁定/不可撤',
  'findings.contract.lpLockedByProgram.detail':
    '由锁仓程序持有{unlockAtText}{lockPctText}，无法撤池。',
  'findings.contract.lpLockedNoLocker': 'LP 已锁定/不可撤',
  'findings.contract.lpLockedNoLocker.detail':
    '锁定或销毁比例已达上限，未提供锁仓方{unlockAtText}{lockPctText}，无法撤池。',
  'findings.contract.lpPartiallyBurned': 'LP 已销毁 {burnedPct}%',
  'findings.contract.lpPartiallyBurned.detail':
    '{auditText}；即 {burnedPct}% 的 LP 已销毁，其余 {livePct}% 仍在流通。',
  'findings.contract.lpPartiallyBurnedNoAudit': 'LP 已销毁 {burnedPct}%',
  'findings.contract.lpPartiallyBurnedNoAudit.detail':
    '；即 {burnedPct}% 的 LP 已销毁，其余 {livePct}% 仍在流通。',
  'findings.contract.relatedHoldsLp': '与部署者关联的钱包持有流通中的 LP',
  'findings.contract.relatedHoldsLp.detail':
    '链上核对：与部署者关联的地址（创建交易的付款方、或给 creator 首笔交易出资的钱包）持有全池 LP 的约 {ofPoolPct}%（占仍在流通部分的 {livePct}%），涉及 {holderCount} 个地址 —— 这些地址可以随时提走对应份额的流动性。除非能证明它与项目方无关（例如是公开的做市商），否则应按项目方撤池风险看待。{lpEvidenceText}',
  'findings.contract.relatedHoldsLpNoLive': '与部署者关联的钱包持有流通中的 LP',
  'findings.contract.relatedHoldsLpNoLive.detail':
    '链上核对：与部署者关联的地址（创建交易的付款方、或给 creator 首笔交易出资的钱包）持有全池 LP 的约 {ofPoolPct}%，涉及 {holderCount} 个地址 —— 这些地址可以随时提走对应份额的流动性。除非能证明它与项目方无关（例如是公开的做市商），否则应按项目方撤池风险看待。{lpEvidenceText}',
  'findings.contract.relatedHoldsLpWithEvidence': '与部署者关联的钱包持有流通中的 LP',
  'findings.contract.relatedHoldsLpWithEvidence.detail':
    '链上核对：与部署者关联的地址（创建交易的付款方、或给 creator 首笔交易出资的钱包）持有全池 LP 的约 {ofPoolPct}%（占仍在流通部分的 {livePct}%），涉及 {holderCount} 个地址 —— 这些地址可以随时提走对应份额的流动性。除非能证明它与项目方无关（例如是公开的做市商），否则应按项目方撤池风险看待。{lpEvidenceText}',
  'findings.contract.relatedHoldsLpNoLiveWithEvidence': '与部署者关联的钱包持有流通中的 LP',
  'findings.contract.relatedHoldsLpNoLiveWithEvidence.detail':
    '链上核对：与部署者关联的地址（创建交易的付款方、或给 creator 首笔交易出资的钱包）持有全池 LP 的约 {ofPoolPct}%，涉及 {holderCount} 个地址 —— 这些地址可以随时提走对应份额的流动性。除非能证明它与项目方无关（例如是公开的做市商），否则应按项目方撤池风险看待。{lpEvidenceText}',
  'findings.contract.creatorHoldsLp': '项目方持有流通中的 LP',
  'findings.contract.creatorHoldsLp.detail':
    '链上核对：creator 地址持有流通 LP 的约 {creatorPct}%（相当于全池 LP 的 {ofPoolPct}%），可以随时撤走对应份额的流动性。{lpEvidenceText}',
  'findings.contract.creatorHoldsLpNoPool': '项目方持有流通中的 LP',
  'findings.contract.creatorHoldsLpNoPool.detail':
    '链上核对：creator 地址持有流通 LP 的约 {creatorPct}%，可以随时撤走对应份额的流动性。{lpEvidenceText}',
  'findings.contract.creatorHoldsLpWithEvidence': '项目方持有流通中的 LP',
  'findings.contract.creatorHoldsLpWithEvidence.detail':
    '链上核对：creator 地址持有流通 LP 的约 {creatorPct}%（相当于全池 LP 的 {ofPoolPct}%），可以随时撤走对应份额的流动性。{lpEvidenceText}',
  'findings.contract.creatorHoldsLpNoPoolWithEvidence': '项目方持有流通中的 LP',
  'findings.contract.creatorHoldsLpNoPoolWithEvidence.detail':
    '链上核对：creator 地址持有流通 LP 的约 {creatorPct}%，可以随时撤走对应份额的流动性。{lpEvidenceText}',
  'findings.contract.lpInLocker': '流通中的 LP 主要在锁仓程序里',
  'findings.contract.lpInLocker.detail':
    'RugCheck 实测：{lockPct}；链上核对到 {lockerPct}% 的 LP 由锁仓/线性解锁合约持有，普通钱包可随时提走的仅约 {withdrawablePct}%。{lpEvidenceText}{accountGapNote}⚠️ 锁仓会按计划逐步解锁，解锁后即可提走 —— 请留意解锁时间，别把它当成永久锁定。',
  'findings.contract.lpInLockerNoPct': '流通中的 LP 主要在锁仓程序里',
  'findings.contract.lpInLockerNoPct.detail':
    'RugCheck 实测；链上核对到 {lockerPct}% 的 LP 由锁仓/线性解锁合约持有，普通钱包可随时提走的仅约 {withdrawablePct}%。{lpEvidenceText}{accountGapNote}⚠️ 锁仓会按计划逐步解锁，解锁后即可提走 —— 请留意解锁时间，别把它当成永久锁定。',
  'findings.contract.lpConcentrated': '流通中的 LP 集中在一个地址',
  'findings.contract.lpConcentrated.detail':
    '链上核对：流通中的 LP 有约 {topPct}% 由单一地址持有（相当于全池 LP 的 {ofPoolPct}%），该地址撤走时池子流动性会同步减少这么多。{lpEvidenceText}',
  'findings.contract.lpConcentratedNoPool': '流通中的 LP 集中在一个地址',
  'findings.contract.lpConcentratedNoPool.detail':
    '链上核对：流通中的 LP 有约 {topPct}% 由单一地址持有，该地址撤走时池子流动性会同步减少这么多。{lpEvidenceText}',
  'findings.contract.lpConcentratedWithEvidence': '流通中的 LP 集中在一个地址',
  'findings.contract.lpConcentratedWithEvidence.detail':
    '链上核对：流通中的 LP 有约 {topPct}% 由单一地址持有（相当于全池 LP 的 {ofPoolPct}%），该地址撤走时池子流动性会同步减少这么多。{lpEvidenceText}',
  'findings.contract.lpConcentratedNoPoolWithEvidence': '流通中的 LP 集中在一个地址',
  'findings.contract.lpConcentratedNoPoolWithEvidence.detail':
    '链上核对：流通中的 LP 有约 {topPct}% 由单一地址持有，该地址撤走时池子流动性会同步减少这么多。{lpEvidenceText}',
  'findings.contract.lpDistributed': '流通中的 LP 分散在多个地址',
  'findings.contract.lpDistributed.detail':
    '约 {livePct}% 的 LP 仍在流通，由 {holderCount} 个地址分散持有（最大一个占流通量的 {topPct}%）。这些是各自添加流动性的持有人，撤走自己那份属于正常的 AMM 行为，不构成项目方撤池跑路 —— 但无论如何，提走 LP 都会让池子深度同步下降。{lpEvidenceText}',
  'findings.contract.lpDistributedNoLive': '流通中的 LP 分散在多个地址',
  'findings.contract.lpDistributedNoLive.detail':
    '由 {holderCount} 个地址分散持有（最大一个占流通量的 {topPct}%）。这些是各自添加流动性的持有人，撤走自己那份属于正常的 AMM 行为，不构成项目方撤池跑路 —— 但无论如何，提走 LP 都会让池子深度同步下降。{lpEvidenceText}',
  'findings.contract.lpDistributedWithRelated': '流通中的 LP 分散在多个地址',
  'findings.contract.lpDistributedWithRelated.detail':
    '约 {livePct}% 的 LP 仍在流通，由 {holderCount} 个地址分散持有（最大一个占流通量的 {topPct}%），其中 {relatedCount} 个是与部署者关联的地址（见上一条，不能算作第三方流动性）。除关联地址那一份之外，其余是各自添加流动性的持有人，撤走自己那份属于正常的 AMM 行为（关联地址的部分见上一条，不能一并算作「第三方流动性」）—— 但无论如何，提走 LP 都会让池子深度同步下降。{lpEvidenceText}',
  'findings.contract.lpDistributedNoLiveWithRelated': '流通中的 LP 分散在多个地址',
  'findings.contract.lpDistributedNoLiveWithRelated.detail':
    '由 {holderCount} 个地址分散持有（最大一个占流通量的 {topPct}%），其中 {relatedCount} 个是与部署者关联的地址（见上一条，不能算作第三方流动性）。除关联地址那一份之外，其余是各自添加流动性的持有人，撤走自己那份属于正常的 AMM 行为（关联地址的部分见上一条，不能一并算作「第三方流动性」）—— 但无论如何，提走 LP 都会让池子深度同步下降。{lpEvidenceText}',
  'findings.contract.lpFewWallets': '流通中的 LP 由少数地址持有',
  'findings.contract.lpFewWallets.detail':
    '链上核对：{withdrawablePct}% 的 LP 由 {holderCount} 个普通钱包持有（最大一个占流通量的 {topPct}%），这些地址可以随时提走对应份额的流动性。{lpEvidenceText}',
  'findings.contract.lpFewWalletsNoTop': '流通中的 LP 由少数地址持有',
  'findings.contract.lpFewWalletsNoTop.detail':
    '链上核对：{withdrawablePct}% 的 LP 由 {holderCount} 个普通钱包持有，这些地址可以随时提走对应份额的流动性。{lpEvidenceText}',
  'findings.contract.lpFewWalletsWithEvidence': '流通中的 LP 由少数地址持有',
  'findings.contract.lpFewWalletsWithEvidence.detail':
    '链上核对：{withdrawablePct}% 的 LP 由 {holderCount} 个普通钱包持有（最大一个占流通量的 {topPct}%），这些地址可以随时提走对应份额的流动性。{lpEvidenceText}',
  'findings.contract.lpFewWalletsNoTopWithEvidence': '流通中的 LP 由少数地址持有',
  'findings.contract.lpFewWalletsNoTopWithEvidence.detail':
    '链上核对：{withdrawablePct}% 的 LP 由 {holderCount} 个普通钱包持有，这些地址可以随时提走对应份额的流动性。{lpEvidenceText}',
  'findings.contract.lpUnlockedSingleHolder': 'LP 未锁未销毁',
  'findings.contract.lpUnlockedSingleHolder.detail':
    'LP 未锁未销毁，且由单一地址 {holder} 持有（{lockPct}），该地址可随时撤走全部流动性。{lpEvidenceText}',
  'findings.contract.lpUnlockedSingleHolderNoPct': 'LP 未锁未销毁',
  'findings.contract.lpUnlockedSingleHolderNoPct.detail':
    'LP 未锁未销毁，且由单一地址 {holder} 持有，该地址可随时撤走全部流动性。{lpEvidenceText}',
  'findings.contract.lpUnlockedSingleHolderWithEvidence': 'LP 未锁未销毁',
  'findings.contract.lpUnlockedSingleHolderWithEvidence.detail':
    'LP 未锁未销毁，且由单一地址 {holder} 持有（{lockPct}），该地址可随时撤走全部流动性。{lpEvidenceText}',
  'findings.contract.lpUnlockedSingleHolderNoPctWithEvidence': 'LP 未锁未销毁',
  'findings.contract.lpUnlockedSingleHolderNoPctWithEvidence.detail':
    'LP 未锁未销毁，且由单一地址 {holder} 持有，该地址可随时撤走全部流动性。{lpEvidenceText}',
  'findings.contract.lpUnlockedNoEvidence': 'LP 未锁定也未销毁',
  'findings.contract.lpUnlockedNoEvidence.detail':
    'RugCheck 实测{lockPctText}；链上核对到其中 {withdrawablePct}% 的 LP 由普通钱包持有，这些地址可以随时提走对应流动性。{accountGapNote}⚠️ 没有持有者明细时不要默认是项目方。',
  'findings.contract.lpUnlockedWithEvidence': 'LP 未锁定也未销毁',
  'findings.contract.lpUnlockedWithEvidence.detail':
    'RugCheck 实测{lockPctText}；链上核对到其中 {withdrawablePct}% 的 LP 由普通钱包持有，这些地址可以随时提走对应流动性。{accountGapNote}RugCheck 记录的 LP 持有者：{lpEvidenceText} —— 请按此核对可撤部分在谁手里。',
  'findings.contract.lpHoldersUnverifiable': '流通中的 LP 持有人无法核实',
  'findings.contract.lpHoldersUnverifiable.detail':
    'RugCheck 口径：{lockPct}（链上核对显示这个比例就是已不在流通中的 LP），但本次没拿到 LP 持有者明细，无法确认剩余流通部分在谁手里 —— 既不能据此判定撤池风险，也不能当成已锁定。{lpMint}',
  'findings.contract.lpHoldersUnverifiableNoPct': '流通中的 LP 持有人无法核实',
  'findings.contract.lpHoldersUnverifiableNoPct.detail':
    'RugCheck 口径（链上核对显示这个比例就是已不在流通中的 LP），但本次没拿到 LP 持有者明细，无法确认剩余流通部分在谁手里 —— 既不能据此判定撤池风险，也不能当成已锁定。{lpMint}',
  'findings.contract.lpLockUnknown': 'LP 锁定状态未知',
  'findings.contract.lpLockUnknown.detail':
    '已确认存在流动性池，但未能核实 LP 已锁或已销毁，存在撤池风险。',
  'findings.contract.mutableMetadata': 'Metadata 可变',
  'findings.contract.mutableMetadata.detail': '项目方可修改名称/图标，常见但可被用于伪装。',

  // ── 流动性 & 资金流 ────────────────────────────────────────────────
  'findings.liquidity.noData': '流动性数据缺失',
  'findings.liquidity.noData.detail':
    '未能获取池深度、成交量与买卖笔数，无法判断抽池、刷量与蜜罐风险。此项不计入评分，请自行在 DexScreener 上核实。',
  'findings.liquidity.rugDetected': 'RugCheck 判定该代币已 rug',
  'findings.liquidity.rugDetected.detail':
    'RugCheck 依据链上流动性与价格历史已把该代币标记为 rug。此类标的没有讨论仓位的意义。',
  'findings.liquidity.lowCurveReserves': 'curve 内真实 SOL 极低',
  'findings.liquidity.lowCurveReserves.detail':
    '仅 {sol} SOL，价格极易被小额资金砸穿，滑点会非常高。',
  'findings.liquidity.notGraduated': '尚未毕业（仍在 bonding curve）',
  'findings.liquidity.notGraduated.detail':
    'curve 内真实 SOL {sol}。此阶段没有真实流动性池，只有曲线深度。',
  'findings.liquidity.graduated': '已毕业',
  'findings.liquidity.graduated.detail': '已迁移至 AMM，具备真实流动性池。',
  'findings.liquidity.honeypot': '买入活跃但几乎无法卖出',
  'findings.liquidity.honeypot.detail':
    '{totalTrades} 笔成交中卖单仅 {sellTrades} 笔（{countSharePct}%）。买单一边倒通常不是强势，而是卖出被限制 —— 典型的蜜罐（honeypot）特征。',
  'findings.liquidity.sellPressureDominant': '抛压主导',
  'findings.liquidity.sellPressureDominant.detail':
    '卖方金额占比 {sellSharePct}%，净流入 {netInflowSol} SOL。{sizeEvidence}',
  'findings.liquidity.sellPressureDominantNoSol': '抛压主导',
  'findings.liquidity.sellPressureDominantNoSol.detail':
    '卖方金额占比 {sellSharePct}%（金额为 {volumeUnit} 口径，无法换算净流入）。{sizeEvidence}',
  'findings.liquidity.balancedInflow': '买卖均衡且净流入为正',
  'findings.liquidity.balancedInflow.detail':
    '卖方金额占比 {sellSharePct}%，净流入 +{netInflowSol} SOL，买盘略强且卖压正常，换手健康。',
  'findings.liquidity.countVolumeDivergence': '笔数与金额背离',
  'findings.liquidity.countVolumeDivergence.detail':
    '买单笔数是卖单 {countRatio} 倍，但买入金额只有卖出的 {volRatioPct}%。小额买盘撑笔数、大额卖盘出货。{sizeEvidence}{sellEvidence}',
  'findings.liquidity.countVolumeDivergenceNoSol': '笔数与金额背离',
  'findings.liquidity.countVolumeDivergenceNoSol.detail':
    '买单笔数是卖单 {countRatio} 倍，但买入金额只有卖出的 {volRatioPct}%。小额买盘撑笔数、大额卖盘出货。（金额为 {volumeUnit} 口径，拿不到单笔 SOL 量级，无法进一步核对。）{sellEvidence}',
  'findings.liquidity.washTrading': '疑似刷量',
  'findings.liquidity.washTrading.detail':
    '{totalTrades} 笔成交、成交额 {totalVolSol} SOL，净流入仅 {netInflowSol} SOL（占成交额 {netRatioPct}%），高笔数几乎零净流入通常是机器人对倒制造热度。',
  'findings.liquidity.washTradeUnknown': '刷量无法判定',
  'findings.liquidity.washTradeUnknown.detail':
    '拿到了 {totalTrades} 笔成交，但拿不到 SOL 口径的买卖金额（需要 Helius Enhanced API），无法用净流入识别对倒刷量，只能看笔数。',

  // ── 持仓集中度 ────────────────────────────────────────────────────
  'findings.holders.noData': '持仓数据缺失',
  'findings.holders.noData.detail':
    '未能获取持有者分布，无法判断是否存在庄家控盘。此项不计入评分，请到 RugCheck / Solscan 查看 holders 分布。',
  'findings.holders.caliberNotApplicable': '持有人仅 {holderCount} 个 —— 百分比口径在此不适用',
  'findings.holders.caliberNotApplicable.detail':
    '这个代币只有 {holderCount} 个持币地址（低于 {minHolders} 个的统计下限），前 10 名各自的占比已失去统计意义：剔除池/销毁后的流通盘本身很小，少数几个地址就能占满分母。实测这类代币用「占流通盘」算出来的集中度中位数是 90–100%，而换回「占总供应」只有 31–51% —— 差 20–49 个百分点，说明是**分母失真**而不是真的更集中。\n前 10 名的已知构成：{kinds}。⚠️ 人少本身就是最大的风险：没有出货深度，任何一笔卖出都可能砸穿价格。请直接参考持仓明细逐个地址核对，不要依赖上面的集中度数字。',
  'findings.holders.excludedPoolBurnFull': '已剔除池与销毁地址',
  'findings.holders.excludedPoolBurnFull.detail':
    '剔除 {excludedPct}% 的池 / burn / 锁仓持仓后再计算集中度，避免把正常流动性误判为庄家控盘。真实流通盘 {circulatingPct}%。',
  'findings.holders.excludedPoolBurnSample': '已剔除池与销毁地址',
  'findings.holders.excludedPoolBurnSample.detail':
    '剔除 {excludedPct}% 的池 / burn / 锁仓持仓后再计算集中度，避免把正常流动性误判为庄家控盘。真实流通盘 {circulatingPct}%。（本次用的是前 20 名持仓样本；加载全量持有人分布后这个比例会更准。）',
  'findings.holders.top10Danger': 'Top10 持仓过度集中',
  'findings.holders.top10Danger.detail':
    '剔除池 / burn / 锁仓后，前 10 大持有者占流通盘 {top10Pct}%（阈值 {threshold}%）。少数地址可轻易砸盘。（该代币有 {holderCount} 个持有人，百分比口径有效。）',
  'findings.holders.top10Warn': 'Top10 持仓偏集中',
  'findings.holders.top10Warn.detail':
    '前 10 大持有者占流通盘 {top10Pct}%，超过 {threshold}% 警戒线。',
  'findings.holders.top10Healthy': '持仓分布健康',
  'findings.holders.top10Healthy.detail': '前 10 大持有者仅占流通盘 {top10Pct}%。',
  'findings.holders.singleWhale': '存在单一巨鲸',
  'findings.holders.singleWhale.detail':
    '{who} {address} 持有流通盘的 {circulatingPct}%（{supplyPct}% 的总供应量，流通盘 {circulatingDenominatorPct}%），其抛售会造成显著滑点。',
  'findings.holders.singleWhaleCustody': '存在单一巨鲸',
  'findings.holders.singleWhaleCustody.detail':
    '{who} {address} 持有流通盘的 {circulatingPct}%（{supplyPct}% 的总供应量，流通盘 {circulatingDenominatorPct}%），其抛售会造成显著滑点。（托管不等于锁定：多签可随时签名转出，故仍计入巨鲸判定。）',
  'findings.holders.sniperHeavy': '狙击钱包筹码偏多',
  'findings.holders.sniperHeavy.detail':
    '最早成交的钱包目前合计持有流通盘的 {circulatingPct}%（占总供应 {supplyPct}%），随时可能砸盘。（已排除 creator 自买；只统计仍留在前 20 大持仓里的部分，因此是下限。未知时不会出现在这里。）',
  'findings.holders.devClusterHigh': 'dev 持仓偏高',
  'findings.holders.devClusterHigh.detail':
    'creator 地址持有流通盘的 {devCirculatingPct}%（占总供应 {devSupplyPct}%）、与部署者关联的钱包持有流通盘的 {relatedCirculatingPct}%（占总供应 {relatedSupplyPct}%），合计 {clusterCirculatingPct}% 流通盘（阈值 {threshold}%）。',
  'findings.holders.devClusterReasonable': 'dev 持仓在合理范围',
  'findings.holders.devClusterReasonable.detail':
    'creator 地址持有流通盘的 {devCirculatingPct}%（占总供应 {devSupplyPct}%），合计 {clusterCirculatingPct}% 流通盘（占总供应 {clusterSupplyPct}%）。',
  'findings.holders.devClusterReasonableWithRelated': 'dev 持仓在合理范围',
  'findings.holders.devClusterReasonableWithRelated.detail':
    'creator 地址持有流通盘的 {devCirculatingPct}%（占总供应 {devSupplyPct}%），关联钱包持有流通盘的 {relatedCirculatingPct}%（占总供应 {relatedSupplyPct}%），合计 {clusterCirculatingPct}% 流通盘（占总供应 {clusterSupplyPct}%）。',
  'findings.holders.fewHoldersConcentrated': '持有人少且集中',
  'findings.holders.fewHoldersConcentrated.detail':
    '仅 {holderCount} 个持有人，配合 {top10Pct}% 的集中度，缺乏出货深度。',
  'findings.holders.programCustody': '程序托管持仓占流通盘 {circulatingPct}%（未剔除）',
  'findings.holders.programCustody.detail':
    '{count} 个仓位由程序控制（{labels}），合计 {circulatingPct}% 流通盘（占总供应 {supplyPct}%）。⚠️ 多签/托管**不是时间锁**，可随时签名转出，因此仍然计入集中度，只是单独列出让你看得见。',
  'findings.holders.timelockKnownUnlock': '锁仓持仓 {timelockPct}%（已从集中度中剔除）',
  'findings.holders.timelockKnownUnlock.detail':
    '{count} 个时间锁仓仓位（{labels}）合计 {timelockPct}%，解锁前无法卖出，因此不计入 Top10 与巨鲸判断。解锁时间：首次 {firstUnlockAt}，全部解锁 {allUnlockAt}。⚠️ 锁仓会随时间线性释放，解锁后即可抛售。',
  'findings.holders.timelockUnknownUnlock': '锁仓持仓 {timelockPct}%（已从集中度中剔除）',
  'findings.holders.timelockUnknownUnlock.detail':
    '{count} 个时间锁仓仓位（{labels}）合计 {timelockPct}%，解锁前无法卖出，因此不计入 Top10 与巨鲸判断。⚠️ 解锁时间读不到，如实标为「待接入」——这不是「已解锁」，到期日需另行留意。',

  // ── 开发者 ────────────────────────────────────────────────────────
  'findings.developer.noData': '开发者数据缺失',
  'findings.developer.noData.detail':
    '未采集到部署者信息。历史 rug 记录、dev 卖出比例、关联钱包都需要索引器支持，本次无法判断 —— 请人工核查 creator 地址的历史。',
  'findings.developer.creatorUnknown': '部署者身份未知',
  'findings.developer.creatorUnknown.detail':
    '三级来源（curve 程序状态、metadata、创建交易）都没能确定 creator，开发者维度的结论无法归属到任何具体地址。',
  'findings.developer.creatorInferred': '部署者身份为推断值',
  'findings.developer.creatorInferred.detail':
    '读不到 pump.fun 曲线或 metadata 里的 creator，只能取创建交易的付款方 `{creator}`作为部署者 —— 用打包器/launchpad 发币时，这个地址是代付手续费的钱包，不是真正的 dev。下面的 dev 买卖结论请按此折价看待。',
  'findings.developer.launchWalletDiffers': '创建钱包与 creator 不是同一个地址',
  'findings.developer.launchWalletDiffers.detail':
    '本报告的开发者维度按 creator `{creator}` 计算，而创建交易的付款方是 `{launchWallet}` —— 付费发币的钱包不一定是 dev（打包器 / launchpad 发币、再把 creator 转给真 dev 很常见），两者不要混为一谈。',
  'findings.developer.noPriorTokens': '无历史发币记录',
  'findings.developer.noPriorTokens.detail':
    'creator 是全新钱包。既没有前科，也没有可验证的成功履历 —— 无法据此加分。',
  'findings.developer.priorTokensUnverified': '历史发币结局未核实',
  'findings.developer.priorTokensUnverified.detail':
    '该 creator 还发行过 {count} 个代币，但本工具不做价格/流动性历史回溯，无法判断其中是否有 rug —— 请人工核对该地址的历史，不要当成「记录干净」。',
  'findings.developer.bulkLaunch': '短期内批量发币',
  'findings.developer.bulkLaunch.detail':
    '该 creator 近 7 天发行了 {count} 个代币。广撒网式发币通常意味着不打算长期经营。',
  'findings.developer.creatorDumped': '部署者已清仓',
  'findings.developer.creatorDumped.detail':
    'creator 已卖出全部持仓。项目方都跑光了，没有任何理由留下。',
  'findings.developer.devHeavyDump': '部署者大额抛售',
  'findings.developer.devHeavyDump.detail': '已卖出其买入量的 {soldPct}%。',
  'findings.developer.devHeavyDumpFast': '部署者大额抛售',
  'findings.developer.devHeavyDumpFast.detail':
    '已卖出其买入量的 {soldPct}%，且首次卖出发生在发币后 {minutes} 分钟，属于快速出货。',
  'findings.developer.devSold': '部署者有过卖出',
  'findings.developer.devSold.detail':
    '按可获取的交易记录，卖出量约占其买入量的 {soldPct}%（历史窗口有限，该比例可能失真）。注意：部分回收成本在 meme 圈很常见，本身不等于 rug；但链上持仓余额未能确认，请自行核对 creator 地址的当前持仓。',
  'findings.developer.devHeld': '部署者未卖出',
  'findings.developer.devHeld.detail':
    'creator 仍持有其买入量的 {holdingPct}%，未见卖出行为。',
  'findings.developer.linkedWallet': 'creator 的首笔资金来自其它钱包',
  'findings.developer.linkedWallet.detail':
    '首笔交易的资金来自 {wallet}。这只能说明资金来源，无法据此判断是否为中介/混币 —— 请自行核对该钱包的性质。',

  // ── 钻石手 ────────────────────────────────────────────────────────
  'findings.diamond.noData': '持仓行为无法分析',
  'findings.diamond.noData.detail':
    '没有取到逐地址成交明细（Helius 增强接口不可用或该代币还没有成交），因此无法判断谁买了不卖。这不是「没有钻石手」，是这一项没数据。',
  'findings.diamond.windowCoverageLow': '成交窗口只覆盖了 {coveragePct}% 的时间跨度',
  'findings.diamond.windowCoverageLow.detail':
    '最近成交只取到最后 {trades} 笔、最早只取到前 {earlyTrades} 笔，因此下面的人数与比例**只是窗口内的观测值，几乎肯定低估**：缺口期间买入并一直持有的钱包不在样本里。要拿到完整画像需要逐地址拉历史（未实现）。',
  'findings.diamond.windowCoverageLowWithGap': '成交窗口只覆盖了 {coveragePct}% 的时间跨度',
  'findings.diamond.windowCoverageLowWithGap.detail':
    '最近成交只取到最后 {trades} 笔、最早只取到前 {earlyTrades} 笔，中间有约 {gapDays} 天没有数据。因此下面的人数与比例**只是窗口内的观测值，几乎肯定低估**：缺口期间买入并一直持有的钱包不在样本里。要拿到完整画像需要逐地址拉历史（未实现）。',
  'findings.diamond.noLongTermHolders': '没有发现长期持有的钱包',
  'findings.diamond.noLongTermHolders.detail':
    '在 {analyzed} 个可分析的钱包里，没有一个符合「只买未卖、仍持仓、持有超过 {minHoldDays} 天」。',
  'findings.diamond.noLongTermHoldersWithGap': '没有发现长期持有的钱包',
  'findings.diamond.noLongTermHoldersWithGap.detail':
    '在 {analyzed} 个可分析的钱包里，没有一个符合「只买未卖、仍持仓、持有超过 {minHoldDays} 天」。⚠️ 成交窗口中间有约 {gapDays} 天没拉到，所以这只能说「窗口内没看到」，不能断言没人长期持有。',
  'findings.diamond.robotsExcluded': '排除 {count} 个高频交易地址',
  'findings.diamond.robotsExcluded.detail':
    '这些地址在窗口内买卖交替 ≥ {robotTrades} 次，属于机器人/做市行为，既不是钻石手也不是散户，因此不计入比例（否则会把持仓结构完全带偏）。',
  'findings.diamond.holders': '钻石手 {count} 个（中位持有 {medianHoldDays} 天）',
  'findings.diamond.holders.detail':
    '{analyzed} 个可分析钱包里有 {count} 个符合「只买未卖 + 仍持仓 + 持有 ≥ {minHoldDays} 天」，占 {sharePct}%；其中 {strongEvidence} 个落在最早成交窗口内（证据最强），{addOnCount} 个有过加仓。{topSentence}',
  'findings.diamond.holdersLowCoverage': '钻石手 {count} 个（中位持有 {medianHoldDays} 天）',
  'findings.diamond.holdersLowCoverage.detail':
    '{analyzed} 个可分析钱包里有 {count} 个符合「只买未卖 + 仍持仓 + 持有 ≥ {minHoldDays} 天」，占 {sharePct}%（⚠️ 窗口只覆盖 {coveragePct}% 的时间跨度，实际人数应该更多）；其中 {strongEvidence} 个落在最早成交窗口内（证据最强），{addOnCount} 个有过加仓。{topSentence}',
  'findings.diamond.concentratedInLongTerm': '筹码集中在长期持有者手里',
  'findings.diamond.concentratedInLongTerm.detail':
    '钻石手占可分析钱包的 {sharePct}%，说明这批筹码大概率不会马上砸出来。⚠️ 这只是持仓结构描述，不构成买入理由 —— 老币的持有者天然比新币待得久。',

  // ── 抛压 ──────────────────────────────────────────────────────────
  'findings.sellPressure.noData': '抛压分布无法计算',
  'findings.sellPressure.noData.detail':
    '没有取到可配对的逐笔成交（需要同时拿到某地址的 SOL 净变化与它的代币净变化），因此算不出持仓成本。这不是「没有抛压」，是这一项没数据。',
  'findings.sellPressure.lowAttribution': '只有 {attributionPct}% 的成交能配对出成本',
  'findings.sellPressure.lowAttribution.detail':
    '窗口内 {windowTrades} 笔成交里只有 {paired} 笔能同时拿到 SOL 与代币的净变化，其余交易的代币变动记在别的账户上（中转/聚合器），无法归因到具体买家。因此下面的分布**只覆盖一小部分筹码**，不能当作全貌。',
  'findings.sellPressure.priceUnavailable': '隐含现价不可靠，盈亏一栏已停用',
  'findings.sellPressure.priceUnavailable.detail': '窗口内没有可反推价格的成交。',
  'findings.sellPressure.priceTooOld': '隐含现价不可靠，盈亏一栏已停用',
  'findings.sellPressure.priceTooOld.detail':
    '窗口内最近一笔成交距现在 {ageHours} 小时，超过 {maxAgeHours} 小时的时效上限，那个价格已不能代表现价。',
  'findings.sellPressure.mintedWallets': '{count} 个地址的筹码是铸造/创建获得的（无买入价）',
  'findings.sellPressure.mintedWallets.detail':
    '这些地址通过创建/铸造交易拿到约 {tokens} 枚代币，只付了网络手续费 —— 它们**没有买入成本**，因此不计入盈亏分桶（把手续费当成本会算出「浮盈几十万%」这种假数字）。这类筹码的抛压只能用「占比」衡量：它们在任何价位卖出都是纯利润。',
  'findings.sellPressure.unsoldSummary': '未卖筹码 {unsoldPctOfCirculating}% 流通盘（可分析部分）',
  'findings.sellPressure.unsoldSummary.detail':
    '{walletCount} 个钱包的未卖筹码按成本折算共 {totalCostSol} SOL；其中 {inProfitCount} 个处于浮盈。{biggestTail}⚠️ 这是**窗口内能配对出来的那部分**筹码，不是全部持仓。',
  'findings.sellPressure.unsoldSummaryBackToEven': '未卖筹码 {unsoldPctOfCirculating}% 流通盘（可分析部分）',
  'findings.sellPressure.unsoldSummaryBackToEven.detail':
    '{walletCount} 个钱包的未卖筹码按成本折算共 {totalCostSol} SOL；其中 {inProfitCount} 个处于浮盈。回本区（-10%~+10%）里有 {backToEvenWallets} 个钱包、合计 {backToEvenPct}% 流通盘 —— 这个区间最容易触发卖出。{biggestTail}⚠️ 这是**窗口内能配对出来的那部分**筹码，不是全部持仓。',
  'findings.sellPressure.exited': '{exited} 个钱包已基本卖光',
  'findings.sellPressure.exited.detail':
    '窗口内这些地址卖出 ≥ {exitedSoldPct}% 的买入量，因此**不再计入抛压** —— 不管它们当初赚了多少（赚了但已经跑了的筹码不会再来砸盘）。',
  'findings.sellPressure.exitedWithDistributing': '{exited} 个钱包已基本卖光',
  'findings.sellPressure.exitedWithDistributing.detail':
    '窗口内这些地址卖出 ≥ {exitedSoldPct}% 的买入量，因此**不再计入抛压** —— 不管它们当初赚了多少（赚了但已经跑了的筹码不会再来砸盘）。另有 {distributing} 个正在派发中（卖出 {distributingSoldPct}%–{exitedSoldPct}%），只按剩余部分计入。',
  'findings.sellPressure.deepCoverage': '{deepWallets} 个钱包的成本来自完整历史（不是窗口估算）',
  'findings.sellPressure.deepCoverage.detail':
    '深度模式逐地址拉取了前 {deepAddresses} 名持有人的全部历史成交，其中 {deepWallets} 个能算出**真实成本**与**真实已卖比例**。这些地址不受「成交窗口中段有缺口」影响 —— 它们的卖出记录是完整的，因此表里标「完整历史」的行可信度明显高于「窗口估算」的行。',

  // ── 社交热度 ──────────────────────────────────────────────────────
  'findings.social.noData': '社交数据缺失',
  'findings.social.noData.detail':
    '未能获取社交热度数据。链上无法推算社区质量，此项不计入评分，需要你自行核实项目方的 X / TG。',
  'findings.social.zeroMentions': '零社交提及',
  'findings.social.zeroMentions.detail':
    '过去 24 小时未检测到任何社交提及。没有社区的项目很难有接盘深度。',
  'findings.social.lowHype': '社交热度偏低',
  'findings.social.lowHype.detail': '24h 仅 {mentions} 次提及，热度不足。',
  'findings.social.goodHype': '社交热度充足',
  'findings.social.goodHype.detail': '24h {mentions} 次提及，环比 {growth}%。',
  'findings.social.suspectedBots': '社交热度疑似刷量',
  'findings.social.suspectedBots.detail':
    '约 {pct}% 的提及来自疑似机器人账号（同批账号集中出现在多个 meme 下、模板化文案、互动时间分布异常）。',
  'findings.social.qualityDoubt': '社交互动质量存疑',
  'findings.social.qualityDoubt.detail':
    '{pct}% 提及来自疑似 bot，真实社区占比需人工确认。',
  'findings.social.retweetHeavy': '转发远多于回复',
  'findings.social.retweetHeavy.detail':
    '转推/回复比 {ratio}，买量刷屏的常见形态（真实社区以讨论为主）。',
  'findings.social.tgSpiky': 'TG 群成员阶跃式增长',
  'findings.social.tgSpiky.detail': '成员数是突增而非平滑增长，符合买粉特征。',
  'findings.social.fewAuthors': '提及高度集中在少数账号',
  'findings.social.fewAuthors.detail':
    '平均每个账号发 {perAuthor} 条，说明是靠少数账号反复刷屏。',
  'findings.social.decaying': '热度正在衰减',
  'findings.social.decaying.detail': '提及量环比 {growth}%，社区关注度在下降。',
  'findings.social.lowEngagement': '互动率偏低',
  'findings.social.lowEngagement.detail':
    '真实互动仅占 {pct}%，热度可能虚高。',
};
