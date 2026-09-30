// world/tasks.ts —— 玩家任务书（afTasks 私有桶；奖励进背包 + task_done 推送）
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

export const TASK_DEFS: TaskDef[] = [
  { id: 'task1', name: '和玩家聊一次天', type: 'talk', count: 1, reward: { id: 1, num: 50 }, desc: '对附近玩家发起一次对话' },
  { id: 'task2', name: '给玩家送一次礼', type: 'give', count: 1, reward: { id: 1, num: 80 }, desc: '给附近的玩家送一件物品' },
  { id: 'task3', name: '好感达到 30', type: 'fav', count: 30, reward: { id: 1, num: 120 }, desc: '让某位玩家对你的好感 ≥ 30' },
  { id: 'task4', name: '种 3 块地', type: 'plant', count: 3, reward: { id: 28, num: 2 }, desc: '种下 3 颗种子（小麦/玉米/土豆…）' },
  { id: 'task5', name: '收获 2 个作物', type: 'harvest', count: 2, reward: { id: 1, num: 100 }, desc: '收获 2 个成熟的作物' },
  { id: 'task6', name: '钓 1 条鱼', type: 'fish', count: 1, reward: { id: 1, num: 60 }, desc: '在水边钓一条鱼' },
  { id: 'task7', name: '砍 3 棵树', type: 'chop', count: 3, reward: { id: 18, num: 3 }, desc: '砍倒 3 棵树（得木材）' },
  { id: 'task8', name: '建立好友关系', type: 'bind', count: 1, reward: { id: 1, num: 150 }, desc: '和一位玩家结为「好友」（好感 30 后 /bind）' },
  { id: 'task9', name: '犁 3 块地', type: 'till', count: 3, reward: { id: 1, num: 60 }, desc: '犁 3 块可耕种土地（准备播种）' },
  { id: 'task10', name: '浇 3 次水', type: 'water', count: 3, reward: { id: 1, num: 70 }, desc: '给作物浇水 3 次，促进生长' },
];

export interface AfTasks {
  list: Record<string, { cur: number; total: number }>;
  done: Record<string, boolean>;
}

export function tasksOf(state: WorldState, uid: string): AfTasks {
  const pm = state.playersDb.get(uid) || state.playersDb.get('u' + uid);
  let t = (pm && pm.get('afTasks')) as AfTasks | undefined;
  if (!t || !t.list) {
    t = { list: {}, done: {} };
    for (const d of TASK_DEFS) t.list[d.id] = { cur: 0, total: d.count };
    if (pm) { pm.set('afTasks', t); state.schedulePersist(); }
  }
  return t;
}

/** 任务进度 +1（完成时发奖励进背包并推 task_done） */
export function taskCount(state: WorldState, tables: Tables, uid: string, type: string, n = 1): void {
  try {
    const pm = state.playersDb.get(uid);
    if (!pm) return;
    const t = tasksOf(state, uid);
    let changed = false;
    let completed: string | null = null;
    for (const d of TASK_DEFS) {
      if (d.type !== type || t.done[d.id]) continue;
      const it = t.list[d.id];
      it.cur = Math.min(it.total, it.cur + n);
      if (it.cur >= it.total) {
        t.done[d.id] = true;
        const rw = d.reward;
        if (rw && rw.id) {
          knapAdd(pm, rw.id, rw.num || 1);
          const itm = tables.items.find(x => x.id === rw.id);
          const label = itm ? (itm.name ?? '金币') : '金币';
          completed = `✅ 任务完成「${d.name}」，奖励 ${label}×${rw.num}（已放入背包）`;
        } else {
          completed = `✅ 任务完成「${d.name}」`;
        }
      }
      changed = true;
    }
    if (changed) { pm.set('afTasks', t); state.schedulePersist(); }
    if (completed) {
      const p = state.online.get(uid);
      if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'task_done', msg: completed }));
      console.log(`[task] ${uid} 完成: ${completed}`);
    }
  } catch (e) {
    console.warn('[task] count err:', (e as Error).message);
  }
}

export function taskRewardName(tables: Tables, id: number): string {
  const it = tables.items.find(x => x.id === id);
  return it ? (it.name ?? '物品' + id) : '物品' + id;
}
