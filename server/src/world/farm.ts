// world/farm.ts —— 农场模拟：作物生长、田地、洒水器、背包操作（服务器权威）
import type { WorldState } from '../persistence/state.ts';
import type { PlantRec, PlotRec, SprinklerRec, Knap } from '../types.ts';
import type { Tables } from './tables.ts';
import { CROP_BY_PLANT_ID, SPRINKLER_RANGE } from './tables.ts';

type CropsTables = Tables;

// 世界植物（sceneType=1 村庄；world 桶共享 —— 玩家与 agent 共同耕种）
export function worldPlants(state: WorldState): PlantRec[] {
  let pd = state.world.get('plantData') as { datas?: Array<{ sceneType: number; plants?: PlantRec[] }> } | undefined;
  if (!pd) {
    pd = { datas: [{ sceneType: 3, plants: [] }, { sceneType: 2, plants: [] }, { sceneType: 1, plants: [] }] };
    state.world.set('plantData', pd);
  }
  let sc = (pd.datas || []).find(d => d.sceneType === 1);
  if (!sc) { sc = { sceneType: 1, plants: [] }; (pd.datas = pd.datas || []).push(sc); }
  if (!sc.plants) sc.plants = [];
  return sc.plants;
}

export function worldPlots(state: WorldState): PlotRec[] {
  let fd = state.world.get('farmData') as { plotDatas?: Array<{ sceneType: number; plots?: PlotRec[] }> } | undefined;
  if (!fd) { fd = { plotDatas: [{ sceneType: 1, plots: [] }] }; state.world.set('farmData', fd); }
  let sc = (fd.plotDatas || []).find(d => d.sceneType === 1);
  if (!sc) { sc = { sceneType: 1, plots: [] }; (fd.plotDatas = fd.plotDatas || []).push(sc); }
  if (!sc.plots) sc.plots = [];
  return sc.plots;
}

// 洒水器数据：world bucket 里存 sprinklerData = [{x, y, level, owner}]
export function worldSprinklers(state: WorldState): SprinklerRec[] {
  let sd = state.world.get('sprinklerData') as SprinklerRec[] | undefined;
  if (!sd) { sd = []; state.world.set('sprinklerData', sd); }
  return sd;
}

export function sprinklerAt(state: WorldState, gx: number, gy: number): SprinklerRec | undefined {
  return worldSprinklers(state).find(s => s.x === gx && s.y === gy);
}

export function removeSprinkler(state: WorldState, gx: number, gy: number): void {
  const sd = worldSprinklers(state);
  const idx = sd.findIndex(s => s.x === gx && s.y === gy);
  if (idx >= 0) sd.splice(idx, 1);
}

export function plotAt(state: WorldState, gx: number, gy: number): boolean {
  return worldPlots(state).some(p => p.x === gx && p.y === gy);
}

export function soilAt(tables: CropsTables, gx: number, gy: number): boolean {
  if (!tables.farm) return false;
  const F = tables.farm;
  if (gx < 0 || gy < 0 || gx >= F.soilW || gy >= F.soilH) return false;
  return F.plantSoils[gy * F.soilW + gx] === 1;
}

export function waterAt(tables: CropsTables, gx: number, gy: number): boolean {
  if (!tables.farm) return false;
  const F = tables.farm;
  if (gx < 0 || gy < 0 || gx >= F.waterW || gy >= F.waterH) return false;
  return F.water[gy * F.waterW + gx] === 1;
}

// 作物生长推进（真实时间 -> growDay；原版客户端按 growDay 渲染成熟阶段）
export function growPlants(state: WorldState, now?: number): PlantRec[] {
  const plants = worldPlants(state);
  let changed = false;
  const t = now ?? Date.now();
  const gday = state.growDayMsValue();
  for (const p of plants) {
    if (p.farmType !== 1 || !p.sownAt) continue;
    const crop = CROP_BY_PLANT_ID.get(p.plantId);
    if (!crop) continue;
    const nd = Math.min(crop.days, Math.floor((t - p.sownAt) / gday));
    if (nd !== p.growDay) { p.growDay = nd; changed = true; }
  }
  if (changed) state.persist();
  return plants;
}

// 洒水器自动浇水：覆盖范围内的所有作物自动获得浇水（返回明细供事件溯源）
export function sprinklerAutoWater(state: WorldState, tables: Tables): { watered: number; updates: Array<{ uId: number; sownAt: number; growDay: number }> } {
  const sprinklers = worldSprinklers(state);
  const plants = growPlants(state);
  if (!sprinklers.length || !plants.length) return { watered: 0, updates: [] };
  let watered = 0;
  const updates: Array<{ uId: number; sownAt: number; growDay: number }> = [];
  const gday = state.growDayMsValue();
  const now = Date.now();
  for (const s of sprinklers) {
    const range = SPRINKLER_RANGE[s.level ?? 1] || 1;
    for (const p of plants) {
      if (p.farmType !== 1 || !p.sownAt) continue;
      if (Math.abs(p.x - s.x) <= range && Math.abs(p.y - s.y) <= range) {
        const crop = CROP_BY_PLANT_ID.get(p.plantId);
        if (!crop || (p.growDay ?? 0) >= crop.days) continue;
        p.sownAt = Math.max(p.sownAt - gday, now - gday * crop.days);
        p.growDay = Math.min(crop.days, Math.floor((now - p.sownAt) / gday));
        updates.push({ uId: p.uId, sownAt: p.sownAt, growDay: p.growDay });
        watered++;
      }
    }
  }
  if (watered > 0) state.persist();
  return { watered, updates };
}

export function plantAtWorld(state: WorldState, gx: number, gy: number): PlantRec | undefined {
  return growPlants(state).find(p => p.x === gx && p.y === gy);
}

// 树（可砍）：原版树 plantId 14-19
export function treeOf(p: PlantRec | undefined): boolean {
  return !!p && p.plantId >= 14 && p.plantId <= 19;
}

export function nextPlantUid(state: WorldState): number {
  let mx = 0;
  for (const p of worldPlants(state)) if (p.uId > mx) mx = p.uId;
  return mx + 1;
}

// ---------- 玩家私有背包辅助（pm = 玩家私有桶 Map） ----------
function knapOf(pm: Map<string, unknown> | undefined): Knap {
  const kn = (pm?.get('knapData') as Knap | undefined) || { props: [] };
  kn.props = kn.props || [];
  return kn;
}

export function knapAdd(pm: Map<string, unknown> | undefined, itemId: number, num: number): Knap {
  const kn = knapOf(pm);
  const p = kn.props!.find(x => x.id === itemId);
  if (p) p.num = (p.num || 0) + num;
  else kn.props!.push({ id: itemId, num });
  pm?.set('knapData', kn);
  return kn;
}

export function knapHas(pm: Map<string, unknown> | undefined, itemId: number, num = 1): boolean {
  const kn = knapOf(pm);
  const p = kn.props!.find(x => x.id === itemId);
  return !!p && (p.num || 0) >= num;
}

export function knapSub(pm: Map<string, unknown> | undefined, itemId: number, num = 1): boolean {
  const kn = knapOf(pm);
  const p = kn.props!.find(x => x.id === itemId);
  if (!p || (p.num || 0) < num) return false;
  p.num -= num;
  if (p.num <= 0) kn.props = (kn.props || []).filter(x => x !== p);
  pm?.set('knapData', kn);
  return true;
}
