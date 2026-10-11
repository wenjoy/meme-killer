/**
 * 维度 1：合约安全
 *
 * 关键认知：
 * - Pump.fun 发行的币，mint/freeze authority 默认均为 null。任一非 null 即高危
 *   —— 可直接增发稀释你，或冻结你的账户让你卖不掉。
 * - 只查 getMint 会漏掉 Token-2022 扩展。Pump.fun 走经典 SPL Token，
 *   出现 Token-2022 + 作恶扩展 ⇒ 几乎必然是仿冒/诈骗。
 * - LP 锁定不能相信 UI 文案，必须链上核验（销毁地址 / 锁仓程序持有）。
 */
import { THRESHOLDS, TOKEN_2022_PROGRAM_ID, scoreFromFindings } from '../constants';
import type { DimensionResult, Finding, ScanInput, Severity } from '../types';

/** Token-2022 扩展的风险分级 */
const EXTENSION_RISK: Record<string, { severity: Severity; label: string; why: string }> = {
  transferHook: {
    severity: 'critical',
    label: '转账钩子',
    why: '转账时调用任意程序，可阻止卖出（蜜罐）',
  },
  permanentDelegate: {
    severity: 'critical',
    label: '永久代理',
    why: '可随时划走任意账户余额，你的币不完全属于你',
  },
  transferFeeConfig: { severity: 'high', label: '转账税', why: '每次卖出被抽税，侵蚀利润' },
  defaultAccountStateFrozen: {
    severity: 'high',
    label: '默认冻结状态',
    why: '新账户默认不可转账，买入后可能无法操作',
  },
  nonTransferable: { severity: 'high', label: '不可转让', why: '买入后无法卖出' },
  mintCloseAuthority: { severity: 'medium', label: '铸币关闭权限', why: '可关闭 mint 账户' },
  interestBearing: { severity: 'low', label: '计息显示', why: '仅前端显示，无实际作恶能力' },
};

export function analyzeContract(data: ScanInput): DimensionResult {
  const c = data.contract ?? {};
  const findings: Finding[] = [];
  let vetoed = false;

  /**
   * 结论只带 id + 参数，文案由渲染层按语言决定。
   * `zhTitle`/`zhDetail` 是过渡期的中文回退，迁完后删除。
   *
   * 参数顺序与 social.ts 保持一致：severity, id, 中文回退, params。
   */
  const add = (
    severity: Severity,
    id: string,
    zhTitle: string,
    zhDetail: string,
    params?: Record<string, string | number>,
  ) => findings.push({ severity, id, ...(params ? { params } : {}), title: zhTitle, detail: zhDetail });
  /** 硬否决：同样是 id + params，额外带 `veto: true` */
  const veto = (
    id: string,
    zhTitle: string,
    zhDetail: string,
    params?: Record<string, string | number>,
  ) => {
    vetoed = true;
    findings.push({
      severity: 'critical',
      id,
      ...(params ? { params } : {}),
      title: zhTitle,
      detail: zhDetail,
      veto: true,
    });
  };

  // 整个 contract 段缺失：不能当作「检查过了，没问题」。
  // 权限是否为 null、扩展是否存在，在数据缺失时全部不可知 —— 必须标记缺失。
  if (data.contract == null) {
    return {
      dimension: 'contract',
      label: '合约安全',
      score: 0,
      vetoed: false,
      findings: [
        {
          severity: 'medium',
          id: 'contract.noData',
          title: '合约数据缺失',
          detail: '未能读取 mint 账户，mint/freeze 权限与 Token-2022 扩展是否安全均无法判断。请勿据此认为「没有发现问题」。',
        },
      ],
      metrics: { available: 0 },
    };
  }

  // ── mint / freeze authority ──────────────────────────────────────
  if (c.mintAuthority) {
    veto(
      'contract.mintNotRevoked',
      '铸币权限未放弃',
      `mintAuthority = ${c.mintAuthority}。项目方可无限增发，稀释你的持仓。`,
      { authority: c.mintAuthority },
    );
  }
  if (c.freezeAuthority) {
    veto(
      'contract.freezeNotRevoked',
      '冻结权限未放弃',
      `freezeAuthority = ${c.freezeAuthority}。项目方可冻结你的账户，让你无法卖出。`,
      { authority: c.freezeAuthority },
    );
  }
  if (c.mintAuthority === null && c.freezeAuthority === null) {
    // 只有**明确读到 null** 才算「已放弃」；undefined 是未知，不能当利好。
    add('good', 'contract.authoritiesRevoked', '权限已放弃', 'mint 与 freeze authority 均为 null，符合 Pump.fun 正常发币状态。');
  } else if (c.mintAuthority === undefined && c.freezeAuthority === undefined) {
    add('medium', 'contract.authorityUnknown', '权限状态未知', '未能确认 mint/freeze authority 是否已放弃，需人工核实。');
  }

  // ── 代币程序与扩展 ───────────────────────────────────────────────
  //
  // ⚠️ 不能用「是否 Token-2022」当风险信号。
  // 实测真实 pump.fun 新币（2024 之后）本身就发行在 Token-2022 上
  // （mint 带 metadata_pointer 扩展），把它判成高危会让**每一个正常新币**
  // 都背上一条 high finding，模型直接失去区分度。
  //
  // 真正决定风险的是**扩展的内容**：transferHook / permanentDelegate
  // 这类能限制卖出或转走持币的扩展才是要害，下面逐项检查。
  if (c.tokenProgram === TOKEN_2022_PROGRAM_ID) {
    const exts = c.extensions ?? [];
    for (const ext of exts) {
      // transferFeeConfig 由下方「转移税」分支按**实际 bps 数值**报告，
      // 这里跳过以免同一个事实出两条 finding（一条没数值、一条有）。
      if (ext === 'transferFeeConfig') continue;
      const meta = EXTENSION_RISK[ext] ?? {
        severity: 'medium' as Severity,
        label: ext,
        why: '未知扩展，需人工复核',
      };
      if (meta.severity === 'critical') {
        veto('contract.maliciousExtension', `作恶扩展：${meta.label}`, meta.why, {
          extension: ext,
          label: meta.label,
          why: meta.why,
        });
      } else {
        add(meta.severity, 'contract.extension', `扩展：${meta.label}`, meta.why, {
          extension: ext,
          label: meta.label,
          why: meta.why,
        });
      }
    }
    if (exts.length === 0) {
      // 新版 pump.fun 代币带 metadata_pointer，属正常；完全没有扩展也属正常范围。
      // 这里只作说明，不算风险 —— 用 'good' 语义（中性/无问题）。
      add(
        'good',
        'contract.token2022Clean',
        'Token-2022 代币，未检出作恶扩展',
        '新版 pump.fun 代币本身就发行在 Token-2022 上，使用该程序不是风险信号。' +
          '关键看扩展：未检出 transferHook / permanentDelegate 等可限制卖出的扩展。',
      );
    }
  }

  // ── 转移税 ──────────────────────────────────────────────────────
  const feeBps = c.transferFeeBps ?? 0;
  if (feeBps > THRESHOLDS.contract.maxTransferFeeBps) {
    add(
      feeBps >= 500 ? 'critical' : 'high',
      'contract.transferFee',
      '存在转移税',
      `卖出税 ${(feeBps / 100).toFixed(2)}%，会显著侵蚀利润。`,
      { feePct: (feeBps / 100).toFixed(2) },
    );
  }

  // ── LP 锁定 ─────────────────────────────────────────────────────
  //
  // 三态，且只有**明确读到**才算数（来源：RugCheck 按链上 LP mint 余额推导）：
  //   burned = true            → 已销毁，这是最硬的结论
  //   locked = true            → 已锁定（可能带锁仓方与解锁时间）
  //   locked/burned = false    → **已确认未锁也未销毁** —— 存在撤池风险
  //   undefined                → 未知，不得据此判死，只能提示
  //
  // ⚠️ 这里曾经有一个结构性 bug：`locked/burned` 从来没有任何 provider 写过，
  // 于是「LP 已销毁 / 已锁定」两条利好永远不出现，而每个有池的代币都固定吃一条
  // high 风险。现在数据由 providers/rugcheck.ts 提供，未知仍然是未知。
  const LOCKED_PCT_LP = 95;
  const lp = c.lp ?? {};
  const lockPct = lp.lockedPct !== undefined ? `锁定/销毁比例 ${lp.lockedPct.toFixed(1)}%` : '';
  /**
   * 把 RugCheck 的 LP 持有者明细渲染成可核对的证据文本。
   *
   * 为什么必须带上：`lpLockedPct = 62.9%` 只说明「有一部分没锁」，
   * 并不说明是谁持有那部分。没有这份明细时，报告无权说「项目方可撤池」，
   * 只能说「存在未锁部分，持有人不明」。
   */
  const lpEvidence = (lp.lpHolders ?? [])
    .map(
      (h) =>
        `${h.owner.slice(0, 4)}…${h.owner.slice(-4)}` +
        `${h.label ? `（RugCheck 标注：${h.label}）` : ''} ${h.pct.toFixed(1)}%` +
        // 锁仓账户必须带上解锁时间：没有它，「逐步解锁」就只是一句没有信息量的话
        `${h.isLocker && h.unlockAt ? `（解锁 ${h.unlockAt}）` : ''}`,
    )
    .join('、');
  // ⚠️ 两个口径不一定对得上，对不上时只能说「对不上」。
  // 实测 `BdzaE3T7…pump`：RugCheck 说锁定 50.6%、未锁 49.4%，
  // 但链上持有者明细合计 50.9%（其中锁仓合约 50.6%）—— 差额 1.5% 无法解释。
  // 遇到这种情况**不做推断**（既不把差额算成风险，也不算成安全），只如实说明。
  // 而 `AVKpeeWa…pump` 两边正好吻合（31.7% vs 31.7%），不会触发这条提示。
  const holderSumPct = (lp.lockerPct ?? 0) + (lp.withdrawablePct ?? 0);
  const accountGapPct =
    lp.lockedPct !== undefined && holderSumPct > 0 ? Math.abs(100 - lp.lockedPct - holderSumPct) : 0;
  const accountGapNote =
    accountGapPct > 1
      ? `⚠️ RugCheck 的锁定比例与链上持有者明细对不上：明细合计 ${holderSumPct.toFixed(1)}%，` +
        `而按锁定比例推算应为 ${(100 - (lp.lockedPct ?? 0)).toFixed(1)}%（差 ${accountGapPct.toFixed(1)}%）。` +
        '这可能来自索引未覆盖全部持有者，差额部分本工具不做推断 —— 请以链上 LP mint 的实际持有为准。'
      : '';
  // 「已销毁」的证据：链上 LP mint 的历史铸造量与当前供应量差额。
  // 没有这个差额时不能声称已销毁 —— 只能说 RugCheck 口径的比例。
  const audit = lp.lpAudit;
  const auditText = audit
    ? `链上核对该池 LP mint（${lp.lpMint ?? '地址未知'}）：历史铸造 ${audit.everMinted.toLocaleString()}、` +
      `当前链上供应 ${audit.live.toLocaleString()}，差额 ${audit.burned.toLocaleString()} 已销毁、不可恢复`
    : '';
  /**
   * auditText 的结构化版本（措辞交给 `pieces.contract.lpAudit`）。
   * 中文整句作为过渡期回退保留，两者同源。
   */
  const auditParts = audit
    ? {
        lpMint: lp.lpMint ?? '',
        everMinted: audit.everMinted.toLocaleString(),
        live: audit.live.toLocaleString(),
        burned: audit.burned.toLocaleString(),
      }
    : undefined;
  const livePct = lp.burnedPct !== undefined ? Math.max(0, 100 - lp.burnedPct) : undefined;

  // 与部署者**关联**的钱包持有多少流通 LP：创建交易的付款方、creator 首笔交易的出资方。
  // 实测 `9raUVuze…pump`：创建钱包 4JBz4tAK… 持有历史 LP 的 10.8%（= 流通 LP 的 29%），
  // 而按 creator（曲线状态里的 Fpi4NERk…）算它是 0% —— 只报 creator 会漏掉这个敞口。
  const dev = data.developer ?? {};
  const relatedWallets = new Set(
    [dev.creator, dev.launchWallet, ...(dev.linkedWallets ?? [])].filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    ),
  );
  const relatedHolders = (lp.lpAllHolders ?? []).filter((h) => h.owner && relatedWallets.has(h.owner));
  const relatedOfLive =
    livePct !== undefined && livePct > 0
      ? (relatedHolders.reduce((sum, h) => sum + h.pct, 0) / livePct) * 100
      : undefined;
  const relatedOfPool = relatedOfLive !== undefined && livePct !== undefined
    ? (relatedOfLive / 100) * livePct
    : undefined;

  if (lp.exists === false) {
    add('medium', 'contract.lpNotCreated', '尚未建立 LP', '仍在 bonding curve 阶段，没有真实流动性池。');
  } else if (lp.burned === true || (lp.burnedPct ?? 0) >= LOCKED_PCT_LP) {
    // ⚠️ 名称纠正：RugCheck 的 `lpLockedPct` 实际是「不在流通中的比例」，
    // 链上核对显示它就是**已销毁**（LP mint 供应量差额）。
    if (lockPct) {
      add(
        'good',
        'contract.lpBurned',
        'LP 已销毁',
        `流动性凭证已永久销毁，无法撤池（${lockPct}）。` + (auditText ? `${auditText}。` : ''),
        { lockPct, ...(auditText ? { auditText } : {}), ...(auditParts ? { auditParts: JSON.stringify(auditParts) } : {}) },
      );
    } else {
      add(
        'good',
        'contract.lpBurnedNoPct',
        'LP 已销毁',
        '流动性凭证已永久销毁，无法撤池。' + (auditText ? `${auditText}。` : ''),
        auditText ? { auditText, auditParts: JSON.stringify(auditParts) } : undefined,
      );
    }
  } else if (lp.locked) {
    // ⚠️ 不把「锁定」硬说成「由某锁仓程序托管」：RugCheck 只给比例，
    // 拿不到锁仓方时可能是销毁、也可能是 AMM 自身托管，措辞必须留余地。
    const lockedSuffix =
      (lp.unlockAt ? `，锁定至 ${lp.unlockAt.slice(0, 10)}` : '') +
      `${lockPct ? `（${lockPct}）` : ''}，无法撤池。`;
    const lockedParams = {
      ...(lp.unlockAt ? { unlockAt: lp.unlockAt.slice(0, 10) } : {}),
      ...(lockPct ? { lockPct } : {}),
    };
    if (lp.locker) {
      add(
        'good',
        'contract.lpLockedByLocker',
        'LP 已锁定/不可撤',
        `由 ${lp.locker} 持有` + lockedSuffix,
        { locker: lp.locker, ...lockedParams },
      );
    } else if (lp.unlockAt) {
      add(
        'good',
        'contract.lpLockedByProgram',
        'LP 已锁定/不可撤',
        '由锁仓程序持有' + lockedSuffix,
        lockedParams,
      );
    } else {
      add(
        'good',
        'contract.lpLockedNoLocker',
        'LP 已锁定/不可撤',
        '锁定或销毁比例已达上限，未提供锁仓方' + lockedSuffix,
        lockedParams,
      );
    }
  } else if (lp.singleHolder) {
    {
      const holderText = lp.holder ?? '未知';
      const pctPart = lockPct ? `（${lockPct}）` : '';
      const evidencePart = lpEvidence ? `RugCheck 记录的 LP 持有者：${lpEvidence}。` : '';
      // 四个组合各给一个 id —— 文案的句子结构不同，不能靠 params 拼
      const id = lpEvidence
        ? lockPct
          ? 'contract.lpUnlockedSingleHolderWithEvidence'
          : 'contract.lpUnlockedSingleHolderNoPctWithEvidence'
        : lockPct
          ? 'contract.lpUnlockedSingleHolder'
          : 'contract.lpUnlockedSingleHolderNoPct';
      veto(
        id,
        'LP 未锁未销毁',
        `LP 未锁未销毁，且由单一地址 ${holderText} 持有${pctPart}，` +
          '该地址可随时撤走全部流动性。' +
          evidencePart,
        {
          holder: holderText,
          ...(lockPct ? { lockPct } : {}),
          ...(lpEvidence ? { lpEvidence } : {}),
        },
      );
    }
  } else {
    // ── 未达「已销毁/已锁定」的整体判定 ──────────────────────────
    // 先如实报出已经销毁的那部分（实测很常见：pump.fun 迁移销毁的只是迁移时那笔，
    // 之后第三方添加流动性又会铸出新的 LP），再处置仍在流通的部分。
    if ((lp.burnedPct ?? 0) > 0) {
      const burnedPctText = (lp.burnedPct ?? 0).toFixed(1);
      const livePctText = (livePct ?? 0).toFixed(1);
      if (auditText) {
        add(
          (lp.burnedPct ?? 0) >= 50 ? 'good' : 'low',
          'contract.lpPartiallyBurned',
          `LP 已销毁 ${burnedPctText}%`,
          `${auditText}；即 ${burnedPctText}% 的 LP 已销毁，` +
            `其余 ${livePctText}% 仍在流通。`,
          { burnedPct: burnedPctText, livePct: livePctText, auditText, ...(auditParts ? { auditParts: JSON.stringify(auditParts) } : {}) },
        );
      } else {
        add(
          (lp.burnedPct ?? 0) >= 50 ? 'good' : 'low',
          'contract.lpPartiallyBurnedNoAudit',
          `LP 已销毁 ${burnedPctText}%`,
          // ⚠️ 前导分号是旧行为的原样保留：模板是 `${auditText}；即 …`，
          // auditText 为空时 detail 就以「；」开头。迁移不改文案，故照旧。
          `；即 ${burnedPctText}% 的 LP 已销毁，` + `其余 ${livePctText}% 仍在流通。`,
          { burnedPct: burnedPctText, livePct: livePctText },
        );
      }
    }
    // ⚠️ 门槛卡在**占全池 LP 的比例**上，不是占流通量的比例：
    // 真正能撤走的是池子深度的那一份。用「占流通量」当门槛时，
    // 一个销毁 96% 的池子只要有地址拿着剩下那 4% 的一大半就会被报成风险，
    // 而它实际只能抽走池子的 3% —— 那是把小数放大成警报。
    if (relatedOfPool !== undefined && relatedOfPool >= 5) {
      // 关联钱包（付款方 / 给 creator 出资的钱包）持有 LP —— 这是真实的撤池敞口
      {
        const ofPoolText = relatedOfPool.toFixed(1);
        const liveText = relatedOfLive !== undefined ? relatedOfLive.toFixed(1) : undefined;
        const head =
          '链上核对：与部署者关联的地址（创建交易的付款方、或给 creator 首笔交易出资的钱包）' +
          `持有全池 LP 的约 ${ofPoolText}%` +
          (liveText !== undefined ? `（占仍在流通部分的 ${liveText}%）` : '') +
          `，涉及 ${relatedHolders.length} 个地址 —— 这些地址可以随时提走对应份额的流动性。` +
          '除非能证明它与项目方无关（例如是公开的做市商），否则应按项目方撤池风险看待。';
        const id = lpEvidence
          ? liveText !== undefined
            ? 'contract.relatedHoldsLpWithEvidence'
            : 'contract.relatedHoldsLpNoLiveWithEvidence'
          : liveText !== undefined
            ? 'contract.relatedHoldsLp'
            : 'contract.relatedHoldsLpNoLive';
        add(relatedOfPool >= 50 ? 'high' : 'medium', id, '与部署者关联的钱包持有流通中的 LP', head + (lpEvidence ? `LP 持有者：${lpEvidence}。` : ''), {
          ofPoolPct: ofPoolText,
          ...(liveText !== undefined ? { livePct: liveText } : {}),
          holderCount: relatedHolders.length,
          ...(lpEvidence ? { lpEvidence } : {}),
        });
      }
    }
    if ((lp.creatorLpPct ?? 0) >= 5) {
      // 只有项目方自己持有的流通 LP 才是撤池跑路的直接风险
      const ofPool = livePct !== undefined ? ((lp.creatorLpPct ?? 0) / 100) * livePct : undefined;
      {
        const creatorText = (lp.creatorLpPct ?? 0).toFixed(1);
        const ofPoolText = ofPool !== undefined ? ofPool.toFixed(1) : undefined;
        const body =
          `链上核对：creator 地址持有流通 LP 的约 ${creatorText}%` +
          (ofPoolText !== undefined ? `（相当于全池 LP 的 ${ofPoolText}%）` : '') +
          '，可以随时撤走对应份额的流动性。';
        const id = lpEvidence
          ? ofPoolText !== undefined
            ? 'contract.creatorHoldsLpWithEvidence'
            : 'contract.creatorHoldsLpNoPoolWithEvidence'
          : ofPoolText !== undefined
            ? 'contract.creatorHoldsLp'
            : 'contract.creatorHoldsLpNoPool';
        add('high', id, '项目方持有流通中的 LP', body + (lpEvidence ? `LP 持有者：${lpEvidence}。` : ''), {
          creatorPct: creatorText,
          ...(ofPoolText !== undefined ? { ofPoolPct: ofPoolText } : {}),
          ...(lpEvidence ? { lpEvidence } : {}),
        });
      }
    } else if ((lp.lockerPct ?? 0) > 0 && (lp.withdrawablePct ?? 0) < THRESHOLDS.contract.lpWithdrawableDangerPct) {
      // 流通部分主要在锁仓/线性解锁合约里（实测 AVKpeeWa…、BdzaE3T7… 都是 Streamflow）。
      // ⚠️ 标题不能说「LP 未销毁」：上面那条可能已经报出「已销毁 68.3%」，
      // 这里说的是**仍在流通的那部分**的去向。
      {
        const lockerPctText = (lp.lockerPct ?? 0).toFixed(1);
        const withdrawableText = (lp.withdrawablePct ?? 0).toFixed(2);
        const tail =
          (lpEvidence ? `LP 持有者：${lpEvidence}。` : '') +
          accountGapNote +
          '⚠️ 锁仓会按计划逐步解锁，解锁后即可提走 —— 请留意解锁时间，别把它当成永久锁定。';
        add(
          'medium',
          lockPct ? 'contract.lpInLocker' : 'contract.lpInLockerNoPct',
          '流通中的 LP 主要在锁仓程序里',
          `RugCheck 实测${lockPct ? `：${lockPct}` : ''}` +
            `；链上核对到 ${lockerPctText}% 的 LP 由锁仓/线性解锁合约持有，` +
            `普通钱包可随时提走的仅约 ${withdrawableText}%。` +
            tail,
          {
            ...(lockPct ? { lockPct } : {}),
            lockerPct: lockerPctText,
            withdrawablePct: withdrawableText,
            ...(lpEvidence ? { lpEvidence } : {}),
            ...(accountGapNote ? { accountGapNote } : {}),
          },
        );
      }
    } else if ((lp.topCirculatingHolderPct ?? 0) >= 50) {
      {
        const topText = (lp.topCirculatingHolderPct ?? 0).toFixed(1);
        const ofPoolText =
          livePct !== undefined
            ? (((lp.topCirculatingHolderPct ?? 0) / 100) * livePct).toFixed(1)
            : undefined;
        const body =
          `链上核对：流通中的 LP 有约 ${topText}% 由单一地址持有` +
          (ofPoolText !== undefined ? `（相当于全池 LP 的 ${ofPoolText}%）` : '') +
          '，该地址撤走时池子流动性会同步减少这么多。';
        const id = lpEvidence
          ? ofPoolText !== undefined
            ? 'contract.lpConcentratedWithEvidence'
            : 'contract.lpConcentratedNoPoolWithEvidence'
          : ofPoolText !== undefined
            ? 'contract.lpConcentrated'
            : 'contract.lpConcentratedNoPool';
        add('medium', id, '流通中的 LP 集中在一个地址', body + (lpEvidence ? `LP 持有者：${lpEvidence}。` : ''), {
          topPct: topText,
          ...(ofPoolText !== undefined ? { ofPoolPct: ofPoolText } : {}),
          ...(lpEvidence ? { lpEvidence } : {}),
        });
      }
    } else if ((lp.circulatingHolderCount ?? 0) >= 3) {
      {
        const liveText = livePct !== undefined ? livePct.toFixed(1) : undefined;
        const topText = (lp.topCirculatingHolderPct ?? 0).toFixed(1);
        const hasRelated = relatedHolders.length > 0;
        const head =
          (liveText !== undefined ? `约 ${liveText}% 的 LP 仍在流通，` : '') +
          `由 ${lp.circulatingHolderCount} 个地址分散持有（最大一个占流通量的 ${topText}%）` +
          (hasRelated
            ? `，其中 ${relatedHolders.length} 个是与部署者关联的地址（见上一条，不能算作第三方流动性）`
            : '') +
          '。';
        const body = hasRelated
          ? '除关联地址那一份之外，其余是各自添加流动性的持有人，撤走自己那份属于正常的 AMM 行为' +
            '（关联地址的部分见上一条，不能一并算作「第三方流动性」）—— '
          : '这些是各自添加流动性的持有人，撤走自己那份属于正常的 AMM 行为，不构成项目方撤池跑路 —— ';
        const id = hasRelated
          ? liveText !== undefined
            ? 'contract.lpDistributedWithRelated'
            : 'contract.lpDistributedNoLiveWithRelated'
          : liveText !== undefined
            ? 'contract.lpDistributed'
            : 'contract.lpDistributedNoLive';
        add('low', id, '流通中的 LP 分散在多个地址', head + body + '但无论如何，提走 LP 都会让池子深度同步下降。' + (lpEvidence ? `LP 持有者：${lpEvidence}。` : ''), {
          ...(liveText !== undefined ? { livePct: liveText } : {}),
          holderCount: lp.circulatingHolderCount ?? 0,
          topPct: topText,
          ...(hasRelated ? { relatedCount: relatedHolders.length } : {}),
          ...(lpEvidence ? { lpEvidence } : {}),
        });
      }
    } else if (
      (lp.circulatingHolderCount ?? 0) >= 1 &&
      (lp.withdrawablePct ?? 0) >= THRESHOLDS.contract.lpWithdrawableDangerPct
    ) {
      // 流通 LP 只落在极少数普通钱包里（1–2 个），且占比不小：不是「分散的第三方流动性」
      {
        const withdrawableText = (lp.withdrawablePct ?? 0).toFixed(1);
        const topText =
          lp.topCirculatingHolderPct !== undefined ? lp.topCirculatingHolderPct.toFixed(1) : undefined;
        const body =
          `链上核对：${withdrawableText}% 的 LP 由 ${lp.circulatingHolderCount} 个普通钱包持有` +
          (topText !== undefined ? `（最大一个占流通量的 ${topText}%）` : '') +
          '，这些地址可以随时提走对应份额的流动性。';
        const id = lpEvidence
          ? topText !== undefined
            ? 'contract.lpFewWalletsWithEvidence'
            : 'contract.lpFewWalletsNoTopWithEvidence'
          : topText !== undefined
            ? 'contract.lpFewWallets'
            : 'contract.lpFewWalletsNoTop';
        add('medium', id, '流通中的 LP 由少数地址持有', body + (lpEvidence ? `LP 持有者：${lpEvidence}。` : ''), {
          withdrawablePct: withdrawableText,
          holderCount: lp.circulatingHolderCount ?? 0,
          ...(topText !== undefined ? { topPct: topText } : {}),
          ...(lpEvidence ? { lpEvidence } : {}),
        });
      }
    } else if ((lp.withdrawablePct ?? 0) >= THRESHOLDS.contract.lpWithdrawableDangerPct) {
      {
        const withdrawableText = (lp.withdrawablePct ?? 0).toFixed(1);
        add(
          'high',
          lpEvidence ? 'contract.lpUnlockedWithEvidence' : 'contract.lpUnlockedNoEvidence',
          'LP 未锁定也未销毁',
          `RugCheck 实测${lockPct ? `：${lockPct}` : ''}` +
            `；链上核对到其中 ${withdrawableText}% 的 LP 由普通钱包持有，` +
            '这些地址可以随时提走对应流动性。' +
            accountGapNote +
            (lpEvidence
              ? `RugCheck 记录的 LP 持有者：${lpEvidence} —— 请按此核对可撤部分在谁手里。`
              : '⚠️ 没有持有者明细时不要默认是项目方。'),
          {
            ...(lockPct ? { lockPct } : {}),
            withdrawablePct: withdrawableText,
            ...(accountGapNote ? { accountGapNote } : {}),
            ...(lpEvidence ? { lpEvidence } : {}),
          },
        );
      }
    } else if (lp.locked === false || lp.burned === false || lp.burnedPct !== undefined) {
      // 有比例、没有持有者明细：能说清「有多少不在流通中」，说不清「谁拿着剩下的」。
      // 既不能算撤池风险（可能是第三方或锁仓），也不能算已锁定 —— 只能如实标注未知。
      add(
        'medium',
        lockPct ? 'contract.lpHoldersUnverifiable' : 'contract.lpHoldersUnverifiableNoPct',
        '流通中的 LP 持有人无法核实',
        `RugCheck 口径${lockPct ? `：${lockPct}` : ''}（链上核对显示这个比例就是已不在流通中的 LP），` +
          '但本次没拿到 LP 持有者明细，无法确认剩余流通部分在谁手里 —— ' +
          '既不能据此判定撤池风险，也不能当成已锁定。' +
          (lp.lpMint ? `LP mint：${lp.lpMint}。` : ''),
        {
          ...(lockPct ? { lockPct } : {}),
          ...(lp.lpMint ? { lpMint: lp.lpMint } : {}),
        },
      );
    } else if (lp.exists === true) {
      // 确认存在 LP，但锁仓状态查不到 —— 这是风险，不是安全
      add('high', 'contract.lpLockUnknown', 'LP 锁定状态未知', '已确认存在流动性池，但未能核实 LP 已锁或已销毁，存在撤池风险。');
    }
  }
  // lp 完全为空：不在此处下结论，避免把「没数据」误判成「有风险」

  if (c.isMutableMetadata) {
    add('low', 'contract.mutableMetadata', 'Metadata 可变', '项目方可修改名称/图标，常见但可被用于伪装。');
  }

  return {
    dimension: 'contract',
    label: '合约安全',
    score: vetoed ? 100 : scoreFromFindings(findings),
    vetoed,
    findings,
    metrics: {
      // 三态：1 = 已放弃，0 = 未放弃，-1 = 未知。
      // 用 `c.mintAuthority ? 0 : 1` 会把 undefined 当成「已放弃」，
      // 在数据缺失时显示为绿色的安全标记 —— 这是必须避免的假安全感。
      mintAuthorityRevoked: revokedState(c.mintAuthority),
      freezeAuthorityRevoked: revokedState(c.freezeAuthority),
      transferFeeBps: feeBps,
      isToken2022: c.tokenProgram === TOKEN_2022_PROGRAM_ID ? 1 : 0,
    },
  };
}

/** 权限状态三态化，避免把「没读到」渲染成「已放弃」 */
function revokedState(value: string | null | undefined): number {
  if (value === null) return 1; // 明确读到 null = 已放弃
  if (value === undefined) return -1; // 未读到 = 未知
  return 0; // 有值 = 未放弃
}
