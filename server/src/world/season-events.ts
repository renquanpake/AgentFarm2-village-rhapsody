// world/season-events.ts —— N9 季节事件线（每季 3 个事件，按游戏日 + 天气触发）
//
// 事故背景：全年只有「每季最后一天一个节日」，其余 30 个游戏日完全同质 ——
// 内容侧的实况是「新手第一天可玩完全部内容」。现在每季有主线 + 两条支线，
// 触发后同时进三个面（设计铁律 T1：任何玩家可见信息必须有文本等价通道）：
//   1. 公告 noticeData（/af/notices + observe.notices）
//   2. 八卦池 gossipData（NPC 对话 LLM 的 system 素材，世界有事可说）
//   3. observe.seasonEvents（Agent/LLM 直接读）
import type { WorldState } from '../persistence/state.ts';
import type { Tables } from './tables.ts';
import { publishNotice } from './notices.ts';
import { recordGossip } from './gossip.ts';
import { calendarDay, type Weather } from './calendar.ts';

export interface SeasonEventDef {
  id: string;
  season: string;
  title: string;
  dayFrom: number;
  dayTo: number;
  weather: Weather | null;
  desc: string;
  gossip?: string;
  effect?: string;
  bonus?: Record<string, unknown>;
}

export interface SeasonEventDoc {
  version: number;
  seasons?: string[];
  gameDayPerSeason?: number;
  events?: SeasonEventDef[];
}

export function seasonEventsOf(tables: Tables): SeasonEventDef[] {
  const doc = (tables as unknown as { seasonEvents?: SeasonEventDoc | null }).seasonEvents;
  return doc && Array.isArray(doc.events) ? doc.events : [];
}

/** 某游戏日应当活跃的事件（纯函数：可回放、可单测） */
export function activeSeasonEvents(tables: Tables, day: number, weather: Weather | null): SeasonEventDef[] {
  const info = calendarDay(day);
  const season = info.season;
  const inSeasonDay = seasonDayIndex(day);
  return seasonEventsOf(tables).filter(e => {
    if (e.season !== season) return false;
    if (inSeasonDay < e.dayFrom || inSeasonDay > e.dayTo) return false;
    if (e.weather && weather && e.weather !== weather) return false;
    return true;
  });
}

/** 季内第几天（1..10）：历法每季 10 个游戏日（calendar.ts SEASON_DAYS） */
export function seasonDayIndex(day: number): number {
  return (((day - 1) % 10) + 10) % 10 + 1;
}

/** 文本面：当前活跃事件 + 本季剩余预告（observe.seasonEvents） */
export function seasonEventsView(tables: Tables, day: number, weather: Weather | null): { active: Array<{ id: string; title: string; desc: string; hint: string }>; upcoming: Array<{ id: string; title: string; day: string }>; note: string } | null {
  const active = activeSeasonEvents(tables, day, weather);
  const all = seasonEventsOf(tables);
  if (!all.length) return null;
  const cur = calendarDay(day);
  const nowId = new Set(active.map(e => e.id));
  const upcoming = all
    .filter(e => e.season === cur.season && !nowId.has(e.id))
    .slice(0, 3)
    .map(e => ({ id: e.id, title: e.title, day: `第 ${e.dayFrom}-${e.dayTo} 天${e.weather ? `（${e.weather === 'rain' ? '雨' : e.weather === 'snow' ? '雪' : '风暴'}天）` : ''}` }));
  return {
    active: active.map(e => ({ id: e.id, title: e.title, desc: e.desc, hint: '事件已在公告与 NPC 谈资中出现' })),
    upcoming,
    note: `第 ${day} 天 · ${cur.season}季 · 事件线来自 data/season-events.json`,
  };
}

/**
 * 日推进钩子：进入某天时触发该天的事件（同一天只触发一次，幂等键记在 noticeData 旁的全局桶）。
 * 由历法推进器（calendar.ts 的 tick）调用。
 */
export function triggerSeasonEvents(state: WorldState, tables: Tables, day: number, weather: Weather | null, tick: number): SeasonEventDef[] {
  const events = activeSeasonEvents(tables, day, weather);
  if (!events.length) return [];
  const KEY = 'afSeasonEventFired';
  let fired: Record<string, number> = (state.world.get(KEY) as Record<string, number> | undefined) || {};
  const out: SeasonEventDef[] = [];
  for (const e of events) {
    // 同一事件一个赛季只触发一次（键 = 事件 id + 季内序号）
    const seasonIndex = Math.floor((day - 1) / 10);
    const key = `${e.id}#${seasonIndex}`;
    if (fired[key]) continue;
    fired[key] = day;
    publishNotice(state, tick, 'generic', `【${e.title}】${e.desc}`);
    if (e.gossip) recordGossip(state, tick, 'season', e.gossip);
    out.push(e);
  }
  state.world.set(KEY, fired);
  return out;
}