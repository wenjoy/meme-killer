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

  const veto = (title: string, detail: string) => {
    vetoed = true;
    findings.push({ severity: 'critical', title, detail, veto: true });
  };
  const add = (severity: Severity, title: string, detail: string) =>
    findings.push({ severity, title, detail });

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
          title: '合约数据缺失',
          detail: '未能读取 mint 账户，mint/freeze 权限与 Token-2022 扩展是否安全均无法判断。请勿据此认为「没有发现问题」。',
        },
      ],
      metrics: { available: 0 },
    };
  }

  // ── mint / freeze authority ──────────────────────────────────────
  if (c.mintAuthority) {
    veto('铸币权限未放弃', `mintAuthority = ${c.mintAuthority}。项目方可无限增发，稀释你的持仓。`);
  }
  if (c.freezeAuthority) {
    veto('冻结权限未放弃', `freezeAuthority = ${c.freezeAuthority}。项目方可冻结你的账户，让你无法卖出。`);
  }
  if (c.mintAuthority === null && c.freezeAuthority === null) {
    // 只有**明确读到 null** 才算「已放弃」；undefined 是未知，不能当利好。
    add('good', '权限已放弃', 'mint 与 freeze authority 均为 null，符合 Pump.fun 正常发币状态。');
  } else if (c.mintAuthority === undefined && c.freezeAuthority === undefined) {
    add('medium', '权限状态未知', '未能确认 mint/freeze authority 是否已放弃，需人工核实。');
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
      if (meta.severity === 'critical') veto(`作恶扩展：${meta.label}`, meta.why);
      else add(meta.severity, `扩展：${meta.label}`, meta.why);
    }
    if (exts.length === 0) {
      // 新版 pump.fun 代币带 metadata_pointer，属正常；完全没有扩展也属正常范围。
      // 这里只作说明，不算风险 —— 用 'good' 语义（中性/无问题）。
      add(
        'good',
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
      '存在转移税',
      `卖出税 ${(feeBps / 100).toFixed(2)}%，会显著侵蚀利润。`,
    );
  }

  // ── LP 锁定 ─────────────────────────────────────────────────────
  const lp = c.lp ?? {};
  if (lp.exists === false) {
    add('medium', '尚未建立 LP', '仍在 bonding curve 阶段，没有真实流动性池。');
  } else if (lp.burned) {
    add('good', 'LP 已销毁', '流动性凭证已发送至销毁地址，无法撤池。');
  } else if (lp.locked) {
    add('good', 'LP 已锁定', `锁定至 ${lp.unlockAt ?? '未知时间'}${lp.locker ? `（${lp.locker}）` : ''}。`);
  } else if (lp.singleHolder) {
    veto('LP 未锁未销毁', `LP 由单一热钱包 ${lp.holder ?? '未知'} 持有，项目方可随时撤池跑路。`);
  } else if (lp.exists === true || lp.holder !== undefined) {
    // 确认存在 LP，但锁仓状态查不到 —— 这是风险，不是安全
    add('high', 'LP 锁定状态未知', '已确认存在流动性池，但未能链上核实 LP 已锁或已销毁，存在撤池风险。');
  }
  // lp 完全为空：不在此处下结论，避免把「没数据」误判成「有风险」

  if (c.isMutableMetadata) {
    add('low', 'Metadata 可变', '项目方可修改名称/图标，常见但可被用于伪装。');
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
