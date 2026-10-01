// world/cooking.ts —— B9 烹饪加工（design M5a）：配方表 recipes.json（磨坊/厨房/窑炉三设施）
// 成品定价 = 原料市场价之和 x 1.4 起步，经市场自然浮动。
// 设施存 world 桶 facilityData（barn/mill/kitchen/kiln/forge），厨房默认全图可用（免设施），磨坊/窑炉/铁匠需建造。
import type { WorldState } from '../persistence/state.ts';
import type { Tables } from '../world/tables.ts';
import type { App } from '../app.ts';
import { knapAdd, knapSub } from './farm.ts';
import { sellX2 } from '../market/shop.ts';
import { municipalOf, buildingTargetOf } from '../navigation/municipal.ts';

export interface Recipe {
  id: number;
  facility: 'mill' | 'kitchen' | 'kiln' | 'forge';
  name: string;
  inputs: Record<number, number>;   // itemId -> qty
  output: { itemId: number; qty: number };
}

export const RECIPES: Record<number, Recipe> = {
  1: { id: 1, facility: 'mill', name: '磨坊：面包', inputs: { 28: 3 }, output: { itemId: 23, qty: 2 } },
  2: { id: 2, facility: 'kitchen', name: '厨房：鸡米花', inputs: { 12: 1, 28: 2 }, output: { itemId: 140, qty: 1 } },
  3: { id: 3, facility: 'kiln', name: '窑炉：精陶', inputs: { 7: 2, 18: 1 }, output: { itemId: 77, qty: 1 } },
  4: { id: 4, facility: 'forge', name: '铁匠：鱼竿', inputs: { 60: 1 }, output: { itemId: 6, qty: 1 } },
  5: { id: 5, facility: 'forge', name: '铁匠：洒水壶', inputs: { 18: 1, 61: 1 }, output: { itemId: 5, qty: 1 } },
};

export type FacilityType = 'barn' | 'mill' | 'kitchen' | 'kiln' | 'forge';
export interface FacilityRec { x: number; y: number; type: FacilityType; level?: number; owner: string }

/** 配方取用：优先 recipes.json（tables.recipes），缺省回退内置 RECIPES */
export function recipeOf(tables: Tables, id: number): Recipe | null {
  const r = tables.recipes?.find(x => x.id === id);
  if (r) return { ...r } as Recipe;
  return RECIPES[id] ?? null;
}
export function recipeIds(tables: Tables): number[] {
  return (tables.recipes?.length ? tables.recipes.map(r => r.id) : Object.keys(RECIPES).map(Number));
}

export function worldFacilities(state: WorldState): FacilityRec[] {
  let f = state.world.get('facilityData') as FacilityRec[] | undefined;
  if (!f) { f = []; state.world.set('facilityData', f); }
  return f;
}

/** 建造费（金币）：设施造价（B3 通胀回收可在此上浮） */
export const BUILD_COST: Record<FacilityType, number> = { barn: 200, mill: 500, kitchen: 300, kiln: 800, forge: 600 };

/** 建造设施（消耗金币；同格同类型限 1） */
export function buildFacility(state: WorldState, uid: string, type: FacilityType, gx: number, gy: number): { ok: boolean; msg?: string } {
  if (!BUILD_COST[type]) return { ok: false, msg: '未知设施类型（barn/mill/kitchen/kiln/forge）' };
  const pm = state.playersDb.get(uid);
  const kn = (pm?.get('knapData') as { props?: Array<{ id: number; num?: number }> } | undefined) || { props: [] };
  kn.props = kn.props || [];
  const coins = kn.props.find(p => p.id === 1);
  const cost = BUILD_COST[type];
  if (!coins || (coins.num || 0) < cost) return { ok: false, msg: `金币不足（建造 ${type} 需 ${cost}）` };
  if (worldFacilities(state).some(f => f.type === type && f.x === gx && f.y === gy)) {
    return { ok: false, msg: '这个格子已有同类设施' };
  }
  coins.num = (coins.num || 0) - cost;
  pm!.set('knapData', kn);
  worldFacilities(state).push({ x: gx, y: gy, type, level: 1, owner: uid });
  state.persist();
  return { ok: true, msg: `建造了 ${type}（花费 ${cost} 金币）` };
}

/** 成品起步价 = 原料市场价（sellX2）之和 x 1.4 */
export function outputPrice(tables: Tables, recipe: Recipe): number {
  let sum = 0;
  for (const [iid, qty] of Object.entries(recipe.inputs)) {
    sum += sellX2(tables, Number(iid)) * qty;
  }
  return Math.round(sum * 1.4);
}

/** 锻造位置门：市政铁匠铺（东环建筑街）门位 6 格内 */
function isNearForgeBuilding(app: App, uid: string): boolean {
  const forge = buildingTargetOf(municipalOf(app), 'forge');
  if (!forge) return false;
  const p = app.state.agentPos.get(uid);
  if (!p || (p.scene ?? 2) !== 2) return false;
  return Math.abs(Math.floor(p.x / 100) - Math.floor(forge.x / 100)) <= 6
    && Math.abs(Math.floor(p.y / 100) - Math.floor(forge.y / 100)) <= 6;
}

/** 烹饪加工：校验设施 + 原料 -> 消耗原料、产出成品 */
export function cook(app: App, uid: string, recipeId: number): { ok: boolean; msg?: string; out?: { itemId: number; qty: number; name: string; price: number } } {
  const recipe = recipeOf(app.tables, recipeId);
  if (!recipe) return { ok: false, msg: `没有这个配方（可用 ${recipeIds(app.tables).join('/')})` };
  const state = app.state;
  // 设施要求：kitchen 免设施；forge 走市政铁匠铺（人在门位 6 格内）或自建 forge；mill/kiln 需已建造
  if (recipe.facility === 'forge') {
    if (!isNearForgeBuilding(app, uid) && !worldFacilities(state).some(f => f.type === 'forge')) {
      return { ok: false, msg: '锻造需在铁匠铺进行（move_to {near:"铁匠铺"}），或先 build 建造 forge 设施' };
    }
  } else if (recipe.facility !== 'kitchen' && !worldFacilities(state).some(f => f.type === recipe.facility)) {
    return { ok: false, msg: `需要 ${recipe.facility} 设施（先 build 建造）` };
  }
  const pm = state.playersDb.get(uid);
  // 校验原料
  for (const [iid, qty] of Object.entries(recipe.inputs)) {
    if (!knapSub(pm, Number(iid), qty)) {
      // 回滚已扣的
      for (const [i2, q2] of Object.entries(recipe.inputs)) {
        if (Number(i2) === Number(iid)) break;
        knapAdd(pm, Number(i2), q2);
      }
      const it = app.tables.items.find(x => x.id === Number(iid));
      return { ok: false, msg: `原料不足：缺 ${it ? it.name : iid} x${qty}` };
    }
  }
  knapAdd(pm, recipe.output.itemId, recipe.output.qty);
  state.persist();
  app.log.append('item.cooked', uid, { uid, recipe: recipeId, itemId: recipe.output.itemId, num: recipe.output.qty });
  const price = outputPrice(app.tables, recipe);
  const outName = app.tables.items.find(x => x.id === recipe.output.itemId)?.name ?? ('成品' + recipe.output.itemId);
  return { ok: true, out: { itemId: recipe.output.itemId, qty: recipe.output.qty, name: outName, price }, msg: `${recipe.name}：产出 ${outName} x${recipe.output.qty}（起步价 ${price}）` };
}
