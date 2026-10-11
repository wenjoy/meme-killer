/**
 * 深度任务队列测试。
 *
 * 锁的是「同一时间只跑一个任务」这条保证 —— 它存在的理由是**限流会静默丢数据**：
 * 实测并发 8 时 50 个请求里 45 个被 429 拒掉，那些地址会悄悄退回窗口估算，
 * 用户看到一个「看起来完成了、其实缺了一半」的结果。
 * 所以并发跑不是「快一点」，是「结果错」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 队列状态在模块级，测试之间要隔离
process.env.HELIUS_API_KEY = 'test-key';

const { startDeepJob, getDeepJob, deepQueueSnapshot, __resetDeepJobs } = await import('./deepJobs.ts');
const { cacheHolderEnumerationForTest } = await import('./holderList.ts');

/** 造一份「有余额的持有人」枚举，让入队校验通过 */
function seed(mint: string, n = 60): void {
  const accounts = Array.from({ length: n }, (_, i) => ({
    account: `ta${i}`,
    owner: `owner${i}`,
    amount: BigInt(1000 - i),
  }));
  cacheHolderEnumerationForTest(mint, {
    accounts,
    source: 'rpc' as const,
    truncated: false,
    warnings: [],
  });
}

test('没有枚举缓存时拒绝入队，并说明要先扫描', async () => {
  __resetDeepJobs();
  await assert.rejects(() => startDeepJob('unknown-mint'), /NEED_SCAN/);
});

test('【核心保证】多个 mint 同时发起时，只有一个真正在跑，其余排队', async () => {
  __resetDeepJobs();
  for (const m of ['m1', 'm2', 'm3']) seed(m);

  const jobs = await Promise.all(['m1', 'm2', 'm3'].map((m) => startDeepJob(m)));
  const snap = deepQueueSnapshot();

  const runningCount = jobs.filter((j) => j.state === 'running').length;
  const queuedCount = jobs.filter((j) => j.state === 'queued').length;
  assert.equal(runningCount, 1, `同一时间只能有一个任务在跑，实际 ${runningCount} 个`);
  assert.equal(queuedCount, 2);
  assert.ok(snap.running, '快照里应有一个 running');
  assert.equal(snap.queued.length, 2);

  // 排队中的任务要能看到自己的位置和预计等待时间，而不是干等一个 0% 进度条
  const queued = jobs.filter((j) => j.state === 'queued');
  assert.deepEqual(
    queued.map((j) => j.queuePosition).sort(),
    [1, 2],
    '排队位置要从 1 开始连续',
  );
  for (const j of queued) {
    assert.ok((j.etaSec ?? 0) > 0, '排队任务必须有预计等待时间，否则用户不知道要不要等');
  }
});

test('同一个 mint 重复发起只复用同一任务，不会打两次地址', async () => {
  __resetDeepJobs();
  seed('dup');
  const a = await startDeepJob('dup');
  const b = await startDeepJob('dup');
  assert.equal(a.id, b.id, '连点两次必须复用同一个任务');
  assert.equal(deepQueueSnapshot().queued.length + (deepQueueSnapshot().running ? 1 : 0), 1);
});

test('排队中的任务带上预估时间，位置随队列移动', async () => {
  __resetDeepJobs();
  for (const m of ['q1', 'q2', 'q3']) seed(m);
  const [j1, j2, j3] = await Promise.all([startDeepJob('q1'), startDeepJob('q2'), startDeepJob('q3')]);
  const states = [j1, j2, j3].map((j) => j.state);
  assert.equal(states.filter((s) => s === 'running').length, 1);
  // FIFO：先入队的先跑
  assert.equal(j1.state, 'running', '先入队的应先执行（FIFO）');
  assert.equal(j2.queuePosition, 1);
  assert.equal(j3.queuePosition, 2);
  assert.ok((j2.etaSec ?? 0) <= (j3.etaSec ?? Number.MAX_SAFE_INTEGER), '越靠后等待越久');
});

test('取结果时只认「完成」的任务（排队中/失败都不算成本依据）', async () => {
  const { getDeepResultCached } = await import('./deepJobs.ts');
  __resetDeepJobs();
  seed('pending');
  await startDeepJob('pending');
  assert.equal(
    getDeepResultCached('pending'),
    undefined,
    '正在跑的半个结果不能当成成本依据 —— 会让人以为已经用了完整历史',
  );
});

test('未知 id 返回 undefined（进程重启后不该假装任务还在）', () => {
  assert.equal(getDeepJob('nonexistent-id'), undefined);
});
