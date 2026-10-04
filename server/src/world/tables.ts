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
export const SPRINKLER_RANGE: Record<number, number> = { 1: 3, 2: 5, 3: 7 };

// ---------- N10 经济数值表（data/economy-tables.json；缺文件时回落 DEFAULT_ECONOMY） ----------
export interface EconomyCrop {
  seedItemId: number; plantId: number; name: string;
  seedCost: number; growDays: number; cropItemId: number; sellPrice: number;
  roi: number; hourlyAt8Plots: number; seedBuyFromNpc: number;
}
export interface EconomyTable {
  version: number;
  updated?: string;
  basePrice?: Record<string, number>;
  policy?: { seedPriceMul?: number; priceOrder?: string[]; hourlyModel?: Record<string, unknown> };
  crops?: EconomyCrop[];
  gather?: Record<string, Record<string, unknown>>;
  fees?: Record<string, unknown>;
  inflationTarget?: { bandLow: number; bandHigh: number; warn: number; critical: number; note?: string };
  taskReward?: { base?: number; stepPerChain?: number };
}
export const DEFAULT_ECONOMY: EconomyTable = {
  version: 0,
  basePrice: {},
  policy: { seedPriceMul: 1 },
  crops: [],
  inflationTarget: { bandLow: 0.95, bandHigh: 1.15, warn: 1.3, critical: 1.5 },
};

export class Tables {
  farm: FarmDef | null;
  spawns: SpawnDef | null;
  items: ItemDef[];
  npcs: NpcDef[];
  collision: CollisionDef | null;
  mineSpots: MineSpot[];
  recipes: Array<{ id: number; facility: string; name: string; inputs: Record<number, number>; output: { itemId: number; qty: number } }>;
  decor: Array<{ id: number; name: string; category: string; price: number; points: number; artRef?: string | null }>;
  /** N10 经济数值表 */
  economy: EconomyTable;
  /** N9 任务链文档（world/tasks.ts 消费；null = 回落旧扁平任务） */
  taskChains: { version: number; chains: unknown[] } | null;
  /** 数据目录（P4 tutorial.json 等「按需读取的数据表」用 readJson；勿在构造器外散落 readFileSync） */
  readonly dataDir: string;
  /** N9 季节事件线文档（world/season-events.ts 消费） */
  seasonEvents: { version: number; events: unknown[] } | null;
  /** N9 新手引导文档（world/onboarding.ts 消费） */
  onboarding: { version: number; steps: unknown[] } | null;
  readonly gridW: number;
  readonly gridH: number;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
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
    // N10 经济数值表（唯一设计源）：做市基价覆盖 / 种子折扣 / 作物 ROI / 通胀目标带
    this.economy = L<EconomyTable | null>('economy-tables.json', null) || DEFAULT_ECONOMY;
    // N9 内容扩容：任务链（有序阶段 + 天数解锁 + 逐阶奖励）
    this.taskChains = L<{ version: number; chains: unknown[] } | null>('task-chains.json', null);
    // N9：季节事件线（每季的故事线 + 触发条件）
    this.seasonEvents = L<{ version: number; events: unknown[] } | null>('season-events.json', null);
    // N9：第一小时引导（新手前 60 分钟逐环节）
    this.onboarding = L<{ version: number; steps: unknown[] } | null>('onboarding.json', null);
  }

  /**
   * 市场做市基价（N10 口径）：
   * economy-tables.basePrice 覆盖 -> items.sell_price x 2（NPC 口径）-> 回退 50。
   * 旧实现只走后两步且回退值硬编码在 service.ts，数值无处可查。
   */
  basePriceOf(itemId: number): number {
    const override = this.economy?.basePrice?.[String(itemId)];
    if (typeof override === 'number' && override > 0) return Math.round(override);
    const it = this.items.find(x => x.id === itemId);
    const npc = it && typeof it.sell_price === 'number' ? it.sell_price * 2 : 0;
    return npc > 0 ? npc : 50;
  }

  /** NPC 收购/出售基准（items.sell_price x 2，种子类按 N10 折扣） */
  npcUnitPrice(itemId: number): number {
    const it = this.items.find(x => x.id === itemId);
    if (!it || typeof it.sell_price !== 'number' || it.sell_price <= 0) return 0;
    const raw = it.sell_price * 2;
    const mul = it.type === 4 ? (this.economy?.policy?.seedPriceMul ?? DEFAULT_ECONOMY.policy!.seedPriceMul!) : 1; // type=4 种子
    return Math.max(1, Math.round(raw * mul));
  }

  /** 作物设计行（N10：ROI/日产能基准） */
  cropEconomy(cropItemId: number): EconomyCrop | null {
    return (this.economy?.crops || []).find(c => c.cropItemId === cropItemId) || null;
  }

  /** 按需读取数据表（如 data/tutorial.json）；读不到回落 fb（表损坏不炸服） */
  readJson<T>(rel: string, fb: T): T {
    try { return JSON.parse(readFileSync(join(this.dataDir, rel), 'utf8')) as T; } catch { return fb; }
  }

  /** 通胀目标带（N10：/af/economy-design 对账用） */
  inflationTarget(): { bandLow: number; bandHigh: number; warn: number; critical: number } {
    const t = this.economy?.inflationTarget;
    return {
      bandLow: t?.bandLow ?? 0.95, bandHigh: t?.bandHigh ?? 1.15,
      warn: t?.warn ?? 1.3, critical: t?.critical ?? 1.5,
    };
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
