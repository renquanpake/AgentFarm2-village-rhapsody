// tasks.ts —— 任务书引擎（C6 condition 1~9）：事件计数 → 条件检查 → 完成/解锁下一环
import type { World, Actor } from './world.ts';
import { data } from './config.ts';

export function onUseTool(w: World, a: Actor, toolId: number) {
  a.stats.useTool[String(toolId)] = (a.stats.useTool[String(toolId)] || 0) + 1;
  checkTasks(w, a);
}
export function onPlant(w: World, a: Actor) {
  a.stats.plant++;
  bump(w, a, '2002'); // 种下种子
  checkTasks(w, a);
}
export function onHarvest(w: World, a: Actor) {
  bump(w, a, 'harvest');
  checkTasks(w, a);
}
export function onCount(w: World, a: Actor, key: string) {
  bump(w, a, key);
  checkTasks(w, a);
}
export function onTalk(w: World, a: Actor) {
  a.stats.talk++;
  checkTasks(w, a);
}
export function onRelation(w: World, a: Actor) {
  checkTasks(w, a);
}
/** 洒水器自动浇灌计数 / 仓库计数 / 耕地计数等 */
export function onSowCount(w: World, a: Actor, count: number) {
  bump(w, a, '20204', count); bump(w, a, '20402', count);
  checkTasks(w, a);
}
export function onFieldCount(w: World, a: Actor, count: number) {
  bump(w, a, '20303', count);
  checkTasks(w, a);
}
export function onBuild(w: World, a: Actor, facId: number) {
  if (facId === 1001) bump(w, a, '20201');
  if (facId === 1002) bump(w, a, '20302');
  if (facId === 1001 && a.sceneId === 2) bump(w, a, '20401'); // 社区熔炉(村庄)
  checkTasks(w, a);
}
export function onHelp(w: World, a: Actor) {
  bump(w, a, '20403');
  checkTasks(w, a);
}
export function onEat(w: World, a: Actor) {
  bump(w, a, '2004');
  checkTasks(w, a);
}
function bump(w: World, a: Actor, key: string, n = 1) {
  a.counters[key] = (a.counters[key] || 0) + n;
}

export function acceptTask(w: World, a: Actor, id: string) {
  if (!a.tasks.accepted.includes(id) && !a.tasks.completed.includes(id)) {
    a.tasks.accepted.push(id);
    const t = data.tasks.tasks[id];
    if (t) w.broadcast?.({ type: 'toast', text: `📖 新任务：${t.name}（${t.desc}）` });
  }
}

export function checkTasks(w: World, a: Actor) {
  for (const [id, t] of Object.entries(data.tasks.tasks)) {
    if (a.tasks.completed.includes(id)) continue;
    if (!a.tasks.accepted.includes(id)) continue;
    if (condOK(w, a, t.condition)) complete(w, a, id, t);
  }
}

function complete(w: World, a: Actor, id: string, t: any) {
  a.tasks.completed.push(id);
  for (const [kind, val, num] of t.complete_reward || []) {
    if (kind === 1) a.gold += val;
    else a.items[String(kind)] = (a.items[String(kind)] || 0) + (num || 1);
  }
  w.broadcast?.({ type: 'toast', text: `✅ 任务完成：${t.name}，奖励已发放` });
  if (t.next) {
    acceptTask(w, a, String(t.next));
  }
  checkTasks(w, a);
}

function condOK(w: World, a: Actor, cond: any[][]): boolean {
  for (const [type, p1, p2] of cond || []) {
    switch (type) {
      case 1: if ((a.items[String(p1)] || 0) < p2) return false; break;                          // 拥有道具
      case 2: if (a.stats.talk < p2) return false; break;                                        // 对话次数
      case 3: if (!a.tasks.completed.includes(String(p1))) return false; break;                  // 前置任务
      case 4: if ((a.stats.useTool[String(p1)] || 0) < p2) return false; break;                  // 工具使用次数
      case 5: if (w.day < p2) return false; break;                                               // 天数
      case 6: if (a.sceneId !== p1) return false; break;                                         // 场景到达
      case 7: if ((a.counters[String(p1)] || 0) < p2) return false; break;                       // 特定条件
      case 8: { const mx = Object.values(a.relations).reduce((s, v) => Math.max(s, v), 0); if (mx < p1) return false; break; } // 好感度
      case 9: if (!a.tasks.completed.includes(String(p1))) return false; break;                  // 里程碑
    }
  }
  return true;
}

/** 新玩家初始任务链：第一章第一个任务 */
export function acceptFirst(w: World, a: Actor) {
  const first = Object.values<any>(data.tasks.tasks).find(t => t.chapter === 1) || data.tasks.tasks[Object.keys(data.tasks.tasks)[0]];
  if (first) acceptTask(w, a, String(first.id));
}