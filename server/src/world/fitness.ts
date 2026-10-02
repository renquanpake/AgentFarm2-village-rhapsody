// world/fitness.ts —— P2 健身房功能层（world-expansion design.md 排期项 9）
// 属性训练 + 冷却（纯玩法线，不碰影子经济参数，M-B1 合规）。
// 持久化：state.world 'fitnessData'（uid -> FitnessRec），随世界存档。
import type { WorldState } from '../persistence/state.ts';

export const GYM_ATTRS = ['strength', 'agility', 'charisma'] as const;
export type GymAttr = (typeof GYM_ATTRS)[number];
/** 训练冷却（真实毫秒）：防刷，也逼 agent 把训练排进日程 */
export const TRAIN_COOLDOWN_MS = 300_000;
export const GYM_ATTR_NAME: Record<GymAttr, string> = { strength: '力量', agility: '敏捷', charisma: '亲和' };
/** 中文名 -> 内部键：welcome 与报错文案都公示 `attr:力量/敏捷/亲和`，实现须能直接吃这三个中文名 */
const ATTR_ALIAS: Record<string, GymAttr> = {
  力量: 'strength', 敏捷: 'agility', 亲和: 'charisma',
};
/** 归一化 attr：英文原样、中文别名转键；无法识别返回 null */
export function normalizeGymAttr(raw: string): GymAttr | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if ((GYM_ATTRS as readonly string[]).includes(lower)) return lower as GymAttr;
  return ATTR_ALIAS[s] ?? null;
}
const KEY = 'fitnessData';

export interface FitnessRec {
  attrs: Partial<Record<GymAttr, number>>;
  lastTrainAt?: number;
}

/** 取（不存在则建）某 agent 的健身状态 */
export function fitnessOf(state: WorldState, uid: string): FitnessRec {
  let all = state.world.get(KEY) as Record<string, FitnessRec> | undefined;
  if (!all) {
    all = {};
    state.world.set(KEY, all);
  }
  let r = all[uid];
  if (!r) {
    r = { attrs: {} };
    all[uid] = r;
  }
  return r;
}

/** 训练：冷却内拒绝（带 waitSec），否则属性 +1（lastTrainAt 刷新） */
export function trainAttr(state: WorldState, uid: string, attr: string, now: number): { ok: boolean; msg?: string; level?: number; waitSec?: number } {
  const a = normalizeGymAttr(attr);
  if (!a) {
    return { ok: false, msg: `attr 须为 ${GYM_ATTRS.map(x => `${GYM_ATTR_NAME[x]}/${x}`).join('/')}` };
  }
  const r = fitnessOf(state, uid);
  const wait = TRAIN_COOLDOWN_MS - (now - (r.lastTrainAt ?? 0));
  if (wait > 0) {
    return { ok: false, waitSec: Math.ceil(wait / 1000), msg: `训练冷却中，${Math.ceil(wait / 1000)} 秒后再试` };
  }
  r.lastTrainAt = now;
  r.attrs[a] = (r.attrs[a] ?? 0) + 1;
  return { ok: true, level: r.attrs[a], msg: `${GYM_ATTR_NAME[a]}训练完成，当前等级 ${r.attrs[a]}` };
}
