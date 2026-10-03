// world/metrics.ts —— N8 里程碑度量基建（留存 / 漏斗 / 时长）
//
// 事故背景：战略门是「100 陌生人中 30 个玩满 2h、10 个留存」，但 events 表里
// 全是玩法事件，没有任何注册/会话/时长/漏斗记录 —— 这个门在结构上无法判定。
// 现在补最小可判定集：
//   会话：注册（首登）、每次上线、每次下线（累计在线时长、会话数）
//   漏斗：新手引导 10 环节（world/onboarding.ts 产出的 doneSteps）
//   留存：按游戏日记录「当日是否上线过」，D1/D7 留存可算
//   行为：act 动作计数（哪种玩法被用/被弃）
//
// 存储：世界桶 metricData（已登记 WORLD_KEYS，参与回放哈希；纯事件派生，重放可还原）。
// 出口：/af/metrics（token）—— 面向运营的聚合视图，不含个人明细。
import type { App } from '../app.ts';
import type { WorldState } from '../persistence/state.ts';
import { onboardingFunnel } from './onboarding.ts';

export const METRIC_KEY = 'metricData';

export interface PlayerMetric {
  firstSeenAt: number;
  lastSeenAt: number;
  sessions: number;
  totalPlayMs: number;
  /** 上线过的游戏日（去重升序） */
  days: number[];
  /** act 动作计数 */
  actions: Record<string, number>;
  /** 已完成的新手引导环节 */
  funnel: string[];
  /** 任务链完成阶段数（快照，便于看内容消耗） */
  taskStages: number;
}

export interface MetricData {
  players: Record<string, PlayerMetric>;
  updatedAt: number;
}

function data(state: WorldState): MetricData {
  let d = state.world.get(METRIC_KEY) as MetricData | undefined;
  if (!d || !d.players) { d = { players: {}, updatedAt: Date.now() }; state.world.set(METRIC_KEY, d); }
  return d;
}

function rec(state: WorldState, uid: string, now = Date.now()): PlayerMetric {
  const d = data(state);
  let r = d.players[uid];
  if (!r) {
    r = { firstSeenAt: now, lastSeenAt: now, sessions: 0, totalPlayMs: 0, days: [], actions: {}, funnel: [], taskStages: 0 };
    d.players[uid] = r;
  }
  return r;
}

/** 会话开始（join / agent 握手）：记首登、会话数、当日活跃 */
export function metricsSessionStart(app: App, uid: string, now = Date.now()): void {
  const state = app.state;
  const r = rec(state, uid, now);
  r.sessions += 1;
  r.lastSeenAt = now;
  const day = gameDayOf(app);
  if (day >= 0 && !r.days.includes(day)) r.days.push(day);
  // 引导漏斗同步（引导状态存在玩家桶，这里做快照）
  r.funnel = onboardingFunnel(state, uid);
  data(state).updatedAt = now;
  state.schedulePersist();
}

/** 会话结束（close）：累计在线时长 */
export function metricsSessionEnd(app: App, uid: string, now = Date.now()): void {
  const state = app.state;
  const d = data(state);
  const r = d.players[uid];
  if (!r) return;
  // 单次会话上限 6 小时：防止挂机连接把时长指标刷爆
  const delta = Math.max(0, Math.min(6 * 3600_000, now - r.lastSeenAt));
  r.totalPlayMs += delta;
  r.lastSeenAt = now;
  d.updatedAt = now;
  state.schedulePersist();
}

/** 动作计数（act 成功时调） */
export function metricsAction(app: App, uid: string, action: string): void {
  const state = app.state;
  const r = rec(state, uid);
  r.actions[action] = (r.actions[action] || 0) + 1;
  const ob = state.playersDb.get(uid)?.get('afOnboarding') as { done?: string[] } | undefined;
  if (ob?.done) r.funnel = ob.done;
  const t = state.playersDb.get(uid)?.get('afTasks') as { chains?: Record<string, { doneStages: string[] }> } | undefined;
  if (t?.chains) r.taskStages = Object.values(t.chains).reduce((s, c) => s + (c.doneStages?.length || 0), 0);
  data(state).updatedAt = Date.now();
  state.schedulePersist();
}

function gameDayOf(app: App): number {
  const anchor = app.state.globals.get('afDayAnchor') as { val?: number } | undefined;
  if (anchor?.val === undefined) return -1;
  return Math.max(0, Math.floor((Date.now() - anchor.val) / app.state.growDayMsValue()));
}

export interface MetricsReport {
  players: {
    total: number;
    activeToday: number;
    played2h: number;      // 累计在线 >= 2h（对应「玩满 2h」）
    retainedD1: number;    // 首登后第 2 个游戏日仍上线
    retainedD7: number;
    medianPlayMs: number;
    totalPlayHours: number;
  };
  funnel: Array<{ step: string; reached: number; rate: number }>;   // 引导漏斗（10 环节）
  actions: Record<string, number>;                                  // 动作使用分布
  content: { taskStagesDone: number; avgTaskStages: number; onboardingDone: Record<string, number> };
  headline: { canJudge100_30_10: boolean; note: string };
}

/** 聚合视图（/af/metrics）：里程碑门「100/30/10」的可判定性自检 */
export function metricsReport(app: App): MetricsReport {
  const state = app.state;
  const d = data(state);
  const players = Object.values(d.players);
  const today = gameDayOf(app);
  const total = players.length;
  const activeToday = players.filter(r => r.days.includes(today)).length;
  const played2h = players.filter(r => r.totalPlayMs >= 2 * 3600_000).length;
  // 留存：首登日 +1 / +7 是否出现在 days（dayOf 用日锚折算，锚缺失按 0 计）
  const anchor = (state.globals.get('afDayAnchor') as { val?: number } | undefined)?.val ?? 0;
  const dayOf = (ms: number): number => (anchor ? Math.max(0, Math.floor((ms - anchor) / state.growDayMsValue())) : 0);
  const retainedD1 = players.filter(r => r.days.some(x => x >= dayOf(r.firstSeenAt) + 1)).length;
  const retainedD7 = players.filter(r => r.days.some(x => x >= dayOf(r.firstSeenAt) + 7)).length;
  const sorted = players.map(r => r.totalPlayMs).sort((a, b) => a - b);
  const medianPlayMs = sorted.length ? sorted[sorted.length >> 1] : 0;

  // 引导漏斗：按环节统计「完成过该环节」的人数（环节可跳着做，故不做顺序假设）
  const stepIds = (app.tables as unknown as { onboarding?: { steps?: Array<{ id: string }> } }).onboarding?.steps || [];
  const funnel = stepIds.map((s) => {
    const reached = players.filter(r => r.funnel.includes(s.id)).length;
    return { step: s.id, reached, rate: total ? Number((reached / total).toFixed(3)) : 0 };
  });

  const actions: Record<string, number> = {};
  for (const r of players) for (const [k, v] of Object.entries(r.actions)) actions[k] = (actions[k] || 0) + v;

  const onboardingDone: Record<string, number> = {};
  for (const r of players) for (const f of r.funnel) onboardingDone[f] = (onboardingDone[f] || 0) + 1;
  const taskStagesDone = players.reduce((s, r) => s + r.taskStages, 0);

  return {
    players: {
      total, activeToday, played2h, retainedD1, retainedD7,
      medianPlayMs,
      totalPlayHours: Number((players.reduce((s, r) => s + r.totalPlayMs, 0) / 3600_000).toFixed(1)),
    },
    funnel,
    actions,
    content: {
      taskStagesDone,
      avgTaskStages: total ? Number((taskStagesDone / total).toFixed(2)) : 0,
      onboardingDone,
    },
    headline: {
      canJudge100_30_10: total >= 100,
      note: total >= 100
        ? '样本已达 100，可判「30 人玩满 2h / 10 人留存」'
        : `样本 ${total}/100 —— 上线后随真实用户累积；当前只作趋势观察`,
    },
  };
}