/**
 * 深度分析任务的调度与状态。
 *
 * 放在 provider 层而不是 route 里：route 只负责 HTTP 语义，
 * 任务的生命周期（进度、队列、缓存、去重）不该和 HTTP 混在一起。
 *
 * ── 为什么要排队 ────────────────────────────────────────────────────
 * 实测一个深度任务 = 50 个地址 × 3 并发 = 约 2 分钟、133 次分页请求。
 * 如果多个任务同时跑（不同 mint、或多个人同时用），每个任务内部 3 并发，
 * 叠加起来就会撞上 Helius 的限流 —— 而限流的表现是**静默的失败**：
 * 实测并发 8 时 50 个请求里 45 个被 429 拒掉，那些地址的成本就退回窗口估算，
 * 用户看到一个「看起来完成了、其实缺了一半」的结果。
 *
 * 所以同一时间**只跑一个**深度任务，其余排队（含位置与预计等待时间）。
 * 这是用「等待」换「结果完整」，对 2 分钟量级的任务来说这个交换划算。
 *
 * ⚠️ 队列只服务于**用户主动发起**的深度分析，没有任何自动预热 ——
 * 用户的等待必须是他自己按下去的，不能被系统偷偷占用配额。
 */
import { randomUUID } from 'node:crypto';

import { THRESHOLDS } from '../core/constants';
import { fetchDeepHolderHistory, pickDeepTargets } from './deepHolders';
import { getHolderEnumerationCached } from './holderList';
import type { DeepHolderResult } from './deepHolders';

export type DeepState = 'queued' | 'running' | 'done' | 'error';

export interface DeepJob {
  id: string;
  mint: string;
  state: DeepState;
  progress: { done: number; total: number; pct: number };
  /** 入队时间（用于算等待了多久） */
  enqueuedAt: number;
  /** 真正开始跑的时间；排队时不存在 */
  startedAt?: number;
  /** 队列中的位置（1 = 下一个就跑）；只有 queued 时有值 */
  queuePosition?: number;
  /** 预计等待秒数（基于实测的单任务耗时） */
  etaSec?: number;
  result?: DeepHolderResult;
  warnings: string[];
  error?: string;
}

const jobs = new Map<string, DeepJob>();
/** 同一 mint 只跑一个任务：连点两次不该打两次 50 个地址 */
const byMint = new Map<string, string>();
/** 完成结果的缓存（TTL 内复用，2 分钟的活不重复干） */
const cache = new Map<string, { at: number; job: DeepJob }>();
/** 等待执行的任务 id（FIFO） */
const queue: string[] = [];
let running: string | undefined;

/** 实测单任务耗时，用于给排队中的任务估算等待时间 */
const TYPICAL_JOB_MS = 120_000;

function apiKey(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error('缺少 HELIUS_API_KEY：深度分析需要逐地址拉历史，无法在无 key 时进行。');
  return key;
}

/** 刷新排队中任务的位置与预计等待时间（每次队列变动都要重算） */
function refreshQueuePositions(): void {
  for (let i = 0; i < queue.length; i++) {
    const j = jobs.get(queue[i]);
    if (!j || j.state !== 'queued') continue;
    j.queuePosition = i + 1;
    // 前面还有一个正在跑的 → 至少要多等一整个任务
    j.etaSec = Math.round((TYPICAL_JOB_MS * (i + (running ? 1 : 0))) / 1000);
  }
}

export function getDeepJob(id: string): DeepJob | undefined {
  return jobs.get(id);
}

/** 取出队列里下一个任务并开跑 */
function pump(): void {
  if (running) return;
  const nextId = queue.shift();
  if (!nextId) {
    refreshQueuePositions();
    return;
  }
  const job = jobs.get(nextId);
  if (!job || job.state !== 'queued') {
    pump();
    return;
  }
  running = nextId;
  job.state = 'running';
  job.startedAt = Date.now();
  delete job.queuePosition;
  delete job.etaSec;
  refreshQueuePositions();

  // 排队期间枚举缓存可能已过期，这里（真正开跑前）再取一次
  const enumeration = getHolderEnumerationCached(job.mint);
  const targets = enumeration ? pickDeepTargets(enumeration) : [];
  if (targets.length === 0) {
    job.state = 'error';
    job.error =
      '排队期间该代币的持有人枚举缓存已过期（或没有持有余额的地址），请重新扫描后再发起深度分析。';
    byMint.delete(job.mint);
    running = undefined;
    pump();
    return;
  }

  let key: string;
  try {
    key = apiKey();
  } catch (e) {
    job.state = 'error';
    job.error = e instanceof Error ? e.message : String(e);
    byMint.delete(job.mint);
    running = undefined;
    pump();
    return;
  }

  // 不 await：发起方立刻拿到 id 去轮询
  void fetchDeepHolderHistory(job.mint, targets, key, {
    onProgress: (p) => {
      job.progress = p;
    },
  })
    .then((result) => {
      job.result = result;
      job.warnings = result.warnings;
      job.state = 'done';
      job.progress = { done: result.succeeded + result.failed, total: targets.length, pct: 100 };
      cache.set(job.mint, { at: Date.now(), job });
    })
    .catch((e: unknown) => {
      job.state = 'error';
      job.error = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      byMint.delete(job.mint);
      running = undefined;
      pump(); // 让下一个排队任务开始
    });
}

/**
 * 发起（或复用）一个深度分析任务。
 *
 * 三种情况都**立刻返回**，不做网络等待：
 * - 同 mint 已有任务在排队或执行 → 复用那个任务（连点两次不会打两次地址）
 * - 缓存命中 → 直接返回已完成的任务
 * - 否则入队，由 pump() 在有空位时执行
 */
export async function startDeepJob(mint: string): Promise<DeepJob> {
  // 1) 已有同 mint 的任务（排队中或执行中）→ 复用
  const existingId = byMint.get(mint);
  if (existingId) {
    const existing = jobs.get(existingId);
    if (existing && (existing.state === 'queued' || existing.state === 'running')) return existing;
  }
  // 2) 缓存命中 → 直接返回完成的任务
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < THRESHOLDS.sellPressure.deepCacheTtlMs) {
    return hit.job;
  }

  // 3) 入队前校验：没有枚举缓存就没法干活，也不该占队列位置
  const enumeration = getHolderEnumerationCached(mint);
  if (!enumeration) {
    throw new Error(
      'NEED_SCAN: 需要先对这个代币做一次普通扫描（深度模式复用扫描时枚举的持有人列表，避免重复拉取上万个账户）。',
    );
  }
  if (pickDeepTargets(enumeration).length === 0) {
    throw new Error('枚举结果里没有持有余额的地址，无法进行深度分析。');
  }

  const job: DeepJob = {
    id: randomUUID(),
    mint,
    state: 'queued',
    progress: { done: 0, total: THRESHOLDS.sellPressure.deepTopWallets, pct: 0 },
    enqueuedAt: Date.now(),
    warnings: [],
  };
  jobs.set(job.id, job);
  byMint.set(mint, job.id);
  queue.push(job.id);
  refreshQueuePositions();
  pump();
  return job;
}

/**
 * 取已完成的深度结果（供扫描时自动并入）。
 *
 * 只认**完成**的任务：排队中、正在跑或失败的都不能当成成本依据 ——
 * 半个结果比没有结果更危险（会让人以为已经用了完整历史）。
 */
export function getDeepResultCached(mint: string): DeepHolderResult | undefined {
  const hit = cache.get(mint);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= THRESHOLDS.sellPressure.deepCacheTtlMs) return undefined;
  return hit.job.state === 'done' ? hit.job.result : undefined;
}

/** 队列现状（供调试与测试） */
export function deepQueueSnapshot(): { running?: string; queued: string[] } {
  return { ...(running ? { running } : {}), queued: [...queue] };
}

/** 测试用：清空任务表 */
export function __resetDeepJobs(): void {
  jobs.clear();
  byMint.clear();
  cache.clear();
  queue.length = 0;
  running = undefined;
}
