// world/onboarding.ts —— N9 第一小时体验引导（新手前 60 分钟逐环节）
//
// 事故背景：新手第一天可玩完全部内容（审计结论），2h 留存缺内容支撑；
// 且没有任何「新玩家该先做什么」的文本指引 —— Agent 与人类都只能自己摸索。
// 现在：10 个环节挂在 act 动作类型上，玩家/Agent 每做一步就推进一格；
// 进度存玩家私有桶 afOnboarding（服务端权威，客户端 save 不可写，见 world/save-guard.ts）。
import type { WorldState } from '../persistence/state.ts';
import type { Tables } from './tables.ts';

export interface OnboardingStep {
  id: string;
  title: string;
  minutes: number;
  act: string;
  count: number;
  hint: string;
  doneText: string;
}
export interface OnboardingDoc {
  version: number;
  totalTargetMinutes?: number;
  steps?: OnboardingStep[];
}

/** 玩家私有桶键（服务端权威） */
export const ONBOARDING_KEY = 'afOnboarding';

export function onboardingSteps(tables: Tables): OnboardingStep[] {
  const doc = (tables as unknown as { onboarding?: OnboardingDoc | null }).onboarding;
  return doc && Array.isArray(doc.steps) ? doc.steps : [];
}

export interface OnboardingState {
  cur: Record<string, number>;
  done: string[];
  startedAt: number;
  finishedAt?: number;
}

export function onboardingOf(state: WorldState, uid: string): OnboardingState | null {
  const v = state.playersDb.get(uid)?.get(ONBOARDING_KEY) as OnboardingState | undefined;
  return v && v.cur ? v : null;
}

function ensure(state: WorldState, uid: string): OnboardingState {
  let s = onboardingOf(state, uid);
  if (!s) {
    s = { cur: {}, done: [], startedAt: Date.now() };
    state.playersDb.get(uid)?.set(ONBOARDING_KEY, s);
    state.schedulePersist();
  }
  return s;
}

/** 动作命中引导：返回本步是否刚完成（调用方负责发事件/提示） */
export function onboardingCount(state: WorldState, tables: Tables, uid: string, actType: string, n = 1): OnboardingStep | null {
  const steps = onboardingSteps(tables);
  if (!steps.length) return null;
  const pm = state.playersDb.get(uid);
  if (!pm) return null;
  const s = ensure(state, uid);
  let finished: OnboardingStep | null = null;
  for (const st of steps) {
    if (st.act !== actType || s.done.includes(st.id)) continue;
    const cur = Math.min(st.count, (s.cur[st.id] ?? 0) + n);
    s.cur[st.id] = cur;
    if (cur >= st.count) {
      s.done.push(st.id);
      finished = st;
    }
  }
  if (s.done.length) state.schedulePersist();
  return finished;
}

/** 引导视图（observe.onboarding / act onboarding 的唯一出口） */
export function onboardingView(state: WorldState, tables: Tables, uid: string): {
  steps: Array<{ id: string; title: string; cur: number; total: number; done: boolean; hint: string; doneText?: string }>;
  current: { id: string; title: string; hint: string; act: string } | null;
  finished: number;
  total: number;
  elapsedMinutes: number;
  summary: string;
} | null {
  const steps = onboardingSteps(tables);
  if (!steps.length) return null;
  const s = onboardingOf(state, uid);
  const startedAt = s?.startedAt ?? 0;
  const doneSet = new Set(s?.done || []);
  const rows = steps.map(st => ({
    id: st.id, title: st.title, cur: Math.min(st.count, s?.cur?.[st.id] ?? 0), total: st.count,
    done: doneSet.has(st.id), hint: st.hint, ...(doneSet.has(st.id) ? { doneText: st.doneText } : {}),
  }));
  const cur = rows.find(r => !r.done) || null;
  const finished = rows.filter(r => r.done).length;
  const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 60000) : 0;
  return {
    steps: rows,
    current: cur ? { id: cur.id, title: cur.title, hint: cur.hint, act: String(steps.find(x => x.id === cur.id)?.act || '') } : null,
    finished,
    total: rows.length,
    elapsedMinutes: elapsed,
    summary: cur
      ? `新手引导 ${finished}/${rows.length}：下一步「${cur.title}」—— ${cur.hint}`
      : `新手引导全部完成（${finished}/${rows.length}）—— 接下来看 act tasks 的任务链`,
  };
}

/** 漏斗埋点（供 world/metrics.ts 聚合；纯计数，不改状态语义） */
export function onboardingFunnel(state: WorldState, uid: string): string[] {
  return onboardingOf(state, uid)?.done || [];
}