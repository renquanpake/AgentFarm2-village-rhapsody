// world/social-facts.ts —— 社会事实库（M14 社交记忆）
//
// 设计（学习自 Prom Week 社会事实数据库 + Lostgarden 互惠循环）：
//   角色记得对彼此做过什么（公共知识），agent observe 时可读，态度随事实累积漂移。
//   事实存 world.socialData.facts（世界桶，cap 500 条 FIFO），每条 {a, b, kind, at, note}。
//   kind: talk_care / talk_joke / talk_cold / give / bind / steal / clear / craft_share
//   态度档（attitudeOf）：基于 fav + 近期事实计数 -> 陌生/友好/亲密/敌对，agent 行为可消费。
import type { WorldState } from '../persistence/state.ts';
import { favBetween } from './social.ts';

export interface SocialFact {
  a: string;      // 发起方 uid
  b: string;      // 接收方 uid
  kind: string;   // 事实类型
  at: number;
  note: string;   // 人类可读描述（agent prompt 用）
}

const FACTS_KEY = 'facts';
const FACTS_CAP = 500;

function factsOf(state: WorldState): SocialFact[] {
  const s = state.socialDataObj() as unknown as { facts?: SocialFact[] };
  if (!Array.isArray(s.facts)) s.facts = [];
  return s.facts;
}

/** 记一条社会事实（FIFO cap；不落盘由 schedulePersist 统一） */
export function recordFact(state: WorldState, a: string, b: string, kind: string, note: string): void {
  const arr = factsOf(state);
  arr.push({ a, b, kind, at: Date.now(), note });
  while (arr.length > FACTS_CAP) arr.shift();
  state.schedulePersist();
}

/** 两人之间的事实（新→旧） */
export function factsBetween(state: WorldState, a: string, b: string): SocialFact[] {
  return factsOf(state).filter(f => (f.a === a && f.b === b) || (f.a === b && f.b === a)).slice(-20).reverse();
}

export type Attitude = 'stranger' | 'friendly' | 'close' | 'hostile';

/** 态度档：fav 为主 + 近期负面事实可拉低（agent 行为/对话语气消费） */
export function attitudeOf(state: WorldState, a: string, b: string): { tier: Attitude; label: string; fav: number } {
  const f = favBetween(state, a, b);
  const fav = f.aToB || 0;
  const recent = factsBetween(state, a, b).filter(x => Date.now() - x.at < 7 * 86_400_000);
  const neg = recent.filter(x => x.kind === 'talk_cold' || x.kind === 'steal' || x.kind === 'clear').length;
  const pos = recent.filter(x => x.kind === 'talk_care' || x.kind === 'give' || x.kind === 'craft_share').length;
  let tier: Attitude;
  if (fav >= 90 || (fav >= 60 && pos > neg)) tier = 'close';
  else if (fav >= 30 || pos > neg) tier = 'friendly';
  else if (neg > pos && neg >= 2) tier = 'hostile';
  else tier = 'stranger';
  const label = { stranger: '陌生', friendly: '友好', close: '亲密', hostile: '敌对' }[tier];
  return { tier, label, fav };
}