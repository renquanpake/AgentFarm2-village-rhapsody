// world/farm.ts —— 农场模拟：作物生长、田地、洒水器、背包操作（服务器权威）
import type { WorldState } from '../persistence/state.ts';
import type { PlantRec, PlotRec, SprinklerRec, Knap } from '../types.ts';
import type { Tables } from './tables.ts';
import { CROP_BY_PLANT_ID, SPRINKLER_RANGE } from './tables.ts';

type CropsTables = Tables;

// 原版 GD.SceneType 枚举实测值（client/assets/main/index.e6d95.js）：
//   1=HOME_MAP 出生小岛 / 2=VILLAGE_MAP 村庄 / 3=RIVER_MAP 河流 / 4=PADDY_MAP 稻田
//   5=NUNNERY_MAP / 6=HOTSPRING_MAP / 7=BAOLONG_MAP / 8=MINEGATE_MAP / 9=CEMETERY_MAP
//   10=TRAIL_MAP / 11=BRIDGE_MAP / 12=HILLTOP_MAP / 13=FOREST_MAP / 14=CABLEWAY_MAP
//   101=PLAYER_HOUSE 起
export const SCENE_HOME_MAP = 1;
export const SCENE_VILLAGE_MAP = 2;
export const SCENE_RIVER_MAP = 3;

// 服务端只服务一张地图：data/village-farm.json 189x173，LEFT/TOP=56，
// 原版村庄范围 origW=77 / origH=61（= VILLAGE_MAP 存档格 0..76 / 0..60），
// 碰撞/水域/土壤/道路/建筑/地标也全部是 scene 2。故世界植物桶 = VILLAGE_MAP。
// HOME_MAP(269 株/44 树，x56..84) 与 RIVER_MAP(170 株/25 树) 属未加载场景，
// 且与村庄桶有 43 / 32 个坐标重叠，直接并入会造成同格多树与误砍。
export const WORLD_SCENE_TYPE = SCENE_VILLAGE_MAP;

// 原版 farmData.plotDatas 把玩家农田记在 HOME_MAP 桶（存档 x13..15/y15..16），
// 世界坐标落在村庄图内，读取方式与渲染无关，保持原位不迁移。
export const PLOT_SCENE_TYPE = SCENE_HOME_MAP;

export type PlantBucket = { sceneType: number; plants?: PlantRec[] };

/** 取（必要时创建）指定 sceneType 的植物桶 */
export function scenePlantBucket(state: WorldState, sceneType: number): PlantBucket {
  let pd = state.world.get('plantData') as { datas?: PlantBucket[] } | undefined;
  if (!pd) { pd = { datas: [] }; state.world.set('plantData', pd); }
  const datas = (pd.datas = pd.datas || []);
  let sc = datas.find(d => d.sceneType === sceneType);
  if (!sc) { sc = { sceneType, plants: [] }; datas.push(sc); }
  if (!sc.plants) sc.plants = [];
  return sc;
}

// 世界植物（VILLAGE_MAP 桶；world 桶共享 —— 玩家与 agent 共同耕种与采伐）
export function worldPlants(state: WorldState): PlantRec[] {
  return scenePlantBucket(state, WORLD_SCENE_TYPE).plants!;
}

export function worldPlots(state: WorldState): PlotRec[] {
  let fd = state.world.get('farmData') as { plotDatas?: Array<{ sceneType: number; plots?: PlotRec[] }> } | undefined;
  if (!fd) { fd = { plotDatas: [] }; state.world.set('farmData', fd); }
  const datas = (fd.plotDatas = fd.plotDatas || []);
  let sc = datas.find(d => d.sceneType === PLOT_SCENE_TYPE);
  if (!sc) { sc = { sceneType: PLOT_SCENE_TYPE, plots: [] }; datas.push(sc); }
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

/**
 * 取坐标上的作物（farmType=1）。
 * VILLAGE_MAP 桶同时装着 1018 株场景装饰（farmType=2）与玩家作物，同格并存是常态
 * （玩家犁的地块可能正压着原版场景植物），按坐标 find() 会先撞上装饰株。
 * 耕地/播种的占位判定仍用 plantAtWorld（任何植物都占位）；
 * 浇水/收获/observe 预览必须用本函数，优先返回作物，无作物时回退场景植物以保留提示文案。
 */
export function cropAtWorld(state: WorldState, gx: number, gy: number): PlantRec | undefined {
  let scene: PlantRec | undefined;
  for (const p of growPlants(state)) {
    if (p.x !== gx || p.y !== gy) continue;
    if (p.farmType === 1) return p;
    if (!scene) scene = p;
  }
  return scene;
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
