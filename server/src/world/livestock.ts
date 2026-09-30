// world/livestock.ts —— B9 畜牧（design M5a）：复用作物状态机扩展（幼崽->成年->周期产出）
// 产出品质三档（普通/银/金，受饱食度与心情影响）；畜棚为可建造实体（提升容量上限）。
// 动物存于 world 桶 livestockData（独立于客户端 plantData，mod 层另行渲染）。
import type { WorldState } from '../persistence/state.ts';
import type { Tables } from '../world/tables.ts';
import { knapAdd, knapHas, knapSub } from './farm.ts';

export interface AnimalRec {
  uId: number;
  animalId: number;
  x: number;
  y: number;
  owner: string;
  farmType?: number;      // 2 = 畜牧
  growDay?: number;       // 生长阶段（同作物：0..growDays）
  sownAt?: number;
  satiety?: number;       // 饱食度 0-100
  mood?: number;          // 心情 0-100
  lastProduceDay?: number;
  adoptDay?: number;      // 领养游戏日（衰减基线）
  lastDecayDay?: number;  // 上次衰减结算的游戏日
  [k: string]: unknown;
}

export type Quality = 'normal' | 'silver' | 'gold';

// 动物定义（produceItemId 用现有物品）
export interface AnimalDef {
  animalId: number;
  name: string;
  growDays: number;      // 幼崽 -> 成年
  produceItemId: number;  // 周期产出物
  produceEvery: number;  // 每 N 游戏日产一次
  feedItemId: number;    // 可喂食物品
}

export const ANIMALS: Record<number, AnimalDef> = {
  1: { animalId: 1, name: '奶牛', growDays: 3, produceItemId: 64, produceEvery: 1, feedItemId: 28 }, // 牛奶
  2: { animalId: 2, name: '猪', growDays: 3, produceItemId: 12, produceEvery: 2, feedItemId: 30 }, // 野猪腿
  3: { animalId: 3, name: '鸡', growDays: 2, produceItemId: 140, produceEvery: 1, feedItemId: 29 }, // 鸡米花
};

const BUCKET = 'livestockData';

export function worldAnimals(state: WorldState): AnimalRec[] {
  let a = state.world.get(BUCKET) as AnimalRec[] | undefined;
  if (!a) { a = []; state.world.set(BUCKET, a); }
  return a;
}

export function nextAnimalUid(state: WorldState): number {
  return worldAnimals(state).reduce((m, x) => Math.max(m, x.uId), 0) + 1;
}

/** 生长推进（同作物：真实时间 -> growDay；幼崽 -> 成年） */
export function growLivestock(state: WorldState, now?: number): AnimalRec[] {
  const t = now ?? Date.now();
  const gday = state.growDayMsValue();
  let changed = false;
  for (const a of worldAnimals(state)) {
    const def = ANIMALS[a.animalId];
    if (!def || a.sownAt === undefined) continue;
    const nd = Math.min(def.growDays, Math.floor((t - a.sownAt) / gday));
    if (nd !== (a.growDay ?? 0)) { a.growDay = nd; changed = true; }
  }
  if (changed) state.persist();
  return worldAnimals(state);
}

/** 畜棚容量上限（2 + 每畜棚 2） */
export function animalCapacity(state: WorldState, tables: Tables): number {
  const barns = (state.world.get('facilityData') as Array<{ type?: string }> | undefined)?.filter(f => f.type === 'barn').length ?? 0;
  return 2 + barns * 2;
}

/** 周期产出：先按游戏日衰减饱食/心情，再成年且到间隔 -> 按 饱食+心情 定品质，产出进主人背包 */
export function produceFromAnimals(state: WorldState, tables: Tables, day: number, now?: number): Array<{ uId: number; quality: Quality; itemId: number; owner: string }> {
  growLivestock(state, now);
  const out: Array<{ uId: number; quality: Quality; itemId: number; owner: string }> = [];
  const cap = animalCapacity(state, tables);
  const matureCount = worldAnimals(state).filter(x => (x.growDay ?? 0) >= (ANIMALS[x.animalId]?.growDays ?? 0)).length;
  for (const a of worldAnimals(state)) {
    const def = ANIMALS[a.animalId];
    if (!def) continue;
    // 衰减：距上次衰减结算 N 个游戏日，每天 饱食-10 / 心情-5
    const decayBase = a.lastDecayDay ?? a.adoptDay ?? 0;
    const daysSince = Math.max(0, day - decayBase);
    if (daysSince > 0) {
      if (a.satiety !== undefined) a.satiety = Math.max(0, (a.satiety ?? 0) - 10 * daysSince);
      if (a.mood !== undefined) a.mood = Math.max(0, (a.mood ?? 0) - 5 * daysSince);
      a.lastDecayDay = day;
    }
    if ((a.growDay ?? 0) < def.growDays) continue; // 未成年
    if (matureCount > cap) break; // 产能上限（需建畜棚）
    if (a.lastProduceDay !== undefined && (day - a.lastProduceDay) < def.produceEvery) continue;
    const score = (a.satiety ?? 0) + (a.mood ?? 0);
    const quality: Quality = score >= 160 ? 'gold' : score >= 100 ? 'silver' : 'normal';
    const qty = quality === 'gold' ? 2 : 1;
    knapAdd(state.playersDb.get(a.owner), def.produceItemId, qty);
    a.lastProduceDay = day;
    out.push({ uId: a.uId, quality, itemId: def.produceItemId, owner: a.owner });
  }
  if (out.length) state.persist();
  return out;
}

/** 喂食：消耗 feed 物品 -> 饱食度 +40（封顶 100） */
export function feedAnimal(state: WorldState, uid: string, animalUid: number, foodItemId?: number): { ok: boolean; msg?: string; satiety?: number } {
  const a = worldAnimals(state).find(x => x.uId === animalUid);
  if (!a) return { ok: false, msg: '没有这只动物' };
  const def = ANIMALS[a.animalId];
  if (!def) return { ok: false, msg: '未知动物' };
  const food = foodItemId ?? def.feedItemId;
  const pm = state.playersDb.get(uid);
  if (!knapHas(pm, food, 1)) return { ok: false, msg: `没有 ${food} 号食物可喂` };
  knapSub(pm, food, 1);
  a.satiety = Math.min(100, (a.satiety ?? 0) + 40);
  state.persist();
  return { ok: true, satiety: a.satiety, msg: `喂了 ${def.name}（饱食度 ${a.satiety}）` };
}

/** 互动：心情 +25 */
export function petAnimal(state: WorldState, uid: string, animalUid: number): { ok: boolean; msg?: string; mood?: number } {
  const a = worldAnimals(state).find(x => x.uId === animalUid);
  if (!a) return { ok: false, msg: '没有这只动物' };
  a.mood = Math.min(100, (a.mood ?? 0) + 25);
  state.persist();
  return { ok: true, mood: a.mood, msg: `${a.owner} 的宠物心情 ${a.mood}` };
}

/** 领养/放置动物（受容量限制）；day = 当前游戏日（衰减基线） */
export function adoptAnimal(state: WorldState, tables: Tables, uid: string, animalId: number, x: number, y: number, day = 0): { ok: boolean; msg?: string; uId?: number } {
  if (!ANIMALS[animalId]) return { ok: false, msg: '未知动物（可选 ' + Object.keys(ANIMALS).join('/') + '）' };
  if (worldAnimals(state).length >= animalCapacity(state, tables)) {
    return { ok: false, msg: `畜栏已满（上限 ${animalCapacity(state, tables)}），先建畜棚` };
  }
  const a: AnimalRec = {
    uId: nextAnimalUid(state), animalId, x, y, owner: uid, farmType: 2,
    growDay: 0, sownAt: Date.now(), satiety: 50, mood: 50,
    lastProduceDay: day, adoptDay: day,
  };
  worldAnimals(state).push(a);
  state.persist();
  return { ok: true, uId: a.uId, msg: `领养了 ${ANIMALS[animalId].name}` };
}
