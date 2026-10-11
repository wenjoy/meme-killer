/**
 * 引擎与各维度分析器的行为验证。
 *
 * 这些测试锁定的不是「分数等于多少」，而是**判定逻辑的正确性**：
 * 误报防线（池持仓剔除）、漏报防线（蜜罐识别）、
 * 以及「未知 ≠ 安全」这一最容易被写错的降级行为。
 *
 * 运行：npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scan, sortFindings } from './engine.ts';
import { analyzeHolders, classifyHolder } from './analyzers/holders.ts';
import { analyzeLiquidity } from './analyzers/liquidity.ts';
import { analyzeContract } from './analyzers/contract.ts';
import { analyzeDeveloper } from './analyzers/developer.ts';
import { analyzeSocial } from './analyzers/social.ts';
import { bandFor, scoreFromFindings } from './constants.ts';
import {
  TEST_META,
  emptyInput,
  healthyInput,
  honeypotInput,
  openMintInput,
  rugInput,
} from './fixtures.ts';
import type { HolderRow, RawHolder, ScanInput } from './types.ts';

const meta = {
  source: 'test',
  live: false,
  fetchedAt: new Date().toISOString(),
  origins: {},
  warnings: [],
};

function input(partial: Partial<ScanInput>): ScanInput {
  return { token: { mint: 'TestMint', symbol: 'TEST', supply: 1_000_000_000 }, ...partial, meta };
}

// ── 1. 最大误报源：池持仓必须剔除 ─────────────────────────────────
test('池与 burn 持仓被剔除后，流通盘分散的项目不会被误判为庄家控盘', () => {
  const data = input({
    // 池 60% + burn 10%，流通盘只剩 30%，而且这 30% 分散在 60 个钱包里
    holders: [
      { address: 'pool', amount: 0, pct: 60, isPool: true },
      { address: 'burn', amount: 0, pct: 10, isBurn: true },
      ...Array.from({ length: 60 }, (_, i) => ({
        address: `retail${i}`,
        amount: 0,
        pct: 0.5,
      })),
    ],
  });
  const r = analyzeHolders(data);
  assert.equal(r.vetoed, false, '剔除池后不应触发集中度否决');
  assert.ok((r.metrics!.excludedPct as number) === 70, '剔除比例应为 70%');
  assert.equal(r.metrics!.circulatingPct, 30, '流通盘 = 100 − 70');
  // 前 10 大散户 0.5% × 10 = 5%（占总供应），占流通盘 5/30 ≈ 16.7%
  assert.equal(r.metrics!.top10PctOfSupply, 5);
  assert.ok(Math.abs(Number(r.metrics!.top10Pct) - 16.667) < 0.01, '占流通盘 ≈ 16.7%');
});

// ── 1b. 口径回归：薄浮筹必须被报出来（这里曾经漏报）────────────────
test('锁仓/大池把流通盘压薄时，前十握着的其实就是浮筹的大头 —— 不能报成「健康」', () => {
  // 同一份「池 60% + burn 10%」的数据，但流通盘 30% 只落在 12 个钱包手里：
  // 每个 2% 总供应 → 前 10 名合计 20% 总供应，却是 20/30 ≈ 66.7% 的流通盘。
  // 旧实现拿 20% 去比 25% 警戒线，直接放过去（然后写下「占流通盘 20%」）。
  const r = analyzeHolders(
    input({
      holders: [
        { address: 'pool', amount: 0, pct: 60, isPool: true },
        { address: 'burn', amount: 0, pct: 10, isBurn: true },
        ...Array.from({ length: 12 }, (_, i) => ({ address: `retail${i}`, amount: 0, pct: 2 })),
      ],
    }),
  );
  assert.equal(r.metrics!.top10PctOfSupply, 20, '分子仍是占总供应量的 20%');
  assert.ok(
    Math.abs(Number(r.metrics!.top10Pct) - 66.667) < 0.01,
    `占流通盘应该是 20/30 ≈ 66.7%，实际 ${r.metrics!.top10Pct}`,
  );
  assert.equal(r.vetoed, true, '握着流通盘 2/3 的前十名必须触发否决');
  const f = r.findings.find((x) => x.title.includes('过度集中'));
  assert.ok(f, '必须给出集中度 finding');
  assert.ok(f.detail.includes('占流通盘'), '措辞要写清是「占流通盘」，因为数字确实换过分母了');
});

test('池持仓不剔除时本会误报 —— 证明剔除逻辑确实在起作用', () => {
  // 用真实的 base58 风格地址，避免地址文本本身命中池标签模式而干扰本测试
  const poolAddr = 'RaydiumPoolV4xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const holders: RawHolder[] = [
    { address: poolAddr, amount: 0, pct: 60, isPool: true },
    ...Array.from({ length: 60 }, (_, i) => ({ address: `Retail${i}Addr`, amount: 0, pct: 0.5 })),
  ];
  const withPool = analyzeHolders(input({ holders }));
  // 流通盘 40%，前十名 5%（占总供应）= 12.5% 流通盘
  assert.equal(withPool.metrics!.circulatingPct, 40);
  assert.ok(Math.abs(Number(withPool.metrics!.top10Pct) - 12.5) < 1e-9);

  // 同样的数据，但池地址既没有 isPool 标记、也不在 poolAddresses 里：
  // 池那 60% 会被当成普通持有人，分子飙到 64.5%、分母退回 100% → 触发否决。
  // 这说明「识别并剔除池」这一步不可省。
  const noPoolFlag = analyzeHolders(
    input({
      holders: holders.map((h, i) => ({
        ...h,
        address: `Unmarked${i}Wallet`,
        isPool: false,
        label: undefined,
      })),
    }),
  );
  assert.ok((noPoolFlag.metrics!.top10Pct as number) > 40, '未识别池时集中度必然虚高');
  assert.equal(noPoolFlag.vetoed, true, '未识别池地址时确实会误报，说明剔除步骤不可省');
});

test('classifyHolder 按优先级正确分类', () => {
  const creator = 'devAddr';
  assert.equal(classifyHolder({ address: 'pool', amount: 0, isPool: true }), 'pool');
  assert.equal(
    classifyHolder({ address: 'RaydiumPoolXYZ', amount: 0 }, {}),
    'pool',
    '标签模式应能识别池',
  );
  assert.equal(classifyHolder({ address: '1nc1nerator11111111111111111111111111111111', amount: 0 }), 'burn');
  assert.equal(classifyHolder({ address: creator, amount: 0 }, { creator }), 'dev');
  assert.equal(classifyHolder({ address: 'x', amount: 0, isSniper: true }, { creator }), 'sniper');
  assert.equal(classifyHolder({ address: 'x', amount: 0 }, { creator }), 'retail');
});

// ── 2. 漏报防线：蜜罐识别 ────────────────────────────────────────
test('买盘一边倒但卖单笔数极少 → 识别为蜜罐并否决', () => {
  const r = analyzeLiquidity(
    input({
      liquidity: {
        graduated: true,
        buyVolumeSol: 240,
        sellVolumeSol: 7,
        buyCount: 1180,
        sellCount: 21, // 1.7% 卖单笔数
      },
    }),
  );
  assert.equal(r.vetoed, true);
  assert.ok(r.findings.some((f) => f.title.includes('蜜罐') || f.title.includes('无法卖出')));
});

test('卖单笔数占比正常时，同样的买盘优势不会被误判为蜜罐', () => {
  const r = analyzeLiquidity(
    input({
      liquidity: {
        graduated: true,
        buyVolumeSol: 240,
        sellVolumeSol: 40,
        buyCount: 1180,
        sellCount: 700, // 37% 卖单笔数 —— 正常
      },
    }),
  );
  assert.equal(r.vetoed, false, '卖单笔数健康时不应触发蜜罐否决');
});

// ── 3. 笔数/金额背离与刷量 ───────────────────────────────────────
test('高笔数低净流入 → 判为刷量', () => {
  const r = analyzeLiquidity(
    input({
      liquidity: { buyVolumeSol: 50, sellVolumeSol: 49.9, buyCount: 400, sellCount: 380 },
    }),
  );
  assert.ok(r.findings.some((f) => f.title.includes('刷量')));
});

test('小额买盘撑笔数、大额卖盘出货 → 判为背离', () => {
  const r = analyzeLiquidity(
    input({
      liquidity: {
        buyVolumeSol: 30,
        sellVolumeSol: 90,
        buyCount: 900,
        sellCount: 200,
        graduated: true,
        realSolReserves: 40,
      },
    }),
  );
  assert.ok(
    r.findings.some((f) => f.title.includes('背离') || f.title.includes('抛压')),
    '应识别出笔数与金额的背离或抛压',
  );
});

// ── 4. 合约安全：权限与 Token-2022 扩展 ──────────────────────────
test('mint authority 未放弃 → 硬否决', () => {
  const r = analyzeContract(input({ contract: { mintAuthority: 'someaddr' } }));
  assert.equal(r.vetoed, true);
  assert.equal(r.score, 100);
});

test('Token-2022 的 transferHook / permanentDelegate → 硬否决', () => {
  const r = analyzeContract(
    input({
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
        extensions: ['transferHook'],
      },
    }),
  );
  assert.equal(r.vetoed, true);
  assert.ok(r.findings.some((f) => f.title.includes('转账钩子')));
});

test('权限已弃且经典 SPL Token → 无否决且给出积极信号', () => {
  const r = analyzeContract(
    input({ contract: { mintAuthority: null, freezeAuthority: null, lp: { exists: true, burned: true } } }),
  );
  assert.equal(r.vetoed, false);
  assert.ok(r.findings.some((f) => f.severity === 'good'));
});

// ── 5. 降级行为：未知 ≠ 安全 ─────────────────────────────────────
test('社交数据缺失时标记为缺失，而非给出「0 分 = 很安全」的假象', () => {
  const r = analyzeSocial(input({ social: undefined }));
  assert.equal(r.score, 0);
  assert.ok(
    r.findings.some((f) => f.title.includes('缺失')),
    '必须显式提示数据缺失，否则用户会把 0 分误读为安全',
  );
  assert.equal(r.metrics!.available, 0);
});

// ── 6. 引擎整体行为 ──────────────────────────────────────────────
test('命中否决时建议仓位为 0%', () => {
  const r = scan(input({ contract: { mintAuthority: 'x' } }));
  assert.equal(r.vetoed, true);
  assert.equal(r.advice.size, '0%');
  assert.ok(r.summary.includes('硬否决'));
});

test('命中否决时综合分必须为满分，不能出现「37 分 + 否决」的矛盾结论', () => {
  // 除权限外其它维度都很干净 —— 若按加权算会得到中等分，
  // 但一票否决的存在必须让总分与等级保持一致。
  const r = scan(
    input({
      contract: { mintAuthority: 'x' },
      liquidity: { graduated: true, buyVolumeSol: 100, sellVolumeSol: 80, buyCount: 900, sellCount: 600 },
      holders: Array.from({ length: 12 }, (_, i) => ({ address: `Retail${i}`, amount: 0, pct: 1.5 })),
      social: { mentions24h: 1500, suspectedBotRatio: 0.1, engagementRatio: 0.4, uniqueAuthors: 500 },
    }),
  );
  assert.equal(r.vetoed, true);
  assert.equal(r.score, 100, '有否决就必须是满分风险，分数与结论不能互相矛盾');
  assert.equal(r.band.level, 'CRITICAL');
});

test('仅权限未弃（其余维度干净）也必须满分，不能被其它维度的低分拉回来', () => {
  const r = scan(openMintInput());
  assert.equal(r.vetoed, true);
  assert.equal(r.score, 100);
  assert.equal(r.advice.size, '0%');
});

test('全维度数据缺失时不得给出买入建议 —— 未知不等于高危，也不等于安全', () => {
  const r = scan({ meta } as unknown as ScanInput);
  assert.equal(r.vetoed, false, '没有数据就不该凭空产生否决');
  assert.ok(r.coverage < 40, `覆盖率应很低，实际 ${r.coverage}`);
  assert.equal(r.advice.size, '—', '覆盖率不足时必须拒绝给仓位建议');
  assert.ok(r.advice.text.includes('数据不足'));
  // 关键：不能因为「读不到数据」就报出一个看起来确定的风险分
  assert.ok(r.score < 30, `数据缺失不应产生高分，实际 ${r.score}`);
});

test('数据缺失的维度标记 available=0，与「检查过且安全」区分开', () => {
  const r = scan(input({ contract: null, liquidity: null }));
  assert.equal(r.dimensions.contract.metrics?.available, 0);
  assert.equal(r.dimensions.liquidity.metrics?.available, 0);
  assert.ok(
    r.dimensions.contract.findings.some((f) => f.title.includes('缺失')),
    '必须显式说明数据缺失',
  );
});

test('覆盖率过低时，分数与等级都必须作废，不能只改文案', () => {
  // 真实故障场景：网络不通导致所有数据源失败。
  // 此时若仍展示「12.6 低风险」的绿色大数字，会直接盖过「数据不足」的提示。
  const r = scan({
    token: { mint: 'SomeMint' },
    contract: null,
    liquidity: null,
    holders: [],
    developer: null,
    social: null,
    meta,
  });
  assert.ok(r.coverage < 40);
  assert.equal(r.band.label, '数据不足', '等级必须显示为「数据不足」而非「低风险」');
  assert.equal(r.band.verdict, '无法评估');
  assert.notEqual(r.band.tone, 'success', '不得使用绿色安全色调');
  assert.equal(r.advice.size, '—');
});

test('权限未读到 ≠ 权限已放弃（避免假安全标记）', () => {
  const unknown = analyzeContract(input({ contract: {} }));
  assert.notEqual(unknown.metrics?.mintAuthorityRevoked, 1, '未读到的权限不能标记为「已放弃」');

  const revoked = analyzeContract(input({ contract: { mintAuthority: null, freezeAuthority: null } }));
  assert.equal(revoked.metrics?.mintAuthorityRevoked, 1);
  assert.equal(revoked.metrics?.freezeAuthorityRevoked, 1);

  const open = analyzeContract(input({ contract: { mintAuthority: 'attacker' } }));
  assert.equal(open.metrics?.mintAuthorityRevoked, 0);
});

test('权限读到 null 才算已放弃；字段缺失不当作利好', () => {
  const confirmed = analyzeContract(
    input({ contract: { mintAuthority: null, freezeAuthority: null } }),
  );
  assert.ok(confirmed.findings.some((f) => f.title === '权限已放弃'));

  // contract 段存在但权限字段没读到 → 只能是「未知」，不能是「已放弃」
  const unknown = analyzeContract(input({ contract: {} }));
  assert.ok(
    !unknown.findings.some((f) => f.title === '权限已放弃'),
    '未读到权限字段时不得声称权限已放弃',
  );
  assert.ok(unknown.findings.some((f) => f.title.includes('未知')));
});

test('单个维度抛错不会让整次扫描崩溃，且错误被显式暴露', () => {
  // holders 不是数组 —— provider 写错时的真实形态
  const broken = {
    token: { mint: 'x', symbol: 'BROKEN', supply: 1e9 },
    holders: 'oops' as unknown as ScanInput['holders'],
    meta,
  } as ScanInput;
  const r = scan(broken);
  assert.ok(r.dimensions.holders, '维度结果仍然存在');
  const errored = Object.values(r.dimensions).filter((d) => d.error);
  assert.ok(errored.length > 0, '出错维度必须带 error 字段，不能静默吞掉');
  // 出错的维度不能悄悄变成「0 分 = 安全」
  assert.ok(
    errored.every((d) => d.findings.some((f) => f.title.includes('失败') || f.title.includes('缺失'))),
    '出错维度必须有可读的说明',
  );
});

test('模型必须具备区分度：健康 / 蜜罐 / 典型 rug 分数必须拉开', () => {
  const healthy = scan(healthyInput());
  const honeypot = scan(honeypotInput());
  const rug = scan(rugInput());

  assert.equal(healthy.vetoed, false, '健康样本不应触发否决');
  assert.equal(honeypot.vetoed, true, '蜜罐必须触发否决');
  assert.equal(rug.vetoed, true, '典型 rug 必须触发否决');

  assert.ok(healthy.score < 25, `健康样本应落在低风险区间，实际 ${healthy.score}`);
  assert.ok(
    rug.score - healthy.score > 40,
    `区分度不足：健康 ${healthy.score} vs rug ${rug.score}`,
  );
  // 蜜罐与 rug 都该是满分风险
  assert.equal(honeypot.score, 100);
  assert.equal(rug.score, 100);

  // 三种极端场景的仓位建议必须不同 —— 这是用户最终要看的结论
  assert.equal(healthy.advice.size, '≤ 5%');
  assert.equal(honeypot.advice.size, '0%');
  assert.equal(rug.advice.size, '0%');
});

test('只依赖权限的否决与依赖多项的否决，结论一致（都是一票判死）', () => {
  const onlyPermission = scan(openMintInput());
  const everything = scan(rugInput());
  assert.equal(onlyPermission.score, everything.score, '否决数量不应影响结论强度');
  assert.equal(onlyPermission.vetoes.length, 1);
  assert.ok(everything.vetoes.length > 1);
  assert.equal(onlyPermission.advice.size, everything.advice.size);
});

test('风险等级边界正确', () => {
  assert.equal(bandFor(0).level, 'LOW');
  assert.equal(bandFor(24.9).level, 'LOW');
  assert.equal(bandFor(25).level, 'MEDIUM');
  assert.equal(bandFor(45).level, 'HIGH');
  assert.equal(bandFor(65).level, 'CRITICAL');
});

test('scoreFromFindings 不让多个中危淹没一个高危', () => {
  const oneHigh = scoreFromFindings([{ severity: 'high' }]);
  assert.equal(oneHigh, 55);
  const manyMedium = scoreFromFindings(Array.from({ length: 5 }, () => ({ severity: 'medium' })));
  assert.ok(oneHigh > 28, '单个高危必须完整计入');
  assert.ok(manyMedium <= 100);
});

test('sortFindings 按严重度排序，good 排最后', () => {
  const sorted = sortFindings([
    { severity: 'good', title: 'g', detail: '' },
    { severity: 'critical', title: 'c', detail: '' },
    { severity: 'medium', title: 'm', detail: '' },
  ]);
  assert.deepEqual(sorted.map((f) => f.severity), ['critical', 'medium', 'good']);
});

test('开发者/持仓数据缺失时覆盖率必须下降，不能虚高', () => {
  // 真实故障形态：RPC 与 DexScreener 都挂了，只剩 contract 段是空的。
  // 修复前 developer/holders 从不标记 available，覆盖率会虚高到 65%，
  // 让一次「什么都没查到」的扫描看起来像一份完整报告。
  const partial = scan({
    token: { mint: 'X' },
    contract: { mintAuthority: null, freezeAuthority: null },
    liquidity: null,
    holders: [],
    developer: null,
    social: null,
    meta,
  });
  // 只有 contract 可用，其余 4 个维度都缺失 → 权重 0.30
  assert.equal(partial.coverage, 30, `覆盖率应等于合约维度的权重，实际 ${partial.coverage}`);
  assert.equal(partial.band.label, '数据不足');
  assert.equal(partial.advice.size, '—');
});

test('参与评分的维度数据齐全时覆盖率必须是 100%，不能被误判为数据不足', () => {
  // ⚠️ 钻石手是权重 0 的中性维度：它没数据**不会**拉低覆盖率，
  // 下面这些 fixture 都没有 diamond 输入，覆盖率仍必须是 100%。
  // 覆盖率算错的两种后果都很严重：虚高会把「什么都没查到」包装成完整报告，
  // 虚低则会把一份完整报告误标为「数据不足」，让用户白白放弃有效结论。
  for (const [name, data] of [
    ['healthy', healthyInput()],
    ['honeypot', honeypotInput()],
    ['rug', rugInput()],
    ['openMint', openMintInput()],
  ] as const) {
    const r = scan(data);
    assert.equal(r.coverage, 100, `${name} 覆盖率应为 100%，实际 ${r.coverage}`);
    assert.notEqual(r.band.label, '数据不足', `${name} 不应被判为数据不足`);
  }
});

test('社交维度缺失时覆盖率降到 90%，但不应否决整个结论', () => {
  // 社交数据当前无来源，这是最常见的真实形态：
  // 少一个 10% 权重的维度，仍然足以给出结论。
  const data = { ...healthyInput(), social: null };
  const r = scan(data);
  assert.equal(r.coverage, 90);
  assert.notEqual(r.band.label, '数据不足');
  assert.notEqual(r.advice.size, '—');
});

test('夹具覆盖了所有极端场景，且都很明确（防止夹具本身退化）', () => {
  assert.equal(scan(healthyInput()).vetoed, false);
  assert.equal(scan(honeypotInput()).vetoed, true);
  assert.equal(scan(rugInput()).vetoed, true);
  assert.equal(scan(openMintInput()).vetoed, true);
  assert.equal(scan(emptyInput()).coverage, 0);
});

// ── 回归测试：真实链上数据踩出来的两个误判 ──────────────────────────
// 这两个 bug 都是在真实 mint 上跑出来的，且都是「静默给出相反结论」，
// 所以必须有测试锁住。

test('【回归】creator 链上仍持有筹码时，绝不能报「部署者已清仓」', () => {
  // 实测场景：流水口径算出卖出/买入 = 100%，但链上余额还有 27.6% 供应量。
  // 原因：交易历史窗口有限，买与卖落在不同窗口里。
  const data = healthyInput();
  data.developer = {
    ...data.developer!,
    devSoldRatio: 1, // 流水：全卖了
    devFullyExited: false, // 链上：仍持有（权威判据）
    devCurrentBalance: 553_297_097,
  };
  const r = scan(data);
  const dev = r.dimensions.developer;
  assert.equal(dev.vetoed, false, '余额不为零就不能判清仓');
  assert.ok(
    !dev.findings.some((f) => f.title.includes('已清仓')),
    '不得出现「部署者已清仓」',
  );
  assert.equal(r.vetoed, false);
});

test('【回归】清仓状态未知时也不得判死（未知 ≠ 已跑路）', () => {
  const data = healthyInput();
  data.developer = { ...data.developer!, devSoldRatio: 1, devFullyExited: undefined };
  const r = scan(data);
  const dev = r.dimensions.developer;
  assert.ok(!dev.findings.some((f) => f.veto), '无法确认时不能否决');
  assert.ok(dev.findings.some((f) => f.title.includes('有过卖出')), '应降级为提示');
});

test('【回归】确认清仓时才允许硬否决', () => {
  const data = healthyInput();
  data.developer = { ...data.developer!, devSoldRatio: 1, devFullyExited: true, devCurrentBalance: 0 };
  const r = scan(data);
  assert.equal(r.dimensions.developer.vetoed, true);
  assert.equal(r.score, 100);
});

test('【回归】dev 的筹码不能被当成流动性池剔除', () => {
  // 实测场景：dev 持有 46% 供应量，因频繁卖出曾被误 classify 为 pool，
  // 报告显示「持仓分布健康」，把高度集中的币判成安全。
  const data = healthyInput();
  const devAddr = data.developer!.creator!;
  data.holders = [
    { address: devAddr, amount: 923_340_303, pct: 46.2 },
    ...Array.from({ length: 9 }, (_, i) => ({
      address: `Retail${i}Walletxxxxxxxxxxxxxxxxxxxxxxxxxx`,
      amount: 50_000_000,
      pct: 2.5,
    })),
  ];
  data.liquidity = { ...data.liquidity!, poolAddresses: [] };
  const r = scan(data);
  const m = r.dimensions.holders.metrics as Record<string, number>;
  assert.ok(m.devClusterPct > 40, `dev 持仓应被计入，实际 ${m.devClusterPct}`);
  assert.equal(m.byKind && (m as never as { byKind: { pool: number } }).byKind.pool, 0, '不得把 dev 记成池');
  assert.equal(r.dimensions.holders.vetoed, true, 'Top10 93% 必须触发集中度否决');
});

// ── 锁仓 / 托管持仓：锁仓剔除但必须列出，多签只列出不剔除 ──────────
test('时间锁仓从集中度中剔除，但仍被单独列出（不能剔除后看不见）', () => {
  const data = input({
    holders: [
      // 锁仓 50%：解锁前不能卖，所以不计入 Top10
      {
        address: 'LockedVault111111111111111111111111111111',
        amount: 0,
        pct: 50,
        custody: {
          programId: 'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn',
          kind: 'timelock',
          label: 'Jupiter Lock（锁仓）',
          unlockAtUnknown: true,
        },
      },
      ...Array.from({ length: 60 }, (_, i) => ({ address: `Retail${i}Addr`, amount: 0, pct: 0.4 })),
    ],
  });
  const r = analyzeHolders(data);

  assert.equal(r.metrics!.timelockPct, 50, '锁仓占比应被统计');
  assert.equal(r.metrics!.circulatingPct, 50, '锁仓 50% 之后流通盘就是 50%');
  assert.ok(
    Math.abs(Number(r.metrics!.top10PctOfSupply) - 4) < 1e-9,
    'Top10 只算 10 个散户 = 4%（占总供应），不含锁仓',
  );
  assert.ok(Math.abs(Number(r.metrics!.top10Pct) - 8) < 1e-9, '占流通盘 = 4/50 = 8%');
  assert.equal(r.vetoed, false, '锁仓不该触发集中度否决');

  // 必须列出来，而不是悄悄剔除
  const list = r.metrics!.custody as { kind: string; pct: number; unlockAtUnknown?: boolean }[];
  assert.equal(list.length, 1, '锁仓仓位必须出现在 custody 列表里');
  assert.equal(list[0].kind, 'timelock');
  assert.equal(list[0].pct, 50);
  assert.equal(list[0].unlockAtUnknown, true, '解锁时间读不到时必须标为未知，不能留空冒充「无锁」');

  const f = r.findings.find((x) => x.title.includes('锁仓持仓'));
  assert.ok(f, '应有专门的锁仓 finding');
  assert.ok(f.detail.includes('待接入'), '解锁时间未知必须如实说明');
});

test('【回归】所有占比类阈值必须用同一个分母（流通盘），不能有的用总量有的用流通盘', () => {
  // 50% 被锁仓 → 流通盘只有 50%。dev 持 8% 总供应 = 16% 流通盘，已过 15% 阈值。
  // 旧实现拿 8% 去比 15%，报「dev 持仓在合理范围」—— 同一份报告里
  // Top10 用流通盘、dev 用总量，读者看到两个数会以为能相加。
  const r = analyzeHolders(
    input({
      developer: { creator: 'devaddr', launchWallet: 'devaddr' },
      holders: [
        {
          address: 'LockedVault111111111111111111111111111111',
          amount: 0,
          pct: 50,
          custody: {
            programId: 'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn',
            kind: 'timelock',
            label: 'Jupiter Lock（锁仓）',
          },
        },
        { address: 'devaddr', amount: 0, pct: 8 },
        ...Array.from({ length: 40 }, (_, i) => ({ address: `Retail${i}Addr`, amount: 0, pct: 0.75 })),
      ],
    }),
  );
  const m = r.metrics!;
  assert.equal(m.circulatingPct, 50, '流通盘 = 100 − 50');
  assert.ok(Math.abs(Number(m.devClusterPct) - 8) < 1e-9, '总量口径下 dev 是 8%');
  assert.ok(
    Math.abs(Number(m.devClusterPctOfCirculating) - 16) < 1e-9,
    `流通盘口径应该是 16%，实际 ${m.devClusterPctOfCirculating}`,
  );
  const f = r.findings.find((x) => x.title.includes('dev 持仓偏高'));
  assert.ok(f, '16% 流通盘必须报出来，不能因为「8% 小于 15%」而放过');
  assert.ok(f.detail.includes('流通盘') && f.detail.includes('占总供应'), '两个口径都要写出来，读者才能和上面的表格对账');
});

test('多签/程序托管**不**剔除，仍计入集中度（防止把能砸盘的巨鲸放过去）', () => {
  const data = input({
    holders: [
      {
        address: 'SquadsMultisig111111111111111111111111111',
        amount: 0,
        pct: 50,
        custody: {
          programId: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
          kind: 'multisig',
          label: 'Squads 多签金库',
        },
      },
      ...Array.from({ length: 12 }, (_, i) => ({ address: `Retail${i}Addr`, amount: 0, pct: 2 })),
    ],
  });
  const r = analyzeHolders(data);

  assert.equal(r.metrics!.timelockPct, 0, '多签不是时间锁');
  assert.equal(r.metrics!.otherCustodyPct, 50, '多签应单独统计');
  // 多签占掉前 10 的一个名额：50% + 其余 9 个散户 × 2% = 68%
  assert.equal(r.metrics!.top10Pct, 68, '多签 50% 必须计入 Top10（50 + 9×2）');
  assert.equal(r.vetoed, true, '50% 的多签足以砸盘，必须触发集中度否决');

  const f = r.findings.find((x) => x.title.includes('程序托管持仓'));
  assert.ok(f, '应有托管持仓 finding');
  assert.ok(f.detail.includes('不是时间锁'), '必须说清多签不是时间锁');
});

test('同一批持仓，把锁仓误判为普通持仓会得出完全相反的结论', () => {
  // 对照组：50% 的仓位是「散户」，会立刻触发 Top10 否决
  const asRetail = analyzeHolders(
    input({
      holders: [
        { address: 'Whale11111111111111111111111111111111111', amount: 0, pct: 50 },
        ...Array.from({ length: 12 }, (_, i) => ({ address: `Retail${i}Addr`, amount: 0, pct: 2 })),
      ],
    }),
  );
  assert.equal(asRetail.vetoed, true, '当作散户时会否决');

  // 若真为锁仓，则不该否决 —— 说明「识别锁仓」这一步直接决定结论
  const asLock = analyzeHolders(
    input({
      holders: [
        {
          address: 'Whale11111111111111111111111111111111111',
          amount: 0,
          pct: 50,
          custody: { programId: 'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn', kind: 'timelock', label: 'L' },
        },
        ...Array.from({ length: 12 }, (_, i) => ({ address: `Retail${i}Addr`, amount: 0, pct: 2 })),
      ],
    }),
  );
  assert.equal(asLock.vetoed, false, '识别为锁仓后不应否决');
});

test('多签即使很大也算巨鲸（托管 ≠ 锁定）', () => {
  const data = input({
    holders: [
      {
        address: 'SquadsMultisig222222222222222222222222222',
        amount: 0,
        pct: 30,
        custody: { programId: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf', kind: 'multisig', label: 'Squads 多签金库' },
      },
      ...Array.from({ length: 12 }, (_, i) => ({ address: `Retail${i}Addr`, amount: 0, pct: 1 })),
    ],
  });
  const r = analyzeHolders(data);
  const f = r.findings.find((x) => x.title === '存在单一巨鲸');
  assert.ok(f, '多签持仓超过阈值时仍应报巨鲸，因为多签可随时签名转出');
  assert.ok(f.detail.includes('托管不等于锁定'));
});

// ── 9. 「死字段」回归：字段没人写 ≠ 字段是 false ─────────────────
// 这一组测试锁的是同一类结构性 bug：schema 里声明了字段、分析器消费了它，
// 但没有任何 provider 会写入。结果是分支永远走同一条、结论永远错。
// 修法：要么接真实数据源把它填上，要么删掉字段与分支，绝不保留「看起来在检查」的死代码。
test('LP 已确认未锁定 → 报「未锁未销毁」，不能退化成「未知」', () => {
  const r = analyzeContract(
    input({
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        // 实测形状：pump_fun_amm 池 lpLockedPct≈0，单一地址持有 100% LP
        lp: { exists: true, locked: false, lockedPct: 0.0000041, singleHolder: true, holder: 'Creator111' },
      },
    }),
  );
  assert.equal(r.vetoed, true, '单一地址持有全部未锁 LP = 随时可撤池，必须否决');
  const f = r.findings.find((x) => x.title === 'LP 未锁未销毁');
  assert.ok(f, '必须报出「未锁未销毁」，而不是含糊的「未知」');
  assert.ok(f.detail.includes('Creator111'), '要点名那个地址');
});

test('只拿到比例、拿不到持有者明细 → 报「持有人无法核实」，而不是「未知」也不是「可以撤池」', () => {
  // lockedPct 只是「不在流通中的比例」。没有持有者明细时无从判断剩下的在谁手里，
  // 所以既不能下撤池结论（可能全是第三方/锁仓），也不能说成安全。
  const r = analyzeContract(
    input({
      contract: { mintAuthority: null, freezeAuthority: null, lp: { exists: true, locked: false, lockedPct: 0 } },
    }),
  );
  assert.ok(
    !r.findings.some((f) => f.title === 'LP 锁定状态未知'),
    '有 RugCheck 比例就不该退回「完全未知」',
  );
  assert.ok(r.findings.some((f) => f.title === '流通中的 LP 持有人无法核实' && f.severity === 'medium'));
});

test('LP 已锁定/已销毁必须是可达的积极信号（曾经永远走不到）', () => {
  const locked = analyzeContract(
    input({ contract: { mintAuthority: null, freezeAuthority: null, lp: { exists: true, locked: true, lockedPct: 100, locker: 'Printr Stake Pool' } } }),
  );
  assert.ok(locked.findings.some((f) => f.title === 'LP 已锁定/不可撤' && f.severity === 'good'));
  const burned = analyzeContract(
    input({ contract: { mintAuthority: null, freezeAuthority: null, lp: { exists: true, burned: true, lockedPct: 100 } } }),
  );
  assert.ok(burned.findings.some((f) => f.title === 'LP 已销毁' && f.severity === 'good'));
});

test('LP 状态拿不到时仍然是「未知」，不能被当成安全', () => {
  const r = analyzeContract(
    input({ contract: { mintAuthority: null, freezeAuthority: null, lp: { exists: true } } }),
  );
  assert.ok(r.findings.some((f) => f.title === 'LP 锁定状态未知' && f.severity === 'high'));
});

test('金额只有 USD 口径时不得算净流入，也不得用它判刷量', () => {
  const r = analyzeLiquidity(
    input({
      liquidity: { buyVolumeUsd: 24000, sellVolumeUsd: 23800, buyCount: 400, sellCount: 380 },
    }),
  );
  assert.equal(r.metrics!.netInflowSol, undefined, 'USD 值不能当 SOL 净流入');
  assert.ok(!r.findings.some((f) => f.title === '疑似刷量'), '没有 SOL 口径就不能判刷量');
  assert.ok(r.findings.some((f) => f.title === '刷量无法判定'), '但必须说明为什么判定不了');
  assert.ok(typeof r.metrics!.sellSharePct === 'number', '与单位无关的占比仍然可算');
  assert.equal(r.metrics!.volumeUnit, 'USD');
});

test('金额有 SOL 口径时净流入与刷量判定照常生效', () => {
  const r = analyzeLiquidity(
    input({ liquidity: { buyVolumeSol: 50, sellVolumeSol: 49.9, buyCount: 400, sellCount: 380 } }),
  );
  assert.equal(r.metrics!.volumeUnit, 'SOL');
  assert.ok(typeof r.metrics!.netInflowSol === 'number');
  assert.ok(r.findings.some((f) => f.title === '疑似刷量'));
});

test('只有持有人数、没有任何成交深度 → 仍然标为「流动性数据缺失」且不计分', () => {
  // 这一条防止「RugCheck 顺手带回来的 holderCount」把维度伪装成已评估
  const r = analyzeLiquidity(input({ liquidity: { holderCount: 748 } }));
  assert.equal(r.metrics!.available, 0);
  assert.ok(r.findings.some((f) => f.title === '流动性数据缺失'));
  assert.equal(r.score, 0);
});

test('curve 内真实 SOL 有值时才判深度，没值不造 0', () => {
  const low = analyzeLiquidity(input({ liquidity: { graduated: false, realSolReserves: 0.8 } }));
  assert.ok(low.findings.some((f) => f.title === 'curve 内真实 SOL 极低'));
  assert.equal(low.metrics!.realSolReserves, 0.8);

  const unknown = analyzeLiquidity(input({ liquidity: { graduated: false, buyCount: 10, sellCount: 5 } }));
  assert.equal(unknown.metrics!.realSolReserves, undefined, '拿不到储备就不要写 0');
});

test('狙击占比未知时不下结论；同一事实只在持币维度扣一次分', () => {
  const unknown = analyzeLiquidity(input({ liquidity: { graduated: true, buyVolumeSol: 10, sellVolumeSol: 5, buyCount: 40, sellCount: 30 } }));
  assert.equal(unknown.metrics!.sniperHoldPct, undefined, '拿不到最早成交就是未知，不是 0');

  const known = analyzeLiquidity(input({ liquidity: { graduated: true, buyVolumeSol: 10, sellVolumeSol: 5, buyCount: 40, sellCount: 30, sniperHoldPct: 38 } }));
  assert.equal(known.metrics!.sniperHoldPct, 38);
  assert.ok(!known.findings.some((f) => f.title.includes('狙击')), '流动性维度不再重复扣分');

  const h = analyzeHolders(
    input({
      holders: [
        { address: 'Sniper111111111111111111111111111111111111', amount: 0, pct: 30, isSniper: true },
        ...Array.from({ length: 12 }, (_, i) => ({ address: `Retail${i}Addr`, amount: 0, pct: 2 })),
      ],
    }),
  );
  assert.ok(h.findings.some((f) => f.title === '狙击钱包筹码偏多'), '持币维度负责出结论');
  assert.ok(h.findings.find((f) => f.title === '狙击钱包筹码偏多')!.detail.includes('下限'));
});

test('尘埃级程序托管仓位不再单独提示（0.0% 的提示会淹没真信号）', () => {
  const dust = analyzeHolders(
    input({
      holders: [
        { address: 'Dust1111', amount: 0, pct: 0.0034, custody: { programId: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf', kind: 'multisig', label: 'Squads 多签金库' } },
        { address: 'Retail1111', amount: 0, pct: 5 },
      ],
    }),
  );
  assert.ok(!dust.findings.some((f) => f.title.includes('程序托管持仓')), '0.003% 不值得单独提示');
  assert.ok(Math.abs((dust.metrics!.otherCustodyPct as number) - 0.0034) < 1e-9, '指标仍然如实记录');

  const real = analyzeHolders(
    input({
      holders: [
        { address: 'Big1111', amount: 0, pct: 30, custody: { programId: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf', kind: 'multisig', label: 'Squads 多签金库' } },
        ...Array.from({ length: 12 }, (_, i) => ({ address: `Retail${i}Addr`, amount: 0, pct: 1 })),
      ],
    }),
  );
  assert.ok(real.findings.some((f) => f.title.includes('程序托管持仓')), '真实体量的托管必须提示');
});

test('有历史发币但结局未核实 → 不得输出「历史记录干净」', () => {
  const r = analyzeDeveloper(
    input({ developer: { creator: 'Dev111', priorTokens: [{ mint: 'A' }, { mint: 'B' }] } }),
  );
  assert.ok(!r.findings.some((f) => f.title.includes('干净')), '没有任何数据支持「干净」这个结论');
  assert.ok(r.findings.some((f) => f.title === '历史发币结局未核实'));
  assert.equal(r.metrics!.priorRugCount, undefined, '历史 rug 数无从得知，就不能出现在指标里');
});

test('持有人数未知时不得报「持有人少且集中」', () => {
  const holders = Array.from({ length: 12 }, (_, i) => ({ address: `H${i}`, amount: 0, pct: 6 }));
  const unknown = analyzeHolders(input({ holders }));
  assert.ok(!unknown.findings.some((f) => f.title === '持有人少且集中'));
  assert.equal(unknown.metrics!.holderCount, undefined);

  const known = analyzeHolders(input({ holders, liquidity: { holderCount: 30 } }));
  assert.ok(known.findings.some((f) => f.title === '持有人少且集中'), 'RugCheck 给了持有人数后该判断必须生效');
});

test('「LP 未锁定也未销毁」必须列出未锁占比与 LP 持有者，不得凭空指名项目方', () => {
  // 62.9% 这个真实数字只说明「有一部分没锁」，不说明是谁持有那部分。
  const quoted = analyzeContract(
    input({
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        lp: {
          exists: true,
          locked: false,
          burned: false,
          lockedPct: 62.9,
          unlockedPct: 37.1,
          withdrawablePct: 37.1,
          lpHolders: [
            { owner: 'LockerAccount111111111111111111111111111111', pct: 62.9, label: 'Streamflow' },
            { owner: 'CreatorWallet1111111111111111111111111111111', pct: 37.1, label: 'Creator' },
          ],
        },
      },
    }),
  );
  const f = quoted.findings.find((x) => x.title === 'LP 未锁定也未销毁')!;
  assert.ok(f.detail.includes('62.9%'), '要给出锁定比例这个原始数字');
  assert.ok(f.detail.includes('37.1%'), '要给出未锁占比这个直接依据');
  assert.ok(f.detail.includes('Creator'), '要点出 RugCheck 标注的身份，让人能核对');
  assert.ok(f.detail.includes('62.9%') && f.detail.includes('Streamflow'), '锁仓方也要列出');

  // 没有持有者明细时，只能说「持有人不明」，不能断言是项目方
  const noEvidence = analyzeContract(
    input({
      contract: { mintAuthority: null, freezeAuthority: null, lp: { exists: true, locked: false, lockedPct: 62.9 } },
    }),
  );
  const g = noEvidence.findings.find((x) => x.title === '流通中的 LP 持有人无法核实')!;
  assert.ok(!g.detail.includes('项目方随时'), '没有证据就不指名道姓');
  assert.ok(g.detail.includes('无法确认剩余流通部分在谁手里'));
});

test('未锁 LP 由锁仓程序托管 → 报「托管中」而不是「随时可撤池」', () => {
  const vesting = analyzeContract(
    input({
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        lp: {
          exists: true,
          locked: false,
          lockedPct: 68.34,
          unlockedPct: 31.66,
          lockerPct: 31.5,
          withdrawablePct: 0.16,
          lpHolders: [
            { owner: 'StreamflowVault66666666666666666666666666666', pct: 31.5, label: 'Streamflow Vault', isLocker: true, unlockAt: '2027-09-30' },
            { owner: 'RandomWallet777777777777777777777777777777', pct: 0.157 },
          ],
        },
      },
    }),
  );
  assert.ok(
    !vesting.findings.some((f) => f.title === 'LP 未锁定也未销毁'),
    '不能把锁仓合约持有的 LP 说成「未锁定也未销毁、可以撤走」',
  );
  const f = vesting.findings.find((x) => x.title === '流通中的 LP 主要在锁仓程序里')!;
  assert.ok(f, '要给出「托管中」的中间结论');
  assert.equal(f.severity, 'medium');
  assert.ok(f.detail.includes('68.3%') && f.detail.includes('31.5%') && f.detail.includes('0.16%'));
  assert.ok(f.detail.includes('Streamflow'), '点出锁仓程序，用户才能去核对');
  assert.ok(f.detail.includes('2027-09-30'), '解锁时间必须出现');

  // 可自由提走的部分够大时，仍然是 high 撤池风险
  const freeEnough = analyzeContract(
    input({
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        lp: { exists: true, locked: false, lockedPct: 50, unlockedPct: 50, lockerPct: 10, withdrawablePct: 40 },
      },
    }),
  );
  assert.ok(freeEnough.findings.some((f) => f.title === 'LP 未锁定也未销毁' && f.severity === 'high'));
});

test('用户给的 9raUVuze…pump：62.9% 是「已销毁」，流通部分分散在多地址', () => {
  // 真实数字：历史铸造 6,670,716,023,992，链上供应 2,477,306,894,096，销毁 62.86%。
  // 旧代码按 RugCheck 字段名读成「LP 未锁定也未销毁」，与事实相反。
  const r = analyzeContract(
    input({
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        lp: {
          exists: true,
          locked: false,
          lockedPct: 62.86295376409249,
          burnedPct: 62.86295376409249,
          lpMint: '3HWyWwRPBrAn5T2fFdiWizQqE3ktQ48BTJkuj7jdkZQ2',
          lpAudit: {
            everMinted: 6_670_716_023_992,
            live: 2_477_306_894_096,
            burned: 4_193_409_129_896,
          },
          circulatingHolderCount: 20,
          topCirculatingHolderPct: 33.29,
          unlockedPct: 37.13704623590751,
          withdrawablePct: 35.8,
        },
      },
    }),
  );
  assert.ok(
    !r.findings.some((f) => f.title === 'LP 未锁定也未销毁'),
    '不能把已销毁 62.9% 说成「未锁定也未销毁」',
  );
  const burned = r.findings.find((f) => f.title.startsWith('LP 已销毁'))!;
  assert.ok(burned, '要报出已销毁的部分');
  assert.equal(burned.severity, 'good');
  assert.ok(burned.detail.includes('62.9%'));
  assert.ok(burned.detail.includes('4,193,409,129,896'), '要给出可复算的原始数字');
  assert.ok(burned.detail.includes('3HWyWwRPBrAn5T2fFdiWizQqE3ktQ48BTJkuj7jdkZQ2'), '要给出 LP mint');
  const spread = r.findings.find((f) => f.title === '流通中的 LP 分散在多个地址')!;
  assert.ok(spread, '流通部分要单独说明，而不是当成撤池风险');
  assert.equal(spread.severity, 'low');
  assert.ok(spread.detail.includes('20'));
  assert.ok(spread.detail.includes('33.3%'));
});

test('部分销毁 + 项目方持有流通 LP → 才是真正的撤池风险（high）', () => {
  const r = analyzeContract(
    input({
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        lp: {
          exists: true,
          locked: false,
          lockedPct: 50,
          burnedPct: 50,
          lpAudit: { everMinted: 1000, live: 500, burned: 500 },
          creatorLpPct: 60,
          circulatingHolderCount: 1,
          topCirculatingHolderPct: 60,
          lpHolders: [
            { owner: 'CreatorWallet1111111111111111111111111111111', pct: 30, label: 'Creator' },
          ],
        },
      },
    }),
  );
  const f = r.findings.find((x) => x.title === '项目方持有流通中的 LP')!;
  assert.ok(f, 'creator 持有流通 LP 必须报 high');
  assert.equal(f.severity, 'high');
  assert.ok(f.detail.includes('60.0%'));
  assert.ok(!r.findings.some((x) => x.title === '流通中的 LP 分散在多个地址'));
});

test('整体已销毁（100%）→ 直接报「LP 已销毁」，并附链上核对数字', () => {
  const r = analyzeContract(
    input({
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        lp: {
          exists: true,
          locked: false,
          burned: true,
          burnedPct: 100,
          lockedPct: 100,
          lpMint: '8HXSYFQhP2oJPZYLv8EC4YLu6nGn8EKAFETwWG4m2eVD',
          lpAudit: { everMinted: 4_193_388_354_147, live: 0, burned: 4_193_388_354_147 },
        },
      },
    }),
  );
  const f = r.findings.find((x) => x.title === 'LP 已销毁')!;
  assert.ok(f);
  assert.equal(f.severity, 'good');
  assert.ok(f.detail.includes('4,193,388,354,147'));
  assert.ok(!r.findings.some((x) => x.title === 'LP 已锁定/不可撤'));
});

test('有销毁比例但没有持有者明细 → 只报「持有人无法核实」，不编风险也不当安全', () => {
  const r = analyzeContract(
    input({
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        lp: { exists: true, locked: false, lockedPct: 62.9, lpMint: 'LPMintUnknown1111111111111111111111111111' },
      },
    }),
  );
  assert.ok(!r.findings.some((f) => f.title === 'LP 未锁定也未销毁'), '没有持有者证据就不下风险结论');
  assert.ok(!r.findings.some((f) => f.title.includes('已锁定')), '也不能当成安全');
  const f = r.findings.find((x) => x.title === '流通中的 LP 持有人无法核实')!;
  assert.ok(f);
  assert.equal(f.severity, 'medium');
  assert.ok(f.detail.includes('62.9%') && f.detail.includes('LPMintUnknown'));
});

test('「笔数与金额背离」必须给出单笔量级证据，不能只给两个比例', () => {
  // 真实数据：9raUVuze…pump 的最近 100 笔 → 买 64 笔 1.847 SOL、卖 14 笔 2.285 SOL，
  // 最大一笔卖单 2.028 SOL（占卖出 88.8%），样本跨 65 小时。
  const r = analyzeLiquidity(
    input({
      liquidity: {
        buyCount: 64,
        sellCount: 14,
        buyVolumeSol: 1.847,
        sellVolumeSol: 2.285,
        tradeSizeAudit: {
          trades: 78,
          windowSec: 3925 * 60,
          buyMedianSol: 0.0025,
          sellMedianSol: 0.0113,
          buyMaxSol: 0.275,
          sellMaxSol: 2.028,
          largestSellSharePct: 88.8,
          top5SellSharePct: 97.5,
        },
      },
    }),
  );
  const f = r.findings.find((x) => x.title === '笔数与金额背离')!;
  assert.ok(f, '笔数/金额背离仍要判出来');
  // 读者要能自己核对：样本量、时间窗、单笔中位/平均、卖单集中度
  assert.ok(f.detail.includes('78 笔'), '要给样本笔数');
  assert.ok(f.detail.includes('65.4 小时'), '要说明样本跨多久，否则 100 笔可能只是一瞬间');
  assert.ok(f.detail.includes('0.0025'), '要给买单中位数（小额买盘的直接证据）');
  assert.ok(f.detail.includes('0.0113'), '要给卖单中位数');
  assert.ok(f.detail.includes('2.028'), '要给最大单笔卖单');
  assert.ok(f.detail.includes('88.8%'), '要给出最大卖单占卖出总额的比例');
  assert.ok(f.detail.includes('97.5%'), '要给出前 5 大卖单占比');
  // 指标面板同样要有这几个数
  assert.equal((r.metrics ?? {}).buyTrades, 64);
  assert.equal((r.metrics ?? {}).sellTrades, 14);
  assert.ok(Math.abs(Number((r.metrics ?? {}).avgBuySol) - 0.0289) < 0.001);
  assert.ok(Math.abs(Number((r.metrics ?? {}).avgSellSol) - 0.1632) < 0.001);
  assert.equal((r.metrics ?? {}).sellMaxSol, 2.028);
  assert.equal((r.metrics ?? {}).sampleWindowMin, 3925);
});

test('大额卖单必须给出签名/时间/钱包，且明细进 metrics 供 UI 链到 Solscan', () => {
  const r = analyzeLiquidity(
    input({
      liquidity: {
        buyCount: 64,
        sellCount: 14,
        buyVolumeSol: 1.847,
        sellVolumeSol: 2.285,
        tradeSizeAudit: {
          trades: 78,
          windowSec: 3925 * 60,
          buyMedianSol: 0.0025,
          sellMedianSol: 0.0113,
          buyMaxSol: 0.275,
          sellMaxSol: 2.028,
          largestSellSharePct: 88.8,
          top5SellSharePct: 97.5,
        },
        largeSells: [
          {
            signature: '5xK2mVbQwErTyUiOpAsDfGhJkLzXcVbNmQwErTyUiOpAsDfGhJkLzXcVbNmQwErTyUiOpAsDf',
            sol: 2.028,
            ts: 1_756_600_000, // 2025-08-30 前后
            trader: 'A6QVMEvCH8xQ4o7nx2tkob42MsYGuPcKE4hwx5Zvj9kj',
          },
          {
            signature: '2bQwErTyUiOpAsDfGhJkLzXcVbNmQwErTyUiOpAsDfGhJkLzXcVbNmQwErTyUiOpAsDfGhJkL',
            sol: 0.108,
            ts: 1_756_600_000,
          },
        ],
      },
    }),
  );
  const f = r.findings.find((x) => x.title === '笔数与金额背离')!;
  assert.ok(f.detail.includes('2.028 SOL @'), '每笔要带金额与时间');
  assert.ok(f.detail.includes('UTC'), '时间要标明时区，否则没法和 Solscan 对齐');
  assert.ok(f.detail.includes('A6QV…j9kj'), '要给出卖出钱包');
  assert.ok(/签名 [A-Za-z0-9]{6}…[A-Za-z0-9]{6}/.test(f.detail), `要给出可核对的签名片段：${f.detail}`);
  const list = (r.metrics ?? {}).largeSells as { signature: string; sol: number }[];
  assert.equal(list.length, 2);
  assert.equal(list[0].signature.startsWith('5xK2mVb'), true, '完整签名必须进 metrics，UI 才能拼 Solscan 链接');
});

test('不是 SOL 口径（USD 推算）时不得给出大额卖单明细', () => {
  const r = analyzeLiquidity(
    input({
      liquidity: {
        buyCount: 64,
        sellCount: 14,
        buyVolumeUsd: 1847,
        sellVolumeUsd: 2285,
        largeSells: [{ signature: 'sig', sol: 2.028, ts: 1_756_600_000 }],
      },
    }),
  );
  assert.equal((r.metrics ?? {}).largeSells, undefined, 'USD 口径的单笔 SOL 金额是推算值，不能当链上凭据');
});

test('大额卖单要标明「是不是开盘那批人」，并给出当前持仓', () => {
  const r = analyzeLiquidity(
    input({
      holders: [
        { address: 'SniperWallet111111111111111111111111111111', amount: 1, pct: 0.42 },
        { address: 'OtherWallet1111111111111111111111111111111', amount: 1, pct: 3.1 },
      ],
      liquidity: {
        buyCount: 64,
        sellCount: 14,
        buyVolumeSol: 1.847,
        sellVolumeSol: 2.285,
        tradeSizeAudit: {
          trades: 78,
          buyMedianSol: 0.0025,
          sellMedianSol: 0.0113,
          buyMaxSol: 0.275,
          sellMaxSol: 2.028,
        },
        largeSells: [
          {
            signature: 'sig-sniper',
            sol: 2.028,
            ts: 1_756_600_000,
            trader: 'SniperWallet111111111111111111111111111111',
            earlyBuyerIndex: 2,
            sniperNow: true,
          },
          {
            signature: 'sig-late',
            sol: 0.108,
            ts: 1_756_600_000,
            trader: 'LateWallet11111111111111111111111111111111',
          },
        ],
      },
    }),
  );
  const f = r.findings.find((x) => x.title === '笔数与金额背离')!;
  assert.ok(f.detail.includes('开盘最早 25 笔内的买家（第 3 笔）'), `要标出开盘身份：${f.detail}`);
  assert.ok(f.detail.includes('1 笔来自开盘最早 25 笔成交内的地址'), '要给出数量，别让读者自己数');
  assert.ok(f.detail.includes('仍在前 20 大持仓'), '砸盘后是否还持仓也是关键信息');
  assert.ok(f.detail.includes('不等于确定不是早期买家'), '窗口外的地址不能被断言「不是早期买家」');

  const list = (r.metrics ?? {}).largeSells as { holderPctNow?: number; sniperNow?: boolean }[];
  assert.equal(list[0].holderPctNow, 0.42, '当前持仓要透给 UI');
  assert.equal(list[0].sniperNow, true);
  assert.equal(list[1].holderPctNow, undefined, '已不在前 20 大持仓 → 不写 0，写未知');
});

test('卖单钱包是部署者时单独标明', () => {
  const r = analyzeLiquidity(
    input({
      liquidity: {
        buyCount: 30, // 笔数 6 倍于卖单，金额却更小 → 触发背离
        sellCount: 5,
        buyVolumeSol: 1,
        sellVolumeSol: 3,
        largeSells: [
          { signature: 'sig-dev', sol: 2.5, ts: 1_756_600_000, trader: 'DevWallet11', isCreator: true },
        ],
      },
    }),
  );
  const f = r.findings.find((x) => x.title === '笔数与金额背离')!;
  assert.ok(f.detail.includes('1 笔来自部署者'), `部署者砸盘要单独说：${f.detail}`);
});

test('没取到最早成交时不得说「不在最早 25 笔内」（那是把未知说成清白）', () => {
  const sells = [
    { signature: 'sig-a', sol: 2.028, ts: 1_756_600_000, trader: 'Dumper111111111111111111111111111111111111' },
  ];
  // earlyBuyerWindowKnown = false：最早成交这次没拿到
  const unknown = analyzeLiquidity(
    input({
      liquidity: {
        buyCount: 30,
        sellCount: 5,
        buyVolumeSol: 1,
        sellVolumeSol: 3,
        earlyBuyerWindowKnown: false,
        largeSells: sells,
      },
    }),
  );
  const f = unknown.findings.find((x) => x.title === '笔数与金额背离')!;
  assert.ok(f.detail.includes('无法判断这些地址是不是开盘就买入的'), `要给未知口径：${f.detail}`);
  assert.ok(!f.detail.includes('没有一笔来自开盘最早 25 笔'), '不能把未知说成「不是狙击手」');
  assert.equal((unknown.metrics ?? {}).earlyBuyerWindowKnown, 0);

  // 窗口可用且确实不在里面 → 才可以说
  const known = analyzeLiquidity(
    input({
      liquidity: {
        buyCount: 30,
        sellCount: 5,
        buyVolumeSol: 1,
        sellVolumeSol: 3,
        earlyBuyerWindowKnown: true,
        largeSells: sells,
      },
    }),
  );
  const g = known.findings.find((x) => x.title === '笔数与金额背离')!;
  assert.ok(g.detail.includes('没有一笔来自开盘最早 25 笔成交内的地址'));
  assert.equal((known.metrics ?? {}).earlyBuyerWindowKnown, 1);
});

// ── 部署者身份的来源与「关联钱包持有 LP」 ──────────────────────────
test('只能从创建交易付款方推断 creator → 必须标为推断值，不能当作确定身份', () => {
  const r = analyzeDeveloper(
    input({
      developer: { creator: 'FeePayer111111111111111111111111111111111', creatorSource: 'create-tx' },
    }),
  );
  const f = r.findings.find((x) => x.title === '部署者身份为推断值')!;
  assert.ok(f, '用付款方推断身份必须出结论，否则读者会以为追对了人');
  assert.equal(f.severity, 'medium');
  assert.ok(f.detail.includes('不是真正的 dev'), '要说清付款方为什么可能是别人');
});

test('程序状态给的 creator 与创建钱包不一致 → 披露，且按 creator 算 dev 结论', () => {
  const r = analyzeDeveloper(
    input({
      developer: {
        creator: 'CurveCreator1111111111111111111111111111111',
        creatorSource: 'curve',
        launchWallet: 'LaunchWallet111111111111111111111111111111',
      },
    }),
  );
  const f = r.findings.find((x) => x.title === '创建钱包与 creator 不是同一个地址')!;
  assert.ok(f, '两个地址不同必须披露');
  assert.ok(f.detail.includes('CurveCreator'), '要说清结论归给谁');
  assert.ok(f.detail.includes('LaunchWallet'), '也要说清另一个地址是谁');
  assert.equal((r.metrics ?? {}).creatorSource, 'curve');
  assert.equal((r.metrics ?? {}).launchWallet, 'LaunchWallet111111111111111111111111111111');
});

test('部署者身份三级都拿不到 → 明确未知，不编地址', () => {
  const r = analyzeDeveloper(input({ developer: { priorTokens: [] } }));
  const f = r.findings.find((x) => x.title === '部署者身份未知')!;
  assert.ok(f);
  assert.ok(!(r.metrics ?? {}).creator, '未知时 metrics 不能有 creator');
});

test('关联钱包（创建付款方）持有流通 LP → 单独报警，不能只按 creator 算', () => {
  // 实测 9raUVuze…pump：creator（曲线状态）持 0%，但创建钱包持有流通 LP 的 29.1%
  const r = analyzeContract(
    input({
      developer: { creator: 'CurveCreator1111111111111111111111111111111', creatorSource: 'curve', launchWallet: 'LaunchWallet111111111111111111111111111111' },
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        lp: {
          exists: true,
          burned: false,
          burnedPct: 62.9,
          creatorLpPct: 0,
          circulatingHolderCount: 20,
          topCirculatingHolderPct: 33.3,
          lpAllHolders: [
            { owner: 'LaunchWallet111111111111111111111111111111', pct: 10.8 },
            { owner: 'OtherHolder111111111111111111111111111111111', pct: 8.9 },
          ],
        },
      },
    }),
  );
  const f = r.findings.find((x) => x.title === '与部署者关联的钱包持有流通中的 LP')!;
  assert.ok(f, 'creator 持 0 不等于没人能撤池：创建钱包持有 29.1% 流通 LP 必须报出来');
  assert.equal(f.severity, 'medium');
  assert.ok(f.detail.includes('10.8%'), `要给出占全池的比例（门槛依据）：${f.detail}`);
  assert.ok(f.detail.includes('29.1%'), '也要给出占流通部分的比例，方便和销毁比例对照');
  const spread = r.findings.find((x) => x.title === '流通中的 LP 分散在多个地址');
  assert.ok(spread && spread.detail.includes('不能一并算作'), '分散那条不能再把关联地址算成第三方流动性');
});

test('没有关联钱包时不得凭空出现「关联钱包持有 LP」', () => {
  const r = analyzeContract(
    input({
      developer: { creator: 'CurveCreator1111111111111111111111111111111', creatorSource: 'curve' },
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        lp: { exists: true, burned: true, burnedPct: 62.9, circulatingHolderCount: 20, lpAllHolders: [{ owner: 'SomeoneElse11111111111111111111111111111111', pct: 10 }] },
      },
    }),
  );
  assert.equal(r.findings.find((x) => x.title === '与部署者关联的钱包持有流通中的 LP'), undefined);
});

test('门槛卡在全池占比上：销毁 96% 的池子里拿住剩下那点 LP 不算警报', () => {
  const r = analyzeContract(
    input({
      developer: { creator: 'CurveCreator1111111111111111111111111111111', creatorSource: 'curve', launchWallet: 'LaunchWallet111111111111111111111111111111' },
      contract: {
        mintAuthority: null,
        freezeAuthority: null,
        lp: {
          exists: true,
          burnedPct: 96,
          circulatingHolderCount: 20,
          lpAllHolders: [{ owner: 'LaunchWallet111111111111111111111111111111', pct: 3 }],
        },
      },
    }),
  );
  assert.equal(
    r.findings.find((x) => x.title === '与部署者关联的钱包持有流通中的 LP'),
    undefined,
    '只占全池 3% 时不能报成「关联钱包持有 LP」，那是把小数字放大成警报',
  );
});

// ── 前 20 大持仓明细：集中度这个数字必须能被读者自己加出来 ────────
test('Top20 明细：分类、是否计入、以及 Top10 能不能被加出来', () => {
  const r = analyzeHolders(
    input({
      token: { mint: 'M', symbol: 'T', supply: 1000 },
      developer: { creator: 'devaddr' },
      holders: [
        { address: 'pool', amount: 300, pct: 30, isPool: true },
        { address: 'burn', amount: 100, pct: 10, isBurn: true },
        { address: 'devaddr', amount: 80, pct: 8 },
        { address: 'sniper1', amount: 60, pct: 6, isSniper: true },
        ...Array.from({ length: 8 }, (_, i) => ({ address: `r${i}`, amount: 40 - i, pct: 4 - i * 0.1 })),
        { address: 'r8', amount: 20, pct: 2 },
        { address: 'r9', amount: 10, pct: 1 },
      ],
    }),
  );
  const rows = r.metrics!.topHolders as HolderRow[];
  assert.equal(rows.length, 14, '链上给了几只就列几只');
  assert.equal(rows[0].kind, 'pool');
  assert.equal(rows[0].counted, false, '池子不计入集中度');
  assert.equal(rows[1].kind, 'burn');
  assert.equal(rows.find((x) => x.address === 'devaddr')!.kind, 'dev', 'creator 本人要标出来');
  assert.equal(rows.find((x) => x.address === 'sniper1')!.kind, 'sniper');
  assert.deepEqual(
    rows.map((x) => x.pct),
    [...rows.map((x) => x.pct)].sort((a, b) => b - a),
    '明细必须按持仓从大到小，否则「前 10 行」没有意义',
  );

  // 关键：读者把「计入」的前 10 行加起来（占总供应量），再除以流通盘，
  // 必须正好等于界面上的 Top10 集中度 —— 这个除法读者可以自己按计算器核对
  const counted10 = rows.filter((x) => x.counted).slice(0, 10);
  const sum = counted10.reduce((s, x) => s + x.pct, 0);
  assert.equal(counted10.length, 10);
  const derived = (sum / Number(r.metrics!.circulatingPct)) * 100;
  assert.ok(
    Math.abs(derived - Number(r.metrics!.top10Pct)) < 1e-9,
    `计入前 10 行合计 ${sum} ÷ 流通盘 ${r.metrics!.circulatingPct}% = ${derived} 应等于 top10Pct ${r.metrics!.top10Pct}`,
  );
});

test('前 20 行里被剔除的太多时，要往后补行，保证「计入」的行够 10 行', () => {
  const r = analyzeHolders(
    input({
      token: { mint: 'M', symbol: 'T', supply: 1000 },
      holders: [
        ...Array.from({ length: 15 }, (_, i) => ({ address: `pool${i}`, amount: 50, pct: 5, isPool: true })),
        ...Array.from({ length: 12 }, (_, i) => ({ address: `r${i}`, amount: 10, pct: 1 })),
      ],
    }),
  );
  const rows = r.metrics!.topHolders as HolderRow[];
  const counted10 = rows.filter((x) => x.counted).slice(0, 10);
  assert.equal(counted10.length, 10, '补行之后必须够 10 行，否则界面上那个等式不成立');
  assert.ok(rows.length > 20, '补出来的行数可以超过 20');
  const sum = counted10.reduce((s, x) => s + x.pct, 0);
  const derived = (sum / Number(r.metrics!.circulatingPct)) * 100;
  assert.ok(
    Math.abs(derived - Number(r.metrics!.top10Pct)) < 1e-9,
    '补行之后这个除法依然要成立',
  );
});

test('创建交易的付款方要标成「与部署者关联」，不能显示成散户', () => {
  // 实测 9raUVuze…pump：付款方 4JBz4tAK… 持有 0.37% 代币 + 10.8% 全池 LP，
  // 它出钱发币、还给 creator 的首笔交易充值 —— 显示成散户会低估这条筹码
  const r = analyzeHolders(
    input({
      token: { mint: 'M', symbol: 'T', supply: 1000 },
      developer: {
        creator: 'curvecreator',
        creatorSource: 'curve',
        launchWallet: 'feepayer',
        linkedWallets: ['feepayer', 'someoneelse'],
      },
      holders: [
        { address: 'curvecreator', amount: 50, pct: 5 },
        { address: 'feepayer', amount: 30, pct: 3 },
        { address: 'someoneelse', amount: 20, pct: 2 },
        { address: 'retail1', amount: 10, pct: 1 },
      ],
    }),
  );
  const rows = r.metrics!.topHolders as HolderRow[];
  const byAddr = new Map(rows.map((x) => [x.address, x]));
  assert.equal(byAddr.get('curvecreator')!.kind, 'dev');
  assert.equal(byAddr.get('feepayer')!.kind, 'related');
  assert.equal(byAddr.get('someoneelse')!.kind, 'related', '给 creator 出资的钱包也算关联');
  assert.equal(byAddr.get('feepayer')!.counted, true, '关联钱包能随时卖出，必须计入集中度');
  assert.equal(Number(r.metrics!.devClusterPct), 10, 'dev 与关联钱包要合起来看');
});
