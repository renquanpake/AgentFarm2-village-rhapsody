// world/claims.ts —— 世界资源抢占原子化（C 包/M-O2）
// 多个主体同时请求同一份有限资源时，必须原子裁决（抢树/抢矿/抢摊位）：
// 服务端权威、单事件化事务边界、先到先得、幂等（同主体重复请求不重复占用）。
// 抢占状态存世界桶 claimsData（结构化域，回放可重放，参与 structuredHash）。
// 注意：WorldState 无公开 get/set，直接访问 .world Map + .persist() 提交单事件。
import type { WorldState } from '../persistence/state.js';

export type ClaimKind = 'tree' | 'mine' | 'stall' | 'plot' | 'generic';

export interface ClaimRecord {
  kind: ClaimKind;
  ref: string;          // 资源引用（如 tree@3、mine@5、stall@east）
  owner: string;       // uid 或 agent id
  since: number;       // 单调时钟（游戏日*1000 + 帧序）
  expiresAt?: number;  // 可选过期（D 包租约接管）
}

interface ClaimsData { claims: Record<string, ClaimRecord>; }

/** 抢占键（世界桶，已登记 WORLD_KEYS） */
export const CLAIMS_KEY = 'claimsData';

function data(ws: WorldState): ClaimsData {
  let c = ws.world.get(CLAIMS_KEY) as ClaimsData | undefined;
  if (!c || !c.claims) { c = { claims: {} }; ws.world.set(CLAIMS_KEY, c); }
  return c;
}

/**
 * 原子抢占：同资源同时刻仅一个主体可得。
 * - 已被他人占用 -> { ok:false, holder }（先到先得）
 * - 已被自己占用 -> 幂等返回（不重复）
 * - 空闲 -> 写入并返回（fresh=true）
 * 调用方在得到 fresh=true 后负责发单条「claim」事件并 persist（单事件化事务边界）。
 */
export function tryClaim(
  ws: WorldState, actor: string, kind: ClaimKind, ref: string, tick: number,
  expiresAt?: number,
): { ok: true; fresh: boolean; record: ClaimRecord } | { ok: false; holder: string } {
  const d = data(ws);
  const key = `${kind}:${ref}`;
  const cur = d.claims[key];
  if (cur && cur.owner !== actor) {
    if (cur.expiresAt !== undefined && cur.expiresAt <= tick) {
      delete d.claims[key]; // 过期可抢占
    } else {
      return { ok: false, holder: cur.owner };
    }
  }
  if (cur && cur.owner === actor) {
    if (expiresAt !== undefined) cur.expiresAt = expiresAt;
    return { ok: true, fresh: false, record: cur };
  }
  const record: ClaimRecord = { kind, ref, owner: actor, since: tick, ...(expiresAt !== undefined ? { expiresAt } : {}) };
  d.claims[key] = record;
  return { ok: true, fresh: true, record };
}

/** 释放抢占（actor 主动放弃）。 */
export function release(ws: WorldState, actor: string, kind: ClaimKind, ref: string): boolean {
  const d = data(ws);
  const key = `${kind}:${ref}`;
  const cur = d.claims[key];
  if (cur && cur.owner === actor) { delete d.claims[key]; return true; }
  return false;
}

/** 查询某资源当前持有者。 */
export function holderOf(ws: WorldState, kind: ClaimKind, ref: string): string | null {
  const d = data(ws);
  const cur = d.claims[`${kind}:${ref}`];
  return cur ? cur.owner : null;
}

/** 某主体全部抢占（离开/破产时批量释放）。 */
export function claimsOf(ws: WorldState, actor: string): ClaimRecord[] {
  const d = data(ws);
  return Object.values(d.claims).filter(c => c.owner === actor);
}

/** 释放某主体全部抢占，返回数量。 */
export function releaseAll(ws: WorldState, actor: string): number {
  const d = data(ws);
  let n = 0;
  for (const [k, c] of Object.entries(d.claims)) {
    if (c.owner === actor) { delete d.claims[k]; n++; }
  }
  return n;
}
