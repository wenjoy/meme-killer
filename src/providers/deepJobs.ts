/**
 * 深度分析任务的调度与状态。
 *
 * 放在 provider 层而不是 route 里：route 只负责 HTTP 语义，
 * 任务的生命周期（进度、缓存、并发去重）不该和 HTTP 混在一起。
 */
import { randomUUID } from 'node:crypto';

import { THRESHOLDS } from '../core/constants';
import { fetchDeepHolderHistory, pickDeepTargets } from './deepHolders';
import { getHolderEnumerationCached } from './holderList';
import type { DeepHolderResult } from './deepHolders';

export type DeepState = 'running' | 'done' | 'error';

export interface DeepJob {
  id: string;
  mint: string;
  state: DeepState;
  progress: { done: number; total: number; pct: number };
  startedAt: number;
  result?: DeepHolderResult;
  warnings: string[];
  error?: string;
}

const jobs = new Map<string, DeepJob>();
/** 同一 mint 只跑一个任务：连点两次不该打两次 50 个地址 */
const byMint = new Map<string, string>();
/** 完成结果的缓存（TTL 内复用，38 秒的活不重复干） */
const cache = new Map<string, { at: number; job: DeepJob }>();

function apiKey(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error('缺少 HELIUS_API_KEY：深度分析需要逐地址拉历史，无法在无 key 时进行。');
  return key;
}

export function getDeepJob(id: string): DeepJob | undefined {
  return jobs.get(id);
}

export async function startDeepJob(mint: string): Promise<DeepJob> {
  // 1) 已有同 mint 的任务在跑 → 直接复用
  const runningId = byMint.get(mint);
  if (runningId) {
    const running = jobs.get(runningId);
    if (running && running.state === 'running') return running;
  }
  // 2) 缓存命中 → 直接返回完成的任务
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < THRESHOLDS.sellPressure.deepCacheTtlMs) {
    return hit.job;
  }

  // 3) 复用已枚举的持有人（不重复拉 9446 个账户）
  const enumeration = getHolderEnumerationCached(mint);
  if (!enumeration) {
    throw new Error(
      'NEED_SCAN: 需要先对这个代币做一次普通扫描（深度模式复用扫描时枚举的持有人列表，避免重复拉取上万个账户）。',
    );
  }
  const targets = pickDeepTargets(enumeration);
  if (targets.length === 0) {
    throw new Error('枚举结果里没有持有余额的地址，无法进行深度分析。');
  }

  const job: DeepJob = {
    id: randomUUID(),
    mint,
    state: 'running',
    progress: { done: 0, total: targets.length, pct: 0 },
    startedAt: Date.now(),
    warnings: [],
  };
  jobs.set(job.id, job);
  byMint.set(mint, job.id);

  const key = apiKey();
  // 故意不 await：POST 立刻返回 id，前端轮询进度
  void fetchDeepHolderHistory(mint, targets, key, {
    onProgress: (p) => {
      job.progress = p;
    },
  })
    .then((result) => {
      job.result = result;
      job.warnings = result.warnings;
      job.state = 'done';
      job.progress = { done: result.succeeded + result.failed, total: targets.length, pct: 100 };
      cache.set(mint, { at: Date.now(), job });
      byMint.delete(mint);
    })
    .catch((e: unknown) => {
      job.state = 'error';
      job.error = e instanceof Error ? e.message : String(e);
      byMint.delete(mint);
    });

  return job;
}

/**
 * 取已完成的深度结果（供扫描时自动并入）。
 *
 * 只认**完成**的任务：正在跑或失败的都不能当成成本依据 ——
 * 半个结果比没有结果更危险（会让人以为已经用了完整历史）。
 */
export function getDeepResultCached(mint: string): DeepHolderResult | undefined {
  const hit = cache.get(mint);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= THRESHOLDS.sellPressure.deepCacheTtlMs) return undefined;
  return hit.job.state === 'done' ? hit.job.result : undefined;
}

/** 测试用：清空任务表 */
export function __resetDeepJobs(): void {
  jobs.clear();
  byMint.clear();
  cache.clear();
}
