// world/decor.ts —— B10 家具装饰 + 最美庭院评比（design M5a）
// 宅基地布置点位表（由房屋矩形派生的可布置格）+ 家具目录 decor.json（60 件，六类）+ decor 表；
// 完成度 100% 触发评比事件（视觉模型评分送 C8/美术管线）。
import type { WorldState } from '../persistence/state.ts';
import type { Tables } from '../world/tables.ts';
import type { App } from '../app.ts';
import { knapAdd, knapSub } from './farm.ts';
import { blockedAt } from '../navigation/grid.ts';

export interface DecorDef { id: number; name: string; category: string; price: number; points: number; artRef?: string | null }
export interface DecorRec { x: number; y: number; decorId: number; owner: string; house?: number }

const BUCKET = 'decorData';

export function worldDecors(state: WorldState): DecorRec[] {
  let d = state.world.get(BUCKET) as DecorRec[] | undefined;
  if (!d) { d = []; state.world.set(BUCKET, d); }
  return d;
}

/** 家具目录（decor.json，Tables 加载；缺省空表） */
export function decorCatalog(tables: Tables): DecorDef[] {
  return tables.decor;
}

/** 宅基地布置点位：房屋矩形外扩 2 格内的可走格（排除水面/障碍/已被占用） */
export function decorSpotsFor(tables: Tables, houseId: number): Array<{ x: number; y: number }> {
  const houses = tables.spawns?.houses || [];
  const h = houses.find(x => x.id === houseId);
  if (!h) return [];
  const out: Array<{ x: number; y: number }> = [];
  for (let gy = h.rect.y - 2; gy <= h.rect.y + h.rect.h + 1; gy++) {
    for (let gx = h.rect.x - 2; gx <= h.rect.x + h.rect.w + 1; gx++) {
      if (blockedAt(tables, gx, gy)) continue;
      out.push({ x: gx * 100 + 50, y: gy * 100 + 50 });
    }
  }
  return out;
}

/** 布置家具：点位校验 + 去重 + 扣金币 */
export function placeDecor(state: WorldState, tables: Tables, uid: string, houseId: number, decorId: number, px: number, py: number): { ok: boolean; msg?: string } {
  const def = decorCatalog(tables).find(d => d.id === decorId);
  if (!def) return { ok: false, msg: `没有这件家具（id=${decorId}）` };
  const spots = decorSpotsFor(tables, houseId);
  if (!spots.some(s => s.x === px && s.y === py)) return { ok: false, msg: '这个位置不在宅基地布置点内' };
  if (worldDecors(state).some(d => d.x === px && d.y === py && d.owner === uid)) return { ok: false, msg: '这个位置已布置' };
  const pm = state.playersDb.get(uid);
  if (!knapSub(pm, 1, def.price)) return { ok: false, msg: `金币不足（${def.name} 需 ${def.price}）` };
  worldDecors(state).push({ x: px, y: py, decorId, owner: uid, house: houseId });
  state.persist();
  return { ok: true, msg: `布置了 ${def.name}（+${def.points} 庭院分）` };
}

/** 移除家具：退还 50% 金币 */
export function removeDecor(state: WorldState, tables: Tables, uid: string, px: number, py: number): { ok: boolean; msg?: string } {
  const arr = worldDecors(state);
  const i = arr.findIndex(x => x.x === px && x.y === py && x.owner === uid);
  if (i < 0) return { ok: false, msg: '这个位置没有你的家具' };
  const d = arr[i];
  arr.splice(i, 1);
  const def = decorCatalog(tables).find(x => x.id === d.decorId);
  if (def) knapAdd(state.playersDb.get(uid), 1, Math.floor(def.price / 2));
  state.persist();
  return { ok: true, msg: `移除了 ${def?.name || '家具'}（退还 ${def ? Math.floor(def.price / 2) : 0} 金币）` };
}

/** 庭院评分：该玩家全部家具点数之和 */
export function courtyardScore(state: WorldState, tables: Tables, uid: string): number {
  return worldDecors(state)
    .filter(d => d.owner === uid)
    .reduce((s, d) => s + (decorCatalog(tables).find(c => c.id === d.decorId)?.points ?? 0), 0);
}

/** 完成度：已布置格 / 该宅可布置格（100% 触发评比） */
export function courtyardCompletion(state: WorldState, tables: Tables, uid: string, houseId: number): number {
  const spots = decorSpotsFor(tables, houseId);
  if (!spots.length) return 0;
  const placed = worldDecors(state).filter(d => d.owner === uid && d.house === houseId).length;
  return Math.min(1, placed / spots.length);
}

/** 最美庭院评比：按玩家庭院分排序；满分者触发视觉模型评分事件（送 C8 管线） */
export function courtyardContest(app: App): Array<{ uid: string; username: string; score: number }> {
  const state = app.state, tables = app.tables;
  const byPlayer = new Map<string, number>();
  for (const d of worldDecors(state)) {
    byPlayer.set(d.owner, (byPlayer.get(d.owner) || 0) + (decorCatalog(tables).find(c => c.id === d.decorId)?.points ?? 0));
  }
  const rank = [...byPlayer.entries()]
    .map(([uid, score]) => ({ uid, username: typeof app.usernameOf === 'function' ? app.usernameOf(uid) : uid, score }))
    .sort((a, b) => b.score - a.score || a.uid.localeCompare(b.uid));
  // 满分者 -> 评比事件（视觉模型评分在 C8 美术管线）
  for (const r of rank) {
    const house = (state.playersDb.get(r.uid)?.get('playerData') as { houseId?: number } | undefined)?.houseId;
    if (house && courtyardCompletion(state, tables, r.uid, house) >= 1) {
      app.log.append('decor.contest', r.uid, { uid: r.uid, score: r.score, complete: true });
    }
  }
  return rank;
}

/** 纯读排行（无 decor.contest 副作用；/af/decor-board 端点用） */
export function courtyardRanking(state: WorldState, tables: Tables, usernameOf?: (uid: string) => string): Array<{ uid: string; username: string; score: number }> {
  const byPlayer = new Map<string, number>();
  const catalog = decorCatalog(tables);
  for (const d of worldDecors(state)) {
    byPlayer.set(d.owner, (byPlayer.get(d.owner) || 0) + (catalog.find(c => c.id === d.decorId)?.points ?? 0));
  }
  return [...byPlayer.entries()]
    .map(([uid, score]) => ({ uid, username: usernameOf ? usernameOf(uid) : uid, score }))
    .sort((a, b) => b.score - a.score || a.uid.localeCompare(b.uid));
}
