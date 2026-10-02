// 出生槽位偏移生成器（B 包/M-O2）——多玩家共用同坐标出生会碰撞，
// 每玩家按加入顺序取一个互不重叠的"出生槽位"（门户吸附环上 N 等分点），
// 落到对应住宅门口后做同向微调，保证两人同门不叠身。
// 纯函数：输入 SpawnDef，输出每玩家出生槽位（像素），确定性（回放可重放）。
import type { SpawnDef } from '../types.js';

export interface SpawnSlot {
  playerIdx: number;      // 1..N（1=首位玩家保留原版）
  houseId: number;
  door: { x: number; y: number };
  // 槽位偏移：同门多玩家互不叠身（沿门户吸附环切向）
  offset: { x: number; y: number };
  finalPos: { x: number; y: number };
}

// 门户吸附环半径（与门户吸附一致，见 nav 吸附）
const PORTAL_RING = 40;
// 最大玩家数（超出回绕，避免负索引）
export const MAX_SPAWN_PLAYERS = 16;

/** 玩家出生槽位：门户吸附环 N 等分，第 i 玩家落在第 i 分点。确定性。 */
export function spawnSlotFor(spawns: SpawnDef, playerIdx: number): SpawnSlot | null {
  if (!spawns?.houses?.length) return null;
  const houses = spawns.houses;
  // 第 1 玩家保留原版家门口；第 2+ 玩家按序取 houses
  const house = houses[(playerIdx - 2 + houses.length) % houses.length] || houses[0];
  const n = Math.min(playerIdx, MAX_SPAWN_PLAYERS);
  const ang = (Math.PI * 2 * (playerIdx - 1)) / Math.max(n, 1);
  const dx = Math.round(Math.cos(ang) * PORTAL_RING);
  const dy = Math.round(Math.sin(ang) * PORTAL_RING);
  return {
    playerIdx,
    houseId: house.id,
    door: { ...house.door },
    offset: { x: dx, y: dy },
    finalPos: { x: house.door.x + dx, y: house.door.y + dy },
  };
}

/** 全部玩家出生槽位表（回放/生成器消费）。 */
export function spawnSlotsAll(spawns: SpawnDef, playerCount: number): SpawnSlot[] {
  const out: SpawnSlot[] = [];
  for (let i = 1; i <= Math.max(0, playerCount); i++) {
    const s = spawnSlotFor(spawns, i);
    if (s) out.push(s);
  }
  return out;
}
