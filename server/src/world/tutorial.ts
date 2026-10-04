// src/world/tutorial.ts —— P4 新手教程的服务端权威进度（玩家私有桶 afTutorial）
//
// 设计要点：
// 1) 步骤数据驱动（data/tutorial.json）；表损坏/缺失回落内置 7 步（不炸服）
// 2) 完成度由**既有 act 的成功事件**计数推导（同 tasks.ts taskView 口径），不新增 act
// 3) 桶登记在 PLAYER_KEYS（玩家私有）。bucketOf 对未注册键已回落 ['player',name]，
//    显式登记是更严的写法 —— 历史上 world 桶漏登记导致 uid='' 幽灵桶、重启静默丢数据
import type { App } from '../app.ts';
import type { WorldState } from '../persistence/state.ts';
import type { Tables } from './tables.ts';

export const TUTORIAL_KEY = 'afTutorial';

export interface TutorialStep {
  id: string;
  title: string;
  hint: string;
  /** 触发本步完成的 act 名（+ 连接表示四连）；空 = 由客户端/服务端显式上报 */
  need: string;
}

/** 内置兜底（data/tutorial.json 读不到时用；文案与数据表同源演进时需同步） */
const FALLBACK_STEPS: TutorialStep[] = [
  { id: 'see-self', title: '认识你的小人与镜头', hint: '画面里那个小人就是你，先随便看看四周。', need: 'onboarding' },
  { id: 'move', title: '走两步', hint: '用方向键或摇杆走两步，脚下会实时显示坐标。', need: 'move' },
  { id: 'tasks', title: '打开任务书', hint: '点右上角 📜 任务书，看「新手村·日常」第一条。', need: 'tasks' },
  { id: 'farm', title: '种一块地', hint: 'till 犁地 → plant 播种 → water 浇水 → harvest 收菜，作物要等一天。', need: 'till+plant+water+harvest' },
  { id: 'talk', title: '和 NPC 说句话', hint: '走到 NPC 身边点一下，问价或闲聊都行。', need: 'talk' },
  { id: 'agent', title: '雇佣 Agent 替你干活', hint: '把 Key 交给托管 Agent，指令出去小人真的会干活。', need: '' },
  { id: 'delegate', title: '完成第一单委托', hint: '委托板挂一单或接一单，完成后金币入包。', need: 'delegate' },
];

interface TutorialData { steps?: TutorialStep[] }

/** 读步骤表（data/tutorial.json；读不到/损坏回落内置 7 步） */
export function tutorialSteps(tables: Tables): TutorialStep[] {
  const d = tables.readJson<TutorialData | null>('tutorial.json', null);
  const steps = d?.steps;
  if (Array.isArray(steps) && steps.length) {
    return steps
      .filter((s) => s && typeof s.id === 'string' && s.id)
      .map((s) => ({ id: String(s.id), title: String(s.title ?? s.id), hint: String(s.hint ?? ''), need: String(s.need ?? '') }));
  }
  return FALLBACK_STEPS;
}

interface TutorialProgressData {
  done: string[];
  /** act 成功次数：{ move: 2, till: 1, … }（验收只看「本步内完成过」，不看瞬时态） */
  seen: Record<string, number>;
}

export interface TutorialProgress {
  done: string[];
  /** 第一个未完成步；全完成 → null */
  active: string | null;
  seen: Record<string, number>;
}

function data(state: WorldState, uid: string): TutorialProgressData {
  const pm = state.playersDb.get(uid);
  const raw = pm?.get(TUTORIAL_KEY) as Partial<TutorialProgressData> | undefined;
  const done = Array.isArray(raw?.done) ? raw.done.filter((x): x is string => typeof x === 'string') : [];
  const seen = raw?.seen && typeof raw.seen === 'object' && !Array.isArray(raw.seen) ? raw.seen as Record<string, number> : {};
  return { done, seen };
}

function save(state: WorldState, uid: string, d: TutorialProgressData): void {
  const pm = state.playersDb.get(uid);
  if (!pm) return; // 玩家未进世界：不建桶（避免幽灵数据）
  pm.set(TUTORIAL_KEY, d);
}

/** 读进度（未知 uid 返回空进度而不是抛） */
export function tutorialProgress(state: WorldState, uid: string, steps?: TutorialStep[]): TutorialProgress {
  const list = steps ?? FALLBACK_STEPS;
  const d = data(state, uid);
  const done = new Set(d.done);
  const active = list.find((s) => !done.has(s.id))?.id ?? null;
  return { done: [...done], active, seen: { ...d.seen } };
}

/** 步完成条件：need 为空 → 只能显式标记（actName 形如 'agent_hired'/'see-self'）；否则 act 成功即算 */
function stepSatisfied(step: TutorialStep, actName: string, seen: Record<string, number>): boolean {
  const need = step.need.trim();
  if (!need) return actName === step.id || actName === `${step.id}_hired` || actName === step.id.replace(/-/g, '_');
  if (!need.split('+').includes(actName)) return false;
  return need.split('+').every((a) => (seen[a.trim()] ?? 0) > 0);
}

/**
 * act 成功事件 → 教程进度（ws.ts actResult 尾段统一调用）。
 * ok=false 不计数（同 tasks 模式：失败操作不算完成，避免「点了没成」被当做过关）。
 */
export function tutorialAct(state: WorldState, uid: string, actName: string, ok: boolean, steps?: TutorialStep[]): void {
  if (!ok || !actName) return;
  const list = steps ?? FALLBACK_STEPS;
  const d = data(state, uid);
  d.seen[actName] = (d.seen[actName] ?? 0) + 1;
  const done = new Set(d.done);
  for (const step of list) {
    if (done.has(step.id)) continue;
    if (stepSatisfied(step, actName, d.seen)) done.add(step.id);
  }
  d.done = [...done];
  save(state, uid, d);
}

export interface TutorialView {
  key: string;
  steps: TutorialStep[];
  progress: TutorialProgress;
}

/** GET /af/tutorial 响应体（steps + progress；uid 可空 → 只给公开文案面） */
export function tutorialView(app: App, uid: string | undefined): TutorialView {
  const steps = tutorialSteps(app.tables);
  if (!uid) return { key: TUTORIAL_KEY, steps, progress: { done: [], active: steps[0]?.id ?? null, seen: {} } };
  return { key: TUTORIAL_KEY, steps, progress: tutorialProgress(app.state, uid, steps) };
}