// world/craft.ts —— 加工链（M13 artisan 加工）
//
// 设计（学习自 Stardew 小桶/腌制罐/厨房 + 「深度 2 是甜点」原则）：
//   作物 x N + 真实时间 T -> 金币溢价（artisan 3x basePrice 折算）+ 任务进度。
//   物品 id 体系封闭（items.json 固定），加工产出直接结算金币（溢价 = 3x 基价），
//   避免新增物品 id 断原版渲染；配方表是纯数据，回放确定性由 readyAt 时间戳保证。
//   队列存 world.craftData（世界桶共享？不——玩家私有桶 afCraft.jobs，防互相偷）。
//   上限：每人 4 个并行 job；收取时校验 readyAt <= now，未熟给剩余秒数。
import type { WorldState } from '../persistence/state.ts';
import { knapHas, knapSub, knapAdd } from './farm.ts';
import type { Tables } from './tables.ts';

export interface CraftRecipe {
  id: string;
  name: string;
  /** 投入：itemId -> 数量 */
  inputs: Record<number, number>;
  /** 加工耗时（真实毫秒） */
  ms: number;
  /** 溢价倍率（对投入作物 basePrice 总和） */
  mul: number;
}

/** AF 加工配方表（纯数据；作物 id 来自 tables.PLANT_CROPS 的 cropItemId） */
export const CRAFT_RECIPES: CraftRecipe[] = [
  { id: 'flour',    name: '石磨面粉', inputs: { 28: 5 },               ms: 120_000, mul: 3 },   // 小麦x5 -> 2min
  { id: 'popcorn',  name: '焦糖爆米花', inputs: { 29: 5 },             ms: 180_000, mul: 3 },   // 玉米x5 -> 3min
  { id: 'mash',     name: '土豆泥',   inputs: { 30: 5 },               ms: 120_000, mul: 3 },   // 土豆x5 -> 2min
  { id: 'bouquet',  name: '兰花花束', inputs: { 31: 3, 32: 2 },         ms: 300_000, mul: 3.5 }, // 兰花x3+黄菊x2 -> 5min
  { id: 'herb-tea', name: '草药茶',   inputs: { 53: 5 },               ms: 240_000, mul: 3 },   // 北美草药x5 -> 4min
  { id: 'carrot',   name: '胡萝卜蛋糕', inputs: { 97: 5, 28: 2 },       ms: 360_000, mul: 3.5 }, // 胡萝卜x5+小麦x2 -> 6min
];

export const MAX_CRAFT_JOBS = 4;

export interface CraftJob {
  jobId: string;
  recipeId: string;
  startedAt: number;
  readyAt: number;
  /** 结算金币（提交时锁定，防基价漂移） */
  payout: number;
}

const CRAFT_KEY = 'afCraft';

function jobsOf(state: WorldState, uid: string): CraftJob[] {
  const pm = state.playersDb.get(uid);
  const j = pm?.get(CRAFT_KEY) as { jobs?: CraftJob[] } | undefined;
  if (!j) return [];
  if (!Array.isArray(j.jobs)) j.jobs = [];
  return j.jobs;
}

/** 提交加工（校验：配方存在 / 材料够 / job 数上限 / 扣材料 / 锁 payout） */
export function craftStart(state: WorldState, tables: Tables, uid: string, recipeId: string): { ok: boolean; msg: string; job?: CraftJob } {
  const r = CRAFT_RECIPES.find(x => x.id === recipeId);
  if (!r) return { ok: false, msg: `没有这个配方（可用：${CRAFT_RECIPES.map(x => x.id).join('/')}）` };
  const pm = state.playersDb.get(uid);
  if (!pm) return { ok: false, msg: '角色数据缺失' };
  const jobs = jobsOf(state, uid);
  if (jobs.length >= MAX_CRAFT_JOBS) return { ok: false, msg: `加工队列已满（最多 ${MAX_CRAFT_JOBS} 个并行）` };
  for (const [itemId, n] of Object.entries(r.inputs)) {
    if (!knapHas(pm, Number(itemId), n)) return { ok: false, msg: `材料不足：${tables.nameOf(Number(itemId))} x${n}` };
  }
  // 扣材料（knapSub 失败是最后防线）
  for (const [itemId, n] of Object.entries(r.inputs)) {
    if (!knapSub(pm, Number(itemId), n)) return { ok: false, msg: '材料不足（并发变动）' };
  }
  // payout 锁定：投入作物 basePrice 总和 x mul
  let base = 0;
  for (const [itemId, n] of Object.entries(r.inputs)) base += tables.basePriceOf(Number(itemId)) * n;
  const payout = Math.round(base * r.mul);
  const now = Date.now();
  const job: CraftJob = { jobId: `${uid}-${now}-${jobs.length}`, recipeId: r.id, startedAt: now, readyAt: now + r.ms, payout };
  jobs.push(job);
  pm.set(CRAFT_KEY, { jobs });
  state.persist();
  return { ok: true, msg: `${r.name} 开始加工（${Math.round(r.ms / 60000)} 分钟，预计收益 ${payout} 金币）`, job };
}

/** 收取（校验 readyAt；未熟返回剩余秒数；熟则删 job + 发金币 + 事件由调用方补） */
export function craftCollect(state: WorldState, uid: string, jobId: string): { ok: boolean; msg: string; payout?: number; recipeId?: string } {
  const pm = state.playersDb.get(uid);
  if (!pm) return { ok: false, msg: '角色数据缺失' };
  const jobs = jobsOf(state, uid);
  const idx = jobs.findIndex(j => j.jobId === jobId);
  if (idx < 0) return { ok: false, msg: '没有这个加工单' };
  const job = jobs[idx];
  const remain = job.readyAt - Date.now();
  if (remain > 0) return { ok: false, msg: `还没好（剩余 ${Math.ceil(remain / 1000)} 秒）` };
  jobs.splice(idx, 1);
  pm.set(CRAFT_KEY, { jobs });
  // 发金币（金币 = 道具 id 1 的堆叠）
  knapAdd(pm, 1, job.payout);
  state.persist();
  const r = CRAFT_RECIPES.find(x => x.id === job.recipeId);
  return { ok: true, msg: `${r?.name || job.recipeId} 完成，+${job.payout} 金币`, payout: job.payout, recipeId: job.recipeId };
}

/** 列表（observe / 面板用） */
export function craftJobsOf(state: WorldState, uid: string): CraftJob[] {
  return jobsOf(state, uid).map(j => ({ ...j }));
}