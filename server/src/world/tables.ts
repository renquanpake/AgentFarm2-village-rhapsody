// world/tables.ts —— 静态数据表加载（data/*.json）与作物/鱼/矿池常数
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FarmDef, SpawnDef, ItemDef, NpcDef, CollisionDef, MineSpot, CropDef } from '../types.ts';

export interface RecipeRow {
  id: number;
  facility: string;
  name: string;
  inputs: Record<string, number>;
  output: { itemId: number; qty: number };
}

// 种子 -> 作物表（seedItemId -> {plantId 渲染植物, cropItemId 收获物, days 成熟天数}）
export const PLANT_CROPS: Record<number, CropDef> = {
  36: { name: '小麦', plantId: 1, cropItemId: 28, days: 2 },
  37: { name: '玉米', plantId: 2, cropItemId: 29, days: 3 },
  38: { name: '土豆', plantId: 3, cropItemId: 30, days: 2 },
  39: { name: '兰花', plantId: 4, cropItemId: 31, days: 2 },
  40: { name: '黄菊', plantId: 5, cropItemId: 32, days: 3 },
  41: { name: '白菊', plantId: 6, cropItemId: 33, days: 3 },
  42: { name: '粉菊', plantId: 7, cropItemId: 34, days: 3 },
  43: { name: '迷幻花', plantId: 8, cropItemId: 35, days: 4 },
  52: { name: '北美草药', plantId: 9, cropItemId: 53, days: 3 },
  54: { name: '芥菜', plantId: 10, cropItemId: 55, days: 2 },
  56: { name: '辣椒', plantId: 11, cropItemId: 57, days: 3 },
  96: { name: '胡萝卜', plantId: 12, cropItemId: 97, days: 2 },
};
// 反向索引：plantId -> crop 定义（O(1) 查询）
export const CROP_BY_PLANT_ID = new Map<number, CropDef>(Object.values(PLANT_CROPS).map(c => [c.plantId, c]));
// 鱼池（概率权重）：水边 fish
export const FISH_POOL: Array<[number, number]> = [
  [19, 30], [65, 20], [68, 15], [69, 15], [73, 10],
  [67, 10], [71, 8], [72, 5], [70, 4], [74, 1],
];
// 矿物池：矿山 mine
export const MINE_POOL: Array<[number, number]> = [
  [109, 35], [60, 30], [61, 20], [7, 10], [84, 3],
];
// 洒水器半径（格）：level 1=3x3, 2=5x5, 3=7x7
export const SPRINKLER_RANGE: Record<number, number> = { 1: 1, 2: 2, 3: 3 };

export class Tables {
  farm: FarmDef | null;
  spawns: SpawnDef | null;
  items: ItemDef[];
  npcs: NpcDef[];
  collision: CollisionDef | null;
  mineSpots: MineSpot[];
  recipes: Array<{ id: number; facility: string; name: string; inputs: Record<number, number>; output: { itemId: number; qty: number } }>;
  decor: Array<{ id: number; name: string; category: string; price: number; points: number; artRef?: string | null }>;
  readonly gridW: number;
  readonly gridH: number;

  constructor(dataDir: string) {
    const L = <T>(rel: string, fb: T): T => {
      try { return JSON.parse(readFileSync(join(dataDir, rel), 'utf8')) as T; } catch { return fb; }
    };
    this.farm = L<FarmDef | null>('village-farm.json', null);
    this.spawns = L<SpawnDef | null>('spawn-points.json', null);
    const items = L<unknown>('items.json', {});
    this.items = Array.isArray(items) ? items as ItemDef[] : [];
    const npcs = L<unknown>('npcs.json', []);
    this.npcs = Array.isArray(npcs) ? npcs as NpcDef[] : [];
    this.collision = L<CollisionDef | null>('village-collision.json', null);
    this.gridW = (this.collision && this.collision.width) || 105;
    this.gridH = (this.collision && this.collision.height) || 89;
    this.mineSpots = L<MineSpot[] | null>('mine-spots.json', null) || [];
    const rawRecipes = L<RecipeRow[] | null>('recipes.json', null) || [];
    this.recipes = rawRecipes.map(r => ({
      id: r.id, facility: r.facility, name: r.name,
      inputs: Object.fromEntries(Object.entries(r.inputs || {}).map(([k, v]) => [Number(k), Number(v)])),
      output: r.output,
    }));
    this.decor = L<Array<{ id: number; name: string; category: string; price: number; points: number; artRef?: string | null }> | null>('decor.json', null) || [];
  }

  nameOf(id: number): string {
    const it = this.items.find(x => x.id === id);
    return it ? (it.name ?? '道具' + id) : '道具' + id;
  }

  cropOf(plantId: number): CropDef | null {
    return CROP_BY_PLANT_ID.get(plantId) || null;
  }

  /** 原版存档格 -> 世界格 偏移（扩展 14 格） */
  mapOffset(): number {
    return (this.farm && this.farm.LEFT) || 14;
  }
}

/** 加权随机（鱼/矿池） */
export function pickWeighted(pool: Array<[number, number]>): number {
  let total = 0;
  for (const [, w] of pool) total += w;
  let r = Math.random() * total;
  for (const [id, w] of pool) { r -= w; if (r <= 0) return id; }
  return pool[pool.length - 1][0];
}
