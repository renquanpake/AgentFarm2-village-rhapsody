// world/stamina.ts —— 采集类动作的冷却门（世界桶 'staminaData'，uid -> {fishAt, mineAt}）
// 背景：fish/mine 原先只有位置门+工具门，每次调用必产出一件，脚本可无限刷钱，
// 冲击 10% 手续费这道唯一的通缩回收。与 fitness.ts 的 train 冷却同构：动作要真实赶路+操作，
// 冷却表达的是"体力"，比磨损道具温和（背包只有一件工具，磨损会卡死买不起第二件的新手）。
import type { WorldState } from '../persistence/state.ts';

const KEY = 'staminaData';

/** 钓鱼冷却（真实毫秒）：甩竿等咬钩 */
export const FISH_COOLDOWN_MS = 60_000;
/** 挖矿冷却（真实毫秒）：抡镐凿岩，更累 */
export const MINE_COOLDOWN_MS = 90_000;

export interface StaminaRec {
  fishAt?: number;
  mineAt?: number;
}

function allOf(state: WorldState): Record<string, StaminaRec> {
  let all = state.world.get(KEY) as Record<string, StaminaRec> | undefined;
  if (!all) {
    all = {};
    state.world.set(KEY, all);
  }
  return all;
}

function recOf(state: WorldState, uid: string): StaminaRec {
  const all = allOf(state);
  let r = all[uid];
  if (!r) {
    r = {};
    all[uid] = r;
  }
  return r;
}

/** 冷却检查：ok=true 放行并记本次时间；ok=false 带 waitSec（文案由调用方拼） */
export function gate(
  state: WorldState,
  uid: string,
  kind: 'fish' | 'mine',
  cooldownMs: number,
  now: number,
): { ok: boolean; waitSec?: number } {
  const r = recOf(state, uid);
  const last = (kind === 'fish' ? r.fishAt : r.mineAt) ?? 0;
  const wait = cooldownMs - (now - last);
  if (wait > 0) return { ok: false, waitSec: Math.ceil(wait / 1000) };
  if (kind === 'fish') r.fishAt = now; else r.mineAt = now;
  return { ok: true };
}

/** 观察用：某动作还差几秒（无冷却返回 0） */
export function waitSecOf(state: WorldState, uid: string, kind: 'fish' | 'mine', cooldownMs: number, now: number): number {
  const r = allOf(state)[uid];
  const last = r ? (kind === 'fish' ? r.fishAt : r.mineAt) ?? 0 : 0;
  return Math.max(0, Math.ceil((cooldownMs - (now - last)) / 1000));
}