// cognition/router.ts —— LLM 双档路由 + 缓存原语（设计 M7）
// tier_map 由玩家定义：把自己的可用模型映射到 compact/flagship 两档；未配置则单模型全任务。
// 路由表按任务类型查表：perceive/score/extract/embed -> compact；plan/dialogue/write/draw-prompt -> flagship。
// 缓存：相同请求 10 分钟结果缓存（前缀稳定化：系统提示 + 记忆注入段排序后哈希）。

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getDecryptedKey, recordUsage } from '../persistence/keyvault.ts';
import { budgetStatus, budgetTripMessage, invalidateBudgetCache, type BudgetStatus } from './llm-budget.ts';

export type TaskType = 'perceive' | 'score' | 'extract' | 'embed' | 'plan' | 'dialogue' | 'write' | 'draw-prompt' | (string & {});

export const TIER_BY_TASK: Record<string, 'compact' | 'flagship'> = {
  perceive: 'compact',
  score: 'compact',
  extract: 'compact',
  embed: 'compact',
  plan: 'flagship',
  dialogue: 'flagship',
  write: 'flagship',
  'draw-prompt': 'flagship',
};

export interface RoutedCall {
  baseUrl: string;
  model: string;
  key: string; // 仅存于内存，调用后立即丢弃；禁止落日志/事件
  tier: 'compact' | 'flagship';
  source: 'player-key' | 'global-provider' | 'none';
}

/** 为玩家路由一次 LLM 调用（查其 tier_map；未配 Key 回落全局 provider；再缺省则 none=降级运行） */
export function routeForAgent(db: DatabaseSync, globalProvider: { url: string; key: string; model: string }, accountUid: string, taskType: string): RoutedCall {
  const tier = TIER_BY_TASK[taskType] || 'flagship';
  const v = getDecryptedKey(db, accountUid);
  if (v && v.key) {
    const model = v.tierMap?.[tier] || v.model;
    return { baseUrl: v.baseUrl, model, key: v.key, tier, source: 'player-key' };
  }
  if (globalProvider.url && globalProvider.key) {
    return { baseUrl: globalProvider.url, model: globalProvider.model, key: globalProvider.key, tier, source: 'global-provider' };
  }
  return { baseUrl: '', model: '', key: '', tier, source: 'none' };
}

// ---------- 前缀稳定化 + 结果缓存 ----------

/** 记忆注入段排序稳定化（数组按内容哈希排序，消除注入顺序抖动） */
export function stabilizePrefix(system: string, memorySegments: string[]): string {
  const sorted = [...memorySegments].sort((a, b) => hashStr(a) < hashStr(b) ? -1 : 1);
  return system + '\n' + sorted.join('\n');
}

export function hashStr(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

export interface CacheOpts { ttlMs?: number; maxEntries?: number; }

/** 相同请求 10 分钟结果缓存（直接节省玩家 Key 额度） */
export class ResultCache {
  private m = new Map<string, { at: number; value: unknown; size: number }>();
  private ttlMs: number;
  private maxEntries: number;

  constructor(opts: CacheOpts = {}) {
    this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
    this.maxEntries = opts.maxEntries ?? 512;
  }

  get(reqKey: string): { hit: boolean; value?: unknown } {
    const e = this.m.get(reqKey);
    if (!e) return { hit: false };
    if (Date.now() - e.at > this.ttlMs) { this.m.delete(reqKey); return { hit: false }; }
    return { hit: true, value: e.value };
  }

  set(reqKey: string, value: unknown): void {
    if (this.m.size >= this.maxEntries) {
      const first = this.m.keys().next().value as string | undefined;
      if (first !== undefined) this.m.delete(first);
    }
    this.m.set(reqKey, { at: Date.now(), value, size: JSON.stringify(value).length });
  }

  clear(): void { this.m.clear(); }
  get size(): number { return this.m.size; }
}

/** 一次带缓存 + 计量的路由调用元数据（编排层使用） */
export interface MeteredRoute {
  call: RoutedCall;
  cacheKey: string;
  hit: boolean;
  /** N12 预算状态（缺省 limit=0 = 不限） */
  budget: BudgetStatus;
  /** 非 null = 已熔断，编排层应降级（不再消耗玩家 Key） */
  blocked: string | null;
  record(tokensIn?: number, tokensOut?: number): void;
}

export function meteredRoute(
  db: DatabaseSync,
  globalProvider: { url: string; key: string; model: string },
  accountUid: string,
  agentUid: string | undefined,
  taskType: string,
  stableRequestText: string,
  cache: ResultCache,
): MeteredRoute {
  const call = routeForAgent(db, globalProvider, accountUid, taskType);
  const cacheKey = `${accountUid}|${taskType}|${call.model}|${hashStr(stableRequestText)}`;
  const hit = cache.get(cacheKey).hit;
  // N12：预算检查放在缓存命中之后 —— 命中缓存不花钱，不该被熔断拦（否则降级质量无谓下降）
  const budget = hit ? { ...budgetStatus(db, accountUid), tripped: false, warn: false, justWarned: false } : budgetStatus(db, accountUid);
  if (budget.justWarned) {
    console.warn(`[llm-budget] 账号 ${accountUid} 今日用量已达软提醒线：${budget.used}/${budget.limit} tokens（${Math.round(budget.ratio * 100)}%）`);
  }
  return {
    call,
    cacheKey,
    hit,
    budget,
    blocked: budgetTripMessage(budget),
    record: (tokensIn?: number, tokensOut?: number) => {
      recordUsage(db, {
        accountUid, agentUid, taskType, tier: call.tier,
        tokensIn, tokensOut, cached: hit,
      });
      // 计量已落库：该账号的预算缓存失效，下一次调用立刻按新用量判闸
      invalidateBudgetCache(accountUid);
    },
  };
}
