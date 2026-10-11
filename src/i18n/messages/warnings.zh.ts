/**
 * 采集告警文案（中文）。
 *
 * key 约定见 `src/core/warning.ts`：
 *   `warnings.<provider>.<事件>`
 *
 * ⚠️ 这里的文案必须与 `src/providers/*.ts` 里 `warn(key, params, text)` 的
 * `text` **逐字一致**。迁移期两份并存（`text` 是回退），漂移了就会出现
 * 「中文界面显示 A、英文界面回退成 B」这种最难查的 bug。
 * `warnings.i18n.test.ts` 会把这条钉死。
 *
 * ⚠️ 与 `findings`/`pieces` 一样是**扁平表**，key 自带全前缀。
 */
export const warningsZh: Record<string, string> = {
  // ── 部署者解析（providers/creator.ts）────────────────────────────
  'warnings.creator.unresolved':
    '未能确定部署者地址：pump.fun 曲线状态、metadata creators、创建交易付款方三处都没取到。',
  'warnings.creator.fromCreateTx':
    '未能读到 pump.fun 曲线或 metadata 里的 creator，部署者身份取自创建交易的付款方 {launchWallet}（**推断值**：用打包器/launchpad 发币时，这个地址不是真正的 dev）。',
  'warnings.creator.launchWalletDiffers':
    '创建交易的付款方 {launchWallet} 与程序记录的 creator {creator} **不是同一个地址**：本报告的开发者维度按 creator 计算（程序状态更权威）；付款方可能是打包器/launchpad，不要把两者混为一谈。',

  // ── 链上采集（providers/helius.ts）──────────────────────────────
  'warnings.helius.mintNotFound': '链上未找到 mint 账户 {mint} —— 地址可能错误，或不属于该网络。',
  'warnings.helius.unexpectedOwner':
    'mint 账户的 owner 是 {programId}，既不是 SPL Token 也不是 Token-2022，需人工核对。',
  'warnings.helius.mintReadFailed': '读取 mint 账户失败：{reason}',
  'warnings.helius.dasFailed': 'DAS getAsset 失败：{reason}（名称/符号/价格可能缺失）',
  'warnings.helius.ammPools':
    '按控制程序识别出 {n} 个 AMM/联合曲线金库（{kinds}），已按流动性池剔除。',
  'warnings.helius.timelocks':
    '识别到 {n} 个时间锁仓持仓（合计 {pct}%）：{labels}。已从集中度与巨鲸计算中剔除，并单独列出。解锁时间当前无法读取（托管账户是 PDA），标为「待接入」。',
  'warnings.helius.supplyUnknown':
    '未能读到代币总供应量，持仓占比无法计算，集中度维度将标记为未采集。',
  'warnings.helius.top20Only':
    '链上仅返回前 20 大持仓账户；更深的分布需要索引器。若 AMM 池地址未被识别为池，其持仓会计入集中度，导致 Top10 占比偏高。',
  'warnings.helius.largestFailed': '读取持仓分布失败：{reason}',
  'warnings.helius.curveMismatch':
    '推导出的 bonding curve 地址 {curveAddress} 不是 pump.fun 曲线账户（owner 或判别符不符），已忽略；curve 内真实 SOL 无法确认。',
  'warnings.helius.curveReadFailed':
    '读取 bonding curve 账户失败：{reason}（curve 内真实 SOL 无法确认）',
  'warnings.helius.oldestNotCreate':
    '最早一笔交易不是创建交易（可能是索引缺口或创建前的转账）：该笔的付款方只能作为部署者的**兜底候选**，发币时间也只能作参考。',
  'warnings.helius.oldestFailed':
    '拉取最早交易失败：{reason}（无法确定部署者与发币时间）',
  'warnings.helius.noDirection':
    '最近 {n} 笔交易里没有可识别的买卖方向（可能样本太少，或该交易类型未被 Helius 解析）。',
  'warnings.helius.tradesFailed': '拉取成交明细失败：{reason}',
  'warnings.helius.custodyFailed': '托管持仓识别失败（无法批量读取 owner 账户）：{reason}',
  'warnings.helius.unmatchedPda':
    '另有 {n} 个持仓的 owner 是 PDA，但控制程序不在已核实名单里，因此不标注、也不剔除，按普通持仓计入集中度。',
  'warnings.helius.pdaCapped':
    '有 {n} 个 PDA 持仓，只反查了前 {cap} 个；其余按普通持仓处理（偏保守）。',
  'warnings.helius.pdaNoApiKey':
    '发现 {n} 个 PDA 持仓，但未配置 Helius API key 无法反查控制程序，一律按普通持仓计入集中度（不做剔除）。',
  'warnings.helius.noApiKey':
    '未配置 Helius API key，「开发者历史」维度无法计算（dev 卖出、历史发币都需要 Enhanced API）。',
  'warnings.helius.developerNoCreator':
    '未能确定部署者地址（创建交易缺失），「开发者历史」维度无法计算。',
  'warnings.helius.creatorStillHolding':
    'creator 当前仍持有 {holding} 枚该代币，因此不会判定为「已清仓」（流水比例可能因历史窗口截断而偏高）。',
  'warnings.helius.creatorBalanceUnknown':
    '未能读取 creator 的代币余额，无法确认其是否已清仓，将只作提示不作判死。',
  'warnings.helius.creatorNoHistory': '部署者地址没有交易历史，dev 卖出与历史发币无法验证。',
  'warnings.helius.creatorHistoryFailed': '查询部署者历史失败：{reason}',
  'warnings.helius.devFundingFailed': '查询部署者资金来源失败：{reason}',

  // ── 持有人枚举（providers/holderList.ts）────────────────────────
  'warnings.holderList.rpcFailed':
    'RPC 全量枚举失败（{program}…）：{reason}。已降级为 DAS 分页，结果可能不完整。',
  'warnings.holderList.dasCapped':
    'DAS 分页达到上限（{pages} 页 × 1000），只取到前 {n} 个账户，分布图与持有人数**不完整**，不要当作全量。',
  'warnings.holderList.empty':
    '全量枚举没有得到任何 token account（该 mint 可能没有持有人）。',
  'warnings.holderList.enumerationFailed': '全量持有人枚举失败：{reason}。本项无法计算。',

  // ── 市场数据（providers/dexscreener.ts）─────────────────────────
  'warnings.dexscreener.httpError': 'DexScreener 返回 {status}，市场数据缺失（可能限流）。',
  'warnings.dexscreener.notFound':
    'DexScreener 未收录该代币 —— 可能尚未建立任何交易池，或属于极新/极冷标的。',
  'warnings.dexscreener.timeout': 'DexScreener 请求超时（{ms}ms），市场数据缺失。',
  'warnings.dexscreener.failed': 'DexScreener 请求失败：{reason}',
  'warnings.dexscreener.skippedDebug': '已跳过 DexScreener（调试模式）',

  // ── RugCheck（providers/rugcheck.ts）────────────────────────────
  'warnings.rugcheck.riskItem': 'RugCheck 风险项：{name}{level}',
  'warnings.rugcheck.noLpMint':
    'RugCheck 的这个池还没有有效的 LP mint（索引未完成），LP 锁定/销毁状态无法判定，已按「未知」处理。',
  'warnings.rugcheck.summaryOnly':
    'RugCheck 只返回了汇总数据（完整报告过大），因此只能判定 LP 锁定比例，拿不到 LP 持有者与池地址。',
  'warnings.rugcheck.lpSupplyUnreadable':
    '无法读取 LP mint {lpMint} 的链上供应量，因此无法核对「LP 已销毁」的比例，本次只给出 RugCheck 口径的锁定/销毁比例。',
  'warnings.rugcheck.fullUnavailable':
    'RugCheck 完整报告不可用（{reason}），已退回汇总接口。',
  'warnings.rugcheck.unavailable':
    'RugCheck 不可用（{fullReason}；汇总接口：{summaryReason}）—— LP 是否锁定/销毁、持有人总数本次无法判定，报告中会如实标为「未知」。',

  // ── 池解析（providers/pools.ts）─────────────────────────────────
  'warnings.pools.noneDerived':
    '未能推导出任何池地址，池持仓可能被计入集中度，Top10 占比会偏高。',
  'warnings.pools.mintUnparsable': 'mint 地址无法解析，跳过池推导：{mint}',

  // ── 汇总层（providers/index.ts）─────────────────────────────────
  'warnings.index.sniperEstimate':
    '狙击仓位为推算值：取代币最早 {window} 笔成交，排除部署者相关地址后剩 {n} 个付款方，与当前前 20 大持仓求交集（链上只返回前 20），因此只是下限，不是全量。',
  'warnings.index.lpLockUnconfirmed':
    'LP 是否锁定/销毁未能确认（RugCheck 未覆盖该池或本次不可达）。当前显示为「未知」—— 请在 RugCheck 上二次确认（这关系到能否被撤池）。',
  'warnings.index.socialNotIntegrated':
    '社交热度数据源未接入（Helius 不提供社交数据，需 X/TG 第三方服务）。该维度标记为未采集，不计入评分。',
  'warnings.index.overviewNotLoaded':
    '持有人总览未自动加载：约 {accounts} 个账户超过上限 {max}。这不是「没有持有人」，是按需加载。',
  'warnings.index.threeCalibers':
    '「持有人数」有三个口径，差额不做推断：链上 token account {accounts} 个（其中有余额 {withBalance} 个、已清空 {empty} 个）、RugCheck 报 {reported} 个。',

  // ── 深度模式（providers/deepHolders.ts）─────────────────────────
  'warnings.deepHolders.partial':
    '深度模式下有 {failed} 个地址的历史没拉全（限流或超时），这些地址的成本仍按窗口估算 —— 深度结果只覆盖了 {succeeded} 个地址。',
  'warnings.deepHolders.noNativeTrades':
    '深度模式拉到的历史里没有本币成交：这些地址的代币是从别处转入的（不是买来的），因此拿不到买入成本。',

  // ── 引擎兜底（core/engine.ts）───────────────────────────────────
  'warnings.engine.scanFailed': '{reason}',
};
