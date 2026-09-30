// world/calendar.ts —— B8 历法 / 天气 / 季节（design M5a）
// 纯函数：day -> {season, weather, festival}；季节 10 天制，每季 1 场节日；
// 天气：雨=免浇水 1.5x 生长、雪=冬作物白名单 + 减速 0.5x、风暴=20% 露天作物损毁 + 次日保险赔付；
// 全部效应写入事件流（calendar.day / crop.stormDamaged / crop.insurance，供日报/回放）。
import type { WorldState } from '../persistence/state.ts';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Weather = 'clear' | 'rain' | 'snow' | 'storm';

export interface CalendarDay { day: number; season: Season; weather: Weather; festival: string | null; }

export const SEASON_DAYS = 10;
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export const FESTIVALS: Record<Season, string> = {
  spring: '春花会', summer: '夏钓赛', autumn: '秋丰收', winter: '冬雪雕',
};

// 冬季作物白名单（PLANT_CROPS 的 plantId：小麦 1 / 土豆 3）：雪天 0.5x 减速但仍生长；非白名单雪天停长
export const WINTER_PLANT_IDS = new Set([1, 3]);

export function seasonOf(day: number): Season {
  const idx = ((day % (SEASON_DAYS * 4)) + SEASON_DAYS * 4) % (SEASON_DAYS * 4);
  return SEASONS[Math.floor(idx / SEASON_DAYS) % 4];
}

function hashDay(day: number): number {
  let h = Math.imul(day + 0x9e3779b9, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h >>> 8) % 1000 / 1000; // 0..1
}

/** 天气（按日确定性）：冬季多雪，风暴少见于各季 */
export function weatherOf(day: number): Weather {
  const r = hashDay(day);
  const season = seasonOf(day);
  if (season === 'winter') {
    if (r < 0.4) return 'snow';
    if (r < 0.5) return 'storm';
    if (r < 0.6) return 'rain';
    return 'clear';
  }
  if (r < 0.3) return 'rain';
  if (r < 0.35) return 'storm';
  return 'clear';
}

/** 节日：每季最后一天（day % 10 == 9） */
export function festivalOf(day: number): string | null {
  return day % SEASON_DAYS === SEASON_DAYS - 1 ? FESTIVALS[seasonOf(day)] : null;
}

export function calendarDay(day: number): CalendarDay {
  return { day, season: seasonOf(day), weather: weatherOf(day), festival: festivalOf(day) };
}

/** 生长倍率：雨 1.5x（免浇水）；雪 0.5x；其余 1x */
export function growthMultOf(weather: Weather): number {
  return weather === 'rain' ? 1.5 : weather === 'snow' ? 0.5 : 1;
}

/** 风暴损毁：按 (day, uId) 哈希确定性挑 20% 露天作物（回放可重算） */
export function isStormVictim(day: number, uId: number): boolean {
  let h = Math.imul(uId * 2654435761 + day * 40503, 0x85ebca6b) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2d) >>> 0;
  return (h % 100) < 20;
}

export const STORM_INSURANCE_PER_PLANT = 10; // 保险赔付：每株 10 金币（次日发放）

// ---------- 服务器游戏日时钟（slot 锚点；客户端日计数之外的权威日） ----------

export function ensureDayAnchor(state: WorldState, now = Date.now()): void {
  if (!state.globals.has('afDayAnchor')) {
    state.globals.set('afDayAnchor', { val: now });
    state.persist();
  }
}

export function currentGameDay(state: WorldState, now = Date.now()): number {
  const anchor = state.globals.get('afDayAnchor') as { val?: number } | undefined;
  if (anchor?.val === undefined || anchor?.val === null) return 0;
  return Math.max(0, Math.floor((now - anchor.val) / state.growDayMsValue()));
}

export function lastGameDaySeen(state: WorldState): number {
  return Number((state.globals.get('afLastGameDay') as { val?: number } | undefined)?.val ?? -1);
}

export function markGameDaySeen(state: WorldState, day: number): void {
  state.globals.set('afLastGameDay', { val: day });
}

// ---------- 日切换执行器：天气效应 + 保险赔付 + 事件流 ----------
import type { App } from '../app.ts';
import { worldPlants, knapAdd } from './farm.ts';
import { CROP_BY_PLANT_ID } from './tables.ts';

export interface DayAdvance {
  advanced: boolean;
  day: number;
  events: number;
}

/** 把游戏日推进到当前（处理每个新日：天气/节日/生长修正/风暴损毁/保险赔付）；幂等 */
export function advanceGameDay(app: App, now = Date.now()): DayAdvance {
  const state = app.state;
  ensureDayAnchor(state, now);
  const cur = currentGameDay(state, now);
  const seen = lastGameDaySeen(state);
  if (cur <= seen) return { advanced: false, day: cur, events: 0 };
  let events = 0;
  for (let d = Math.max(seen + 1, 0); d <= cur; d++) {
    events += runGameDay(app, d, now);
  }
  markGameDaySeen(state, cur);
  state.persist();
  return { advanced: true, day: cur, events };
}

/** 处理单个游戏日（返回产生事件数） */
export function runGameDay(app: App, d: number, now = Date.now()): number {
  const state = app.state;
  const cal = calendarDay(d);
  const gday = state.growDayMsValue();
  let events = 0;

  // 1) 保险赔付：昨日风暴损毁，今日发放（今日若又风暴则顺延）
  const stormRec = state.globals.get('afLastStorm') as { val?: { day: number; victims: Array<{ uId: number; owner: string }> } } | undefined;
  if (stormRec?.val && stormRec.val.day === d - 1 && cal.weather !== 'storm') {
    for (const v of stormRec.val.victims) {
      if (v.owner) {
        const pm = state.playersDb.get(v.owner);
        if (pm) knapAdd(pm, 1, STORM_INSURANCE_PER_PLANT);
        app.log.append('crop.insurance', v.owner, { uId: v.uId, amount: STORM_INSURANCE_PER_PLANT, day: d });
        events++;
      }
    }
    state.globals.delete('afLastStorm');
  }

  // 2) 生长修正：雨 1.5x（免浇水）/ 雪 0.5x（仅冬季白名单）
  let accelerated = 0;
  for (const p of worldPlants(state)) {
    if (p.farmType !== 1 || !p.sownAt) continue;
    const crop = CROP_BY_PLANT_ID.get(p.plantId);
    if (!crop || (p.growDay ?? 0) >= crop.days) continue;
    if (cal.weather === 'rain') {
      p.sownAt = Math.max(p.sownAt - gday * 0.5, now - gday * crop.days);
      p.growDay = Math.min(crop.days, Math.floor((now - p.sownAt) / gday));
      accelerated++;
    } else if (cal.weather === 'snow' && WINTER_PLANT_IDS.has(p.plantId)) {
      p.sownAt = p.sownAt + gday * 0.5; // 减速 0.5x（白名单作物）
      p.growDay = Math.min(crop.days, Math.max(0, Math.floor((now - p.sownAt) / gday)));
    }
  }

  // 3) 风暴损毁：20% 露天作物（确定性挑选），记录供次日保险
  let destroyed: Array<{ uId: number; owner: string }> = [];
  if (cal.weather === 'storm') {
    const plants = worldPlants(state);
    const victims = plants.filter(p => p.farmType === 1 && p.uId > 0 && (p.growDay ?? 0) < (CROP_BY_PLANT_ID.get(p.plantId)?.days ?? 99) && isStormVictim(d, p.uId));
    for (const v of victims) {
      destroyed.push({ uId: v.uId, owner: String(v.owner ?? '') });
      const idx = plants.indexOf(v);
      if (idx >= 0) plants.splice(idx, 1);
    }
    if (destroyed.length) {
      state.globals.set('afLastStorm', { val: { day: d, victims: destroyed } });
      for (const v of destroyed) {
        app.log.append('crop.stormDamaged', v.owner || null, { uId: v.uId, day: d });
        events++;
      }
    }
  }

  // 4) 日事件（节日/天气/修正量，供日报与回放）
  app.log.append('calendar.day', null, {
    day: d, season: cal.season, weather: cal.weather, festival: cal.festival,
    rainAccelerated: accelerated, stormDestroyed: destroyed.length,
  });
  events++;

  state.persist();
  return events;
}
