// 出生槽位偏移生成器（B 包/M-O2）——多玩家共用同坐标出生会碰撞，
// 每玩家按加入顺序取一个互不重叠的"出生槽位"（门户吸附环上 N 等分点），
// 落到对应住宅门口后做同向微调，保证两人同门不叠身。
// 纯函数：输入 SpawnDef，输出每玩家出生槽位（像素），确定性（回放可重放）。
import fs from 'node:fs';
import path from 'node:path';
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

// ---------- B4：场景 1（家门口）槽位化 —— 房子私有 ----------
//
// data/home-slots.json 由 tools/gen-home-slots.mjs 生成（确定性合成，见该文件头）。
// 服务端只做「归属校验」：玩家只能在自己那一槽的世界格里出现/移动，
// 跨槽坐标一律拒（隔离即路由约束 —— 不靠客户端自觉）。

export interface HomeSlotRect { slot: number; rect: { x: number; y: number; w: number; h: number }; spawnCell: { x: number; y: number }; spawnPx: { x: number; y: number } }
export interface HomeSlotDoc { version: number; scene: number; slots: HomeSlotRect[] }

export const HOME_SLOTS_FILE = 'home-slots.json';

/** 读槽位表（文件缺失时返回 null —— 单人老档/隔离环境不阻塞） */
export function loadHomeSlots(dataDir: string): HomeSlotDoc | null {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(dataDir, HOME_SLOTS_FILE), 'utf8')) as HomeSlotDoc;
    return doc && Array.isArray(doc.slots) && doc.slots.length ? doc : null;
  } catch { return null; }
}

/** 玩家应住哪一槽：按加入序号取（第 1..N 名玩家 -> 槽 0..N-1，超出则回绕并给出警告位） */
export function slotOfPlayer(doc: HomeSlotDoc | null, playerIdx: number): HomeSlotRect | null {
  if (!doc || !doc.slots.length) return null;
  const i = Math.max(1, Math.floor(playerIdx)) - 1;
  return doc.slots[Math.min(i, doc.slots.length - 1)];
}

/** 坐标是否落在某槽矩形内（世界格） */
export function inSlotRect(doc: HomeSlotDoc, slotIdx: number, gx: number, gy: number): boolean {
  const s = doc.slots[slotIdx];
  if (!s) return false;
  const r = s.rect;
  return gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h;
}

/**
 * 归属校验：场景 1 的落点必须在玩家自己那一槽。
 * 返回 null = 放行；返回字符串 = 拒写理由（进玩家桶前就拦住）。
 */
export function homeSlotViolation(doc: HomeSlotDoc | null, playerIdx: number, gx: number, gy: number): string | null {
  if (!doc) return null;
  const mine = slotOfPlayer(doc, playerIdx);
  if (!mine) return null;
  if (inSlotRect(doc, mine.slot, gx, gy)) return null;
  const target = doc.slots.find(s => inSlotRect(doc, s.slot, gx, gy));
  return target
    ? `坐标 (${gx},${gy}) 属于别人的家门口（槽 ${target.slot + 1}），你住槽 ${mine.slot + 1}（世界格 ${mine.rect.x}-${mine.rect.x + mine.rect.w - 1} / ${mine.rect.y}-${mine.rect.y + mine.rect.h - 1}）`
    : `坐标 (${gx},${gy}) 不在任何家门口槽内（你家在槽 ${mine.slot + 1}）`;
}

/** 玩家在场景 1 的合法出生像素（重连/传送兜底） */
export function homeSpawnPx(doc: HomeSlotDoc | null, playerIdx: number): { x: number; y: number } | null {
  const s = slotOfPlayer(doc, playerIdx);
  return s ? { ...s.spawnPx } : null;
}
