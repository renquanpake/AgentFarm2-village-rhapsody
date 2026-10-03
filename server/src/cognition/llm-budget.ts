// cognition/llm-budget.ts —— N12 Agent 成本熔断（每日 token 预算 + 软提醒 + 硬熔断）
//
// 背景：玩家自带 Key（AF_AES_KEY 加密保管）由 Agent 无节制调用，一次失控循环
// （对话/计划/抽取循环）就能把额度烧穿。llm_usage 计量早就有，缺的是「闸」。
//
// 三段式：
//   软提醒 —— 用量 ≥ warn 比例（缺省 80%）时按账号每日一次告警（服务端日志 + /af/llm-usage 字段）
//   硬熔断 —— 用量 ≥ limit 时 LLM 调用直接降级为规则兜底（chat -> null / embed -> 伪向量），
//            游戏继续跑，玩家的 Key 不再被消耗；改预算只需改环境变量重启。
//
// 口径：按【账号】（accountUid）自然日累计 tokens_in + tokens_out，缓存 60s 避免每调用查库。
import type { DatabaseSync } from 'node:sqlite';
import { usageSummary } from '../persistence/keyvault.ts';

const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 60_000;

export interface BudgetConfig {
  /** 每账号每日 token 上限；<=0 = 不限（关闸） */
  limit: number;
  /** 软提醒比例（0~1+） */
  warnRatio: number;
}

export interface BudgetStatus {
  accountUid: string;
  limit: number;
  used: number;
  ratio: number;
  warn: boolean;
  /** 硬熔断：已超限，本次 LLM 调用应降级 */
  tripped: boolean;
  /** 本自然日 0 点的毫秒时间戳 */
  since: number;
  /** 是否刚跨过软提醒线（供调用方做「每日一次」告警） */
  justWarned: boolean;
}

export function budgetConfig(env: Record<string, string | undefined> = process.env): BudgetConfig {
  const limit = Number(env.AF_LLM_DAILY_TOKENS);
  const warnRaw = Number(env.AF_LLM_BUDGET_WARN);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0,
    warnRatio: Number.isFinite(warnRaw) && warnRaw > 0 ? Math.min(warnRaw, 10) : 0.8,
  };
}

export function dayStartMs(now = Date.now()): number {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

interface CacheEntry { status: BudgetStatus; at: number }
const cache = new Map<string, CacheEntry>();
const warnedOn = new Set<string>(); // `${accountUid}|${dayStart}` —— 软提醒每日一次

/** 取当日预算状态（带 60s 缓存） */
export function budgetStatus(db: DatabaseSync, accountUid: string, now = Date.now(), env: Record<string, string | undefined> = process.env): BudgetStatus {
  const cfg = budgetConfig(env);
  const since = dayStartMs(now);
  const hit = cache.get(accountUid);
  // 缓存命中：状态照旧，但 justWarned 只在真正跨线那一次为 true（否则 60s 内每次调用都刷告警）
  if (hit && now - hit.at < CACHE_TTL_MS && hit.status.since === since) return { ...hit.status, justWarned: false };

  // 计量查询失败（缺表/旧档/轻量 mock db）按零计量：闸必须 fail-open，绝不让查询错误
  // 变成「游戏内 LLM 全量降级」
  let used = 0;
  try {
    const s = usageSummary(db, accountUid, since);
    used = s.tokensIn + s.tokensOut;
  } catch { used = 0; }
  const ratio = cfg.limit > 0 ? used / cfg.limit : 0;
  const warnKey = `${accountUid}|${since}`;
  const status: BudgetStatus = {
    accountUid,
    limit: cfg.limit,
    used,
    ratio,
    warn: cfg.limit > 0 && ratio >= cfg.warnRatio,
    tripped: cfg.limit > 0 && used >= cfg.limit,
    since,
    justWarned: false,
  };
  if (status.warn && !warnedOn.has(warnKey)) {
    warnedOn.add(warnKey);
    status.justWarned = true;
  }
  // warnedOn 只留最近两天，避免无限增长
  if (warnedOn.size > 512) {
    for (const k of [...warnedOn]) if (!k.endsWith(`|${since}`) && !k.endsWith(`|${since - DAY_MS}`)) warnedOn.delete(k);
  }
  cache.set(accountUid, { status, at: now });
  return status;
}

/** 熔断判定（llm.ts 调用点用；未超限返回 null） */
export function budgetTripMessage(s: BudgetStatus): string | null {
  if (!s.tripped) return null;
  return `Agent 每日 token 预算已用尽（${s.used}/${s.limit}）——已降级为规则兜底，不再消耗你的 Key；调整 AF_LLM_DAILY_TOKENS 可放开`;
}

export function clearBudgetCache(): void {
  cache.clear();
  warnedOn.clear();
}

/** 计量落库后失效缓存（只清该账号；无参清全部） */
export function invalidateBudgetCache(accountUid?: string): void {
  if (!accountUid) { cache.clear(); return; }
  cache.delete(accountUid);
}