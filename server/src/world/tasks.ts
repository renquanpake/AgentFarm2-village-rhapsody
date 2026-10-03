// world/tasks.ts —— 玩家任务系统（N9 任务链 + 旧扁平任务回落）
//
// 事故背景：任务是 10 条无先后关系的孤立项（audit 结论「新手第一天可玩完全部内容」），
// 且 give/bind 两条任务对 Agent 恒不可完成（动作只在 /ws 人类通道）。现在：
//   1. 主数据源 data/task-chains.json：6 条链 31 阶，天数解锁、逐阶奖励（对齐 economy-tables）
//   2. 进度存在玩家私有桶 afTasks.chains（list/done 保留兼容旧档）
//   3. 任务视图 taskView() 是唯一出口 —— observe.tasks 与 act tasks 共用，保证文本通道一致
import type { WorldState } from '../persistence/state.ts';
import type { Tables } from './tables.ts';
import { knapAdd } from './farm.ts';

export interface TaskDef {
  id: string;
  name: string;
  type: string;
  count: number;
  reward: { id: number; num: number } | null;
  desc: string;
}

/** 回落任务（data/task-chains.json 缺失时用，保证隔离环境/单测仍可跑） */
export const TASK_DEFS: TaskDef[] = [
  { id: 'task1', name: '和玩家聊一次天', type: 'talk', count: 1, reward: { id: 1, num: 50 }, desc: '对附近玩家发起一次对话' },
  { id: 'task2', name: '给玩家送一次礼', type: 'give', count: 1, reward: { id: 1, num: 80 }, desc: '给附近的玩家送一件物品' },
  { id: 'task3', name: '好感达到 30', type: 'fav', count: 30, reward: { id: 1, num: 120 }, desc: '让某位玩家对你的好感 ≥ 30' },
  { id: 'task4', name: '种 3 块地', type: 'plant', count: 3, reward: { id: 28, num: 2 }, desc: '种下 3 颗种子（小麦/玉米/土豆…）' },
  { id: 'task5', name: '收获 2 个作物', type: 'harvest', count: 2, reward: { id: 1, num: 100 }, desc: '收获 2 个成熟的作物' },
  { id: 'task6', name: '钓 1 条鱼', type: 'fish', count: 1, reward: { id: 1, num: 60 }, desc: '在水边钓一条鱼' },
  { id: 'task7', name: '砍 3 棵树', type: 'chop', count: 3, reward: { id: 18, num: 3 }, desc: '砍倒 3 棵树（得木材）' },
  { id: 'task8', name: '建立好友关系', type: 'bind', count: 1, reward: { id: 1, num: 150 }, desc: '和一位玩家结为「好友」（好感 30 后 act bind）' },
  { id: 'task9', name: '犁 3 块地', type: 'till', count: 3, reward: { id: 1, num: 60 }, desc: '犁 3 块可耕种土地（准备播种）' },
  { id: 'task10', name: '浇 3 次水', type: 'water', count: 3, reward: { id: 1, num: 70 }, desc: '给作物浇水 3 次，促进生长' },
];

// ---------- 任务链数据（data/task-chains.json） ----------
export interface ChainStage {
  id: string;
  name: string;
  type: string;
  count: number;
  desc: string;
  reward: { id: number; num: number } | null;
  stage?: number;
  rewardCoins?: number;
}
export interface TaskChain {
  id: string;
  name: string;
  chapter: number;
  unlockDay: number;
  theme?: string;
  /** 链内严格顺序：只有当前活跃阶（第一个未完成阶）计数，实现「一环扣一环」 */
  strict?: boolean;
  /** 前置链门槛：某链完成阶数达标才解锁（环环相扣的链间依赖） */
  requiresChain?: { id: string; minDone: number };
  stages: ChainStage[];
}
export interface TaskChainDoc {
  version: number;
  chains: TaskChain[];
  rewardCurve?: { base?: number; stepPerChain?: number };
}

/** 从 Tables 读任务链（Tables 已加载 data/task-chains.json） */
export function chainsOf(tables: Tables): TaskChain[] {
  const doc = (tables as unknown as { taskChains?: TaskChainDoc | null }).taskChains;
  if (!doc || !Array.isArray(doc.chains) || !doc.chains.length) return [];
  return doc.chains.filter(c => Array.isArray(c.stages) && c.stages.length);
}

// ---------- 进度状态（玩家私有桶 afTasks） ----------
export interface AfTasks {
  list: Record<string, { cur: number; total: number }>;   // 旧扁平任务（兼容旧档/回落模式）
  done: Record<string, boolean>;
  chains?: Record<string, { doneStages: string[]; claimed: string[] }>; // 链进度：doneStages 完成、claimed 已发奖
}

function emptyChainState(): AfTasks['chains'] {
  return {};
}

export function tasksOf(state: WorldState, uid: string): AfTasks {
  const pm = state.playersDb.get(uid) || state.playersDb.get('u' + uid);
  let t = (pm && pm.get('afTasks')) as AfTasks | undefined;
  if (!t || !t.list) {
    t = { list: {}, done: {} };
    for (const d of TASK_DEFS) t.list[d.id] = { cur: 0, total: d.count };
    if (pm) { pm.set('afTasks', t); state.schedulePersist(); }
  }
  if (!t.chains) t.chains = emptyChainState();
  return t;
}

/** 某玩家当前游戏日（playerData.day，缺 1） */
export function playerDay(state: WorldState, uid: string): number {
  const pd = state.playersDb.get(uid)?.get('playerData') as { day?: number } | undefined;
  const d = Number(pd?.day);
  return Number.isFinite(d) && d > 0 ? d : 1;
}

/** 链是否过天数门槛（基础判定，不含链间依赖） */
export function chainUnlocked(chain: TaskChain, day: number): boolean {
  return day >= (chain.unlockDay || 1);
}

/**
 * 链锁定原因（null=可玩）。天数门槛 + requiresChain 链间依赖，文本无障碍：原因必须可读。
 * doneOf：取某链 id 的已完成阶数。
 */
export function chainLockReason(chain: TaskChain, day: number, doneOf: (chainId: string) => number, chainName: (chainId: string) => string): string | null {
  if (day < (chain.unlockDay || 1)) return `第 ${chain.unlockDay} 天解锁（今天第 ${day} 天）`;
  const req = chain.requiresChain;
  if (req) {
    const fin = doneOf(req.id);
    if (fin < req.minDone) return `前置链「${chainName(req.id)}」需完成 ${req.minDone} 阶（当前 ${fin} 阶）——一环扣一环，先把上一环做完`;
  }
  return null;
}

export interface ChainView {
  id: string;
  name: string;
  chapter: number;
  theme?: string;
  unlocked: boolean;
  unlockDay: number;
  total: number;
  finished: number;
  stages: Array<{ id: string; name: string; type: string; cur: number; total: number; done: boolean; desc: string; reward: { id: string; num: number } | null; rewardName: string }>;
  next: string | null; // 文本指引：下一步做什么
}

export interface TaskView {
  mode: 'chains' | 'legacy';
  chains: ChainView[];
  legacy: Array<{ id: string; name: string; cur: number; total: number; done: boolean }> | null;
  summary: string;
}

/** 任务视图（唯一出口）：observe.tasks / act tasks 共用 */
export function taskView(state: WorldState, tables: Tables, uid: string): TaskView {
  const t = tasksOf(state, uid);
  const day = playerDay(state, uid);
  const chains = chainsOf(tables);
  if (!chains.length) {
    const legacy = TASK_DEFS.map(d => {
      const it = t.list[d.id] || { cur: 0, total: d.count };
      return { id: d.id, name: d.name, cur: it.cur, total: it.total, done: !!t.done[d.id] };
    });
    const doneN = legacy.filter(x => x.done).length;
    return { mode: 'legacy', chains: [], legacy, summary: `任务 ${doneN}/${legacy.length}（旧扁平任务表：data/task-chains.json 缺失）` };
  }
  const views: ChainView[] = [];
  const doneOf = (cid: string) => t.chains?.[cid]?.doneStages.length ?? 0;
  const chainName = (cid: string) => chains.find(c => c.id === cid)?.name ?? cid;
  for (const c of chains) {
    const lock = chainLockReason(c, day, doneOf, chainName);
    const unlocked = !lock;
    const st = t.chains?.[c.id] || { doneStages: [], claimed: [] };
    const stages = c.stages.map((s) => {
      const done = st.doneStages.includes(s.id);
      const cur = done ? s.count : Math.min(s.count, progressOf(t, s));
      return {
        id: s.id, name: s.name, type: s.type, cur, total: s.count, done, desc: s.desc,
        reward: s.reward ? { id: String(s.reward.id), num: s.reward.num } : null,
        rewardName: s.reward ? `${tables.nameOf(s.reward.id)}×${s.reward.num}` : '',
      };
    });
    const finished = stages.filter(s => s.done).length;
    const nextStage = stages.find(s => !s.done);
    views.push({
      id: c.id, name: c.name, chapter: c.chapter, theme: c.theme,
      unlocked, unlockDay: c.unlockDay, total: stages.length, finished, stages,
      next: unlocked
        ? (nextStage ? `${nextStage.name}（${nextStage.desc}）` : '本链已全部完成')
        : (lock ?? `第 ${c.unlockDay} 天解锁（今天第 ${day} 天）`),
    });
  }
  const totalStages = views.reduce((s, v) => s + v.total, 0);
  const doneStages = views.reduce((s, v) => s + v.finished, 0);
  return { mode: 'chains', chains: views, legacy: null, summary: `任务链进度 ${doneStages}/${totalStages} 阶（第 ${day} 天）` };
}

/** 阶段计数存哪：claims 型任务（fav 等）无天然增量源，用 list 兼容位承载 */
function progressOf(t: AfTasks, s: ChainStage): number {
  const slot = `chain:${s.id}`;
  return t.list[slot]?.cur ?? 0;
}

function bumpProgress(t: AfTasks, s: ChainStage, n: number): number {
  const slot = `chain:${s.id}`;
  const cur = Math.min(s.count, (t.list[slot]?.cur ?? 0) + n);
  t.list[slot] = { cur, total: s.count };
  return cur;
}

/** 任务进度 +1（完成时发奖励进背包并推 task_done）；任务链与旧扁平任务同时推进 */
export function taskCount(state: WorldState, tables: Tables, uid: string, type: string, n = 1): void {
  try {
    const pm = state.playersDb.get(uid);
    if (!pm) return;
    const t = tasksOf(state, uid);
    const day = playerDay(state, uid);
    let changed = false;
    const msgs: string[] = [];

    // 旧扁平任务（回落模式或兼容旧档）
    let completed: string | null = null;
    for (const d of TASK_DEFS) {
      if (d.type !== type || t.done[d.id]) continue;
      const it = t.list[d.id] || { cur: 0, total: d.count };
      it.cur = Math.min(it.total, it.cur + n);
      t.list[d.id] = it;
      if (it.cur >= it.total) {
        t.done[d.id] = true;
        if (d.reward && d.reward.id) {
          knapAdd(pm, d.reward.id, d.reward.num || 1);
          completed = `任务完成「${d.name}」，奖励 ${tables.nameOf(d.reward.id)}×${d.reward.num}（已放入背包）`;
        } else completed = `任务完成「${d.name}」`;
      }
      changed = true;
    }

    // 任务链：同 type 的已解锁未完成阶段推进；strict 链只推当前活跃阶（一环扣一环）
    for (const c of chainsOf(tables)) {
      const lock = chainLockReason(c, day, (cid) => t.chains?.[cid]?.doneStages.length ?? 0, (cid) => chainsOf(tables).find(x => x.id === cid)?.name ?? cid);
      if (lock) continue;
      const st = t.chains![c.id] || (t.chains![c.id] = { doneStages: [], claimed: [] });
      const active = c.strict ? c.stages.find(s => !st.doneStages.includes(s.id)) : null;
      for (const s of c.stages) {
        if (s.type !== type || st.doneStages.includes(s.id)) continue;
        if (active && s.id !== active.id) continue; // 严格顺序：非活跃阶不计数
        const cur = bumpProgress(t, s, n);
        if (cur >= s.count) {
          st.doneStages.push(s.id);
          // 奖励发放（同源去重：金币=物品 id 1，旧档 reward:{id:1} 与 rewardCoins 是同一份，只发一次）
          const coinReward = s.rewardCoins ?? (s.reward?.id === 1 ? s.reward.num : 0);
          const itemReward = s.reward && s.reward.id !== 1 ? s.reward : null;
          const rewardParts: string[] = [];
          if (itemReward && !st.claimed.includes(s.id)) {
            knapAdd(pm, itemReward.id, itemReward.num || 1);
            st.claimed.push(s.id);
            rewardParts.push(`${tables.nameOf(itemReward.id)}×${itemReward.num}`);
          }
          if (coinReward && !st.claimed.includes(s.id + ':coins')) {
            knapAdd(pm, 1, coinReward);
            st.claimed.push(s.id + ':coins');
            rewardParts.push(`金币×${coinReward}`);
          }
          msgs.push(`任务链「${c.name}」「${s.name}」完成${rewardParts.length ? '，奖励 ' + rewardParts.join(' + ') : ''}`);
        }
        changed = true;
      }
    }

    if (changed) { pm.set('afTasks', t); state.schedulePersist(); }
    const p = state.online.get(uid);
    if (p && p.ws.readyState === 1) {
      for (const m of [...msgs, ...(completed ? [completed] : [])]) p.ws.send(JSON.stringify({ t: 'task_done', msg: m }));
    }
    for (const m of msgs) console.log(`[task] ${uid} ${m}`);
  } catch (e) {
    console.warn('[task] count err:', (e as Error).message);
  }
}

export function taskRewardName(tables: Tables, id: number): string {
  const it = tables.items.find(x => x.id === id);
  return it ? (it.name ?? '物品' + id) : '物品' + id;
}