// world/schedule.ts —— B7 NPC 日程系统（design M3.4）
// 每 NPC 一张 {hour -> activity, target} 日程（确定性由 npc.id 派生），调度器按游戏时间驱动：
// 节日 -> 集市聚集、雨天/风暴 -> 室内（家门口）、夜晚 -> 归家；其余按时段活动。
// NPC 位置是 (npcId, day, hour, weather, festival) 的纯函数 -> 无需持久化，重启可重算；
// 广播 npc_move 供 mod 层复用"其他玩家"渲染管线（设计 M3.4）。
import type { App } from '../app.ts';
import type { WorldState } from '../persistence/state.ts';
import type { NpcDef } from '../types.ts';
import { currentGameDay, calendarDay, type Weather } from './calendar.ts';
import { log } from '../logging.ts';

export interface NpcPois {
  villageCenter: { x: number; y: number };
  riverside: { x: number; y: number };
  mine: { x: number; y: number } | null;
  doors: Array<{ x: number; y: number; house: number }>;
  scene: number;
}

export interface NpcDecision {
  npc: number;
  activity: string;
  scene: number;
  x: number;
  y: number;
  reason: string;
}

// 游戏时间：日 + 时（时由 growDayMs 折算 24 小时制）
export function gameHourOf(state: WorldState, now = Date.now()): { day: number; hour: number } {
  const day = currentGameDay(state, now);
  const gday = state.growDayMsValue();
  const frac = ((now - Number((state.globals.get('afDayAnchor') as { val?: number } | undefined)?.val ?? now)) % gday + gday) % gday;
  return { day, hour: Math.min(23, Math.floor(frac / gday * 24)) };
}

function hash01(n: number): number {
  let h = Math.imul(n + 0x9e3779b9, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return ((h >>> 8) % 10000) / 10000;
}

/** NPC 常驻场景（appear_rule type=3 兜底项；缺省村景 2） */
export function npcHomeScene(npc: NpcDef): number {
  for (const r of (npc.appear_rule as unknown as unknown[][]) || []) {
    if (r && r[0] === 3 && typeof r[2] === 'number') return r[2] > 1000 ? 2 : r[2];
  }
  return 2;
}

/** 纯日程决策：天气/节日覆盖 > 时段活动 > 归家 */
export function npcDecision(npc: NpcDef, ctx: { day: number; hour: number; weather: Weather; festival: string | null }, pois: NpcPois): NpcDecision {
  const base = { npc: npc.id, scene: pois.scene };
  // 家：按 npc.id 轮转分配门位（确定性）
  const door = pois.doors.length ? pois.doors[npc.id % pois.doors.length] : null;
  const home = (): NpcDecision => ({
    ...base, activity: '在家中', x: door ? door.x : pois.villageCenter.x, y: door ? door.y : pois.villageCenter.y,
    reason: `家门${door ? `（宅${door.house}）` : ''}`,
  });

  // 1) 天气/节日覆盖（最高优先级）
  if (ctx.weather === 'storm') return { ...home(), activity: '风暴避险', reason: '风暴日全员居家' };
  if (ctx.festival && ctx.hour >= 10 && ctx.hour < 20) {
    return { ...base, activity: `节日：${ctx.festival}`, x: pois.villageCenter.x, y: pois.villageCenter.y, reason: '节日集市聚集' };
  }
  if (ctx.weather === 'rain') return { ...home(), activity: '雨天室内', reason: '雨天居家' };

  // 2) 时段活动（偶数 NPC 常去河边，奇数常去村中心；矿点给 4 的倍数）
  const h = ctx.hour;
  const evenside = npc.id % 2 === 0;
  const workSpot = npc.id % 4 === 0 && pois.mine ? pois.mine : evenside ? pois.riverside : pois.villageCenter;
  if (h >= 0 && h < 6) return { ...home(), activity: '睡觉', reason: '深夜归家' };
  if (h >= 6 && h < 9) return { ...base, activity: '村口晨间问好', x: pois.villageCenter.x, y: pois.villageCenter.y, reason: '晨间时段' };
  if (h >= 9 && h < 12) return home(); // 上午在家工作
  if (h >= 12 && h < 13) return { ...base, activity: '村中心午餐', x: pois.villageCenter.x, y: pois.villageCenter.y, reason: '午间' };
  if (h >= 13 && h < 18) return { ...base, activity: '劳作', x: workSpot.x, y: workSpot.y, reason: '下午劳作时段' };
  if (h >= 18 && h < 21) return { ...base, activity: '河边傍晚闲逛', x: pois.riverside.x, y: pois.riverside.y, reason: '傍晚时段' };
  return home(); // 21-23 归家
}

/** 村景 POI（村中心/河边/矿点/家门；由数据表确定性派生） */
export function villagePois(app: App): NpcPois {
  const T = app.tables;
  const w = T.gridW, h = T.gridH;
  const water = T.farm?.water;
  let river = { x: (w / 2) * 100, y: (h / 2) * 100 };
  if (water && water.length) {
    for (let i = 0; i < water.length; i++) {
      if (water[i] === 1) { river = { x: (i % T.farm!.waterW) * 100 + 50, y: Math.floor(i / T.farm!.waterW) * 100 + 50 }; break; }
    }
  }
  const mines = T.mineSpots;
  const doors = (app.stateOpts?.spawns?.houses || []).map(hd => ({ x: hd.door.x, y: hd.door.y, house: hd.id }));
  return {
    scene: 2,
    villageCenter: { x: Math.floor(w / 2) * 100 + 50, y: Math.floor(h / 2) * 100 + 50 },
    riverside: river,
    mine: mines && mines.length ? { x: mines[0].gx * 100 + 50, y: mines[0].gy * 100 + 50 } : null,
    doors,
  };
}

/** 调度器：全部 NPC 决策 -> 变化才广播 + 事件（幂等：同位置不重发） */
export function runNpcSchedules(app: App, now = Date.now()): number {
  const state = app.state;
  const { day, hour } = gameHourOf(state, now);
  const cal = calendarDay(day);
  const pois = villagePois(app);
  const last = state.npcSched;
  let changed = 0;
  for (const npc of app.tables.npcs) {
    const d = npcDecision(npc, { day, hour, weather: cal.weather, festival: cal.festival }, pois);
    const prev = last.get(String(npc.id));
    if (prev && prev.x === d.x && prev.y === d.y && prev.scene === d.scene) continue;
    last.set(String(npc.id), { x: d.x, y: d.y, scene: d.scene, activity: d.activity });
    // 广播给在线玩家（mod 层复用其他玩家渲染管线）
    for (const [, p] of state.online) {
      try { p.ws.send(JSON.stringify({ t: 'npc_move', npc: { id: npc.id, name: npc.name, scene: d.scene, x: d.x, y: d.y, activity: d.activity, hour } })); } catch { /* ignore */ }
    }
    app.log.append('npc.schedule', null, { npc: npc.id, activity: d.activity, scene: d.scene, x: d.x, y: d.y, day, hour, weather: cal.weather, festival: cal.festival });
    changed++;
  }
  if (changed > 0 && process.env.AF_DEBUG) log.write('info', 'npc', `NPC 日程调度：${changed} 家换位（日${day} ${hour}时 ${cal.weather}）`);
  return changed;
}
