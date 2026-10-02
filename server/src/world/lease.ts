// world/lease.ts —— 租约与再生（D 包/M-O2）
// 公共田块的认领（plot）从播种起带租约时钟：
// - 租约 = 认领方在 expiresAt 内完成收获的期限
// - 照料事件（浇水/除虫/补种）延长租约（延长上限防止无限占位）
// - 逾期未照料 -> 枯萎判定：租约释放 + 资源再生（树复生、田块复位）
// 状态存世界桶 leaseData（结构化域，回放可重放，参与 structuredHash）。
import type { WorldState } from '../persistence/state.js';

export const LEASE_KEY = 'leaseData';

export interface LeaseRecord {
  plot: string;        // 田块引用
  owner: string;       // uid/agent
  startTick: number;   // 播种起
  leaseMs: number;     // 租约时长
  lastCareTick: number;// 最近照料
  careCount: number;   // 照料次数
  withered?: boolean;  // 已枯萎（待再生）
  regrowAt?: number;   // 再生点（枯木/田块复位）
}

interface LeaseData { leases: Record<string, LeaseRecord>; }

/** 照料可延长租约的上限（防无限占位） */
const MAX_CARE_EXTEND = 5;
/** 枯萎后再生所需时钟 */
const REGROW_TICKS = 300;

function data(ws: WorldState): LeaseData {
  let c = ws.world.get(LEASE_KEY) as LeaseData | undefined;
  if (!c || !c.leases) { c = { leases: {} }; ws.world.set(LEASE_KEY, c); }
  return c;
}

/** 起租：田块播种时起租约。 */
export function openLease(ws: WorldState, plot: string, owner: string, tick: number, leaseMs: number): void {
  const d = data(ws);
  d.leases[plot] = { plot, owner, startTick: tick, leaseMs, lastCareTick: tick, careCount: 0 };
}

/** 照料事件：延长租约（有上限）。返回当前租约。 */
export function care(ws: WorldState, plot: string, owner: string, tick: number, extendMs: number): LeaseRecord | null {
  const d = data(ws);
  const l = d.leases[plot];
  if (!l || l.owner !== owner) return null;
  if (l.careCount < MAX_CARE_EXTEND) {
    l.careCount++;
    l.lastCareTick = tick;
    l.leaseMs = Math.min(l.leaseMs + extendMs, leaseStartOf(l) + MAX_CARE_EXTEND * extendMs);
  }
  l.withered = false;
  return l;
}

/** 枯萎判定：tick 超租约且无有效照料 -> 枯萎并排定再生。 */
export function tickLease(ws: WorldState, tick: number): string[] {
  const d = data(ws);
  const withered: string[] = [];
  for (const l of Object.values(d.leases)) {
    if (l.withered) continue;
    const deadline = leaseStartOf(l) + l.leaseMs;
    if (tick > deadline) {
      l.withered = true;
      l.regrowAt = tick + REGROW_TICKS;
      withered.push(l.plot);
    }
  }
  return withered;
}

/** 再生：tick 到再生点 -> 释放租约（田块复位，可被他人重新抢占）。 */
export function regrow(ws: WorldState, tick: number): string[] {
  const d = data(ws);
  const freed: string[] = [];
  for (const [plot, l] of Object.entries(d.leases)) {
    if (l.withered && l.regrowAt !== undefined && tick >= l.regrowAt) {
      delete d.leases[plot];
      freed.push(plot);
    }
  }
  return freed;
}

/** 风暴预警：某田块将在 stormMs 内到期且未照料 -> 提前通知（供广播）。 */
export function stormWarning(ws: WorldState, tick: number, stormMs: number): string[] {
  const d = data(ws);
  const out: string[] = [];
  for (const l of Object.values(d.leases)) {
    if (l.withered) continue;
    const deadline = leaseStartOf(l) + l.leaseMs;
    if (deadline - tick <= stormMs && deadline - tick > 0) out.push(l.plot);
  }
  return out;
}

function leaseStartOf(l: LeaseRecord): number { return l.startTick; }

/** 取某田块当前租约（无则 null）。 */
export function leaseOf(ws: WorldState, plot: string): LeaseRecord | null {
  return data(ws).leases[plot] ?? null;
}
