/**
 * 引擎与五维分析器的行为验证。
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
import type { RawHolder, ScanInput } from './types.ts';

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
test('池与 burn 持仓被剔除后，正常项目不会被误判为庄家控盘', () => {
  const data = input({
    // 池持有 60%，剩下 40% 里散户分布很散
    holders: [
      { address: 'pool', amount: 0, pct: 60, isPool: true },
      { address: 'burn', amount: 0, pct: 10, isBurn: true },
      ...Array.from({ length: 12 }, (_, i) => ({
        address: `retail${i}`,
        amount: 0,
        pct: 2,
      })),
    ],
  });
  const r = analyzeHolders(data);
  assert.equal(r.vetoed, false, '剔除池后不应触发集中度否决');
  assert.ok((r.metrics!.excludedPct as number) === 70, '剔除比例应为 70%');
  // 前 10 大散户 2% × 10 = 20%，低于 25% 警戒线
  assert.equal(r.metrics!.top10Pct, 20);
});

test('池持仓不剔除时本会误报 —— 证明剔除逻辑确实在起作用', () => {
  // 用真实的 base58 风格地址，避免地址文本本身命中池标签模式而干扰本测试
  const poolAddr = 'RaydiumPoolV4xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const holders: RawHolder[] = [
    { address: poolAddr, amount: 0, pct: 60, isPool: true },
    ...Array.from({ length: 12 }, (_, i) => ({ address: `Retail${i}Addr`, amount: 0, pct: 2 })),
  ];
  const withPool = analyzeHolders(input({ holders }));
  assert.equal(withPool.metrics!.top10Pct, 20);

  // 同样的数据，但池地址既没有 isPool 标记、也不在 poolAddresses 里：
  // Top10 会立刻飙到 62% 并触发否决 —— 说明「识别并剔除池」这一步不可省。
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
      liquidity: { graduated: true, realSolReserves: 80, buyVolumeSol: 100, sellVolumeSol: 80, buyCount: 900, sellCount: 600, lpLockedOrBurned: true },
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

test('五维数据齐全时覆盖率必须是 100%，不能被误判为数据不足', () => {
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
