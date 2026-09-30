// world/festival.ts —— B11 节日集市与比赛玩法（design M5a）
// 节日（B8 每季 1 场）当天：村中心变集市——摊位费动态上浮（B3 通胀系数）+ 做市议价（价差收窄）；
// 每场节日配 1 项比赛（春花会=庭院分 / 夏钓赛=钓鱼价值 / 秋丰收=收获数 / 冬雪雕=装饰分），
// 节日日结算：冠军发奖 + festival.result 事件（供画报日报栏目）。
import type { App } from '../app.ts';
import type { WorldState } from '../persistence/state.ts';
import { calendarDay, currentGameDay, type Weather } from './calendar.ts';
import { feeMultiplier, computeInflation } from '../market/economy.ts';
import { worldDecors, courtyardScore } from './decor.ts';
import { knapAdd } from './farm.ts';

export type ContestKind = 'fishing' | 'harvest' | 'decor';

export interface FestivalCfg {
  festival: string;
  contest: ContestKind;
  prizeCoins: number;
}

/** 节日 -> 比赛配置 */
export function festivalCfg(festival: string): FestivalCfg {
  switch (festival) {
    case '春花会': return { festival, contest: 'decor', prizeCoins: 500 };
    case '夏钓赛': return { festival, contest: 'fishing', prizeCoins: 800 };
    case '秋丰收': return { festival, contest: 'harvest', prizeCoins: 600 };
    case '冬雪雕': return { festival, contest: 'decor', prizeCoins: 500 };
    default: return { festival, contest: 'decor', prizeCoins: 300 };
  }
}

export function activeFestival(app: App, now = Date.now()): string | null {
  return calendarDay(currentGameDay(app.state, now)).festival;
}

/** 集市摊位费：基础 100 × B3 通胀回收系数 */
export function stallFee(app: App): number {
  const mult = feeMultiplier(economyIndexOf(app));
  return Math.round(100 * mult);
}

function economyIndexOf(app: App): number | null {
  return computeInflation(app).index;
}

/** 节日议价：做市价差收窄（8% -> 4%），返给 market 影子/做市参考 */
export function festivalMakerSpread(festival: string | null): number {
  return festival ? 0.04 : 0.08;
}

// ---------- 比赛计分 ----------

const BUCKET = 'afFestivalContest';
interface ContestState { festival: string; day: number; scores: Record<string, number>; settled?: boolean }

function contestOf(state: WorldState): ContestState | null {
  return state.world.get(BUCKET) as ContestState | null;
}

/** 节日比赛计分：钓鱼=卖价累计 / 收获=次数 / 装饰=庭院分快照（每日刷新） */
export function recordFestivalScore(app: App, uid: string, delta: number, kind: ContestKind, now = Date.now()): void {
  const state = app.state;
  const fest = activeFestival(app, now);
  if (!fest) return;
  const cfg = festivalCfg(fest);
  if (cfg.contest !== kind) return;
  const day = currentGameDay(state, now);
  let c = contestOf(state);
  if (!c || c.festival !== fest || c.day !== day || c.settled) {
    c = { festival: fest, day, scores: {} };
    state.world.set(BUCKET, c);
  }
  c.scores[uid] = Math.max(0, (c.scores[uid] ?? 0) + delta);
  state.persist();
}

/** 装饰赛：直接取当前庭院分（幂等快照，取最大） */
export function snapshotFestivalDecor(app: App): void {
  for (const [uid] of app.state.playersDb) {
    const s = courtyardScore(app.state, app.tables, uid);
    if (s > 0) recordFestivalScore(app, uid, s, 'decor');
  }
}

/** 节日日结算：冠军发奖 + 事件；非冠军安慰奖 20% */
export function settleFestival(app: App, now = Date.now()): { winner: string | null; festival: string; scores: number } | null {
  const state = app.state;
  const c = contestOf(state);
  if (!c || c.settled) return null;
  const prevDay = currentGameDay(state, now) - 1;
  if (c.day !== prevDay) return null; // 非节日日结束
  const entries = Object.entries(c.scores);
  if (!entries.length) { c.settled = true; state.world.set(BUCKET, null); state.persist(); return { winner: null, festival: c.festival, scores: 0 }; }
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const cfg = festivalCfg(c.festival);
  const [winUid, winScore] = entries[0];
  if (winScore <= 0) { c.settled = true; state.world.set(BUCKET, null); state.persist(); return { winner: null, festival: c.festival, scores: 0 }; }
  knapAdd(state.playersDb.get(winUid), 1, cfg.prizeCoins);
  if (entries[1]) knapAdd(state.playersDb.get(entries[1][0]), 1, Math.round(cfg.prizeCoins * 0.2));
  state.world.set(BUCKET, null);
  state.persist();
  app.log.append('festival.result', winUid, { festival: c.festival, winner: winUid, score: winScore, prize: cfg.prizeCoins, top: entries.slice(0, 3).map(([u, s]) => ({ uid: u, score: s })) });
  return { winner: winUid, festival: c.festival, scores: entries.length };
}
