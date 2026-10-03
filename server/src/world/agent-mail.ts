// world/agent-mail.ts —— Agent 给主人的回信信箱（对话闭环的回程通道）
//
// 事故背景：玩家 `agent_msg` 发给 Agent 的消息进了 **Agent 自己的 inbox**，
// 而 Agent 想回话只能 `dm_send`，而 `dm_send` 到自己的账号会被
// `target === uid` 直接拒 —— 于是「玩家问 → Agent 收到 → 没有回程」，
// 玩家永远看不到 Agent 的回答。现在 Agent 用 `act reply` 回话，
// 写进玩家私有信箱（afAgentMail，环形 50 条），在线时立即推送给玩家连接。
import type { WorldState } from '../persistence/state.ts';

export const AGENT_MAIL_KEY = 'afAgentMail';
const MAX = 50;

export interface AgentMail {
  from: string;      // 通常是 agent 的账号 uid/nick
  text: string;
  at: number;
  /** 触发这次回话的玩家提问（可选，便于玩家侧显示「答的是哪句」） */
  replyTo?: string;
}

/** Agent -> 主人：写信箱 */
export function pushAgentMail(state: WorldState, uid: string, from: string, text: string, replyTo?: string): AgentMail {
  const pm = state.playersDb.get(uid) || state.playersDb.get('u' + uid);
  if (!pm) return { from, text, at: Date.now(), replyTo };
  const arr = (pm.get(AGENT_MAIL_KEY) as AgentMail[] | undefined) || [];
  const m: AgentMail = { from, text: text.slice(0, 500), at: Date.now(), ...(replyTo ? { replyTo: replyTo.slice(0, 200) } : {}) };
  arr.push(m);
  while (arr.length > MAX) arr.shift();
  pm.set(AGENT_MAIL_KEY, arr);
  state.schedulePersist();
  return m;
}

/** 主人读信箱（倒序，最新在前） */
export function agentMailOf(state: WorldState, uid: string, n = 10): AgentMail[] {
  const pm = state.playersDb.get(uid) || state.playersDb.get('u' + uid);
  const arr = (pm && pm.get(AGENT_MAIL_KEY) as AgentMail[] | undefined) || [];
  return arr.slice(-Math.max(1, Math.min(MAX, n))).reverse();
}

/** 待答提问（玩家发问时记；Agent 侧 observe 可读到「主人问了什么」） */
export const ASK_KEY = 'afAgentAsk';
export interface AgentAsk { text: string; at: number; answered?: boolean }

export function pushAsk(state: WorldState, uid: string, text: string): AgentAsk {
  const pm = state.playersDb.get(uid) || state.playersDb.get('u' + uid);
  const arr = (pm && pm.get(ASK_KEY) as AgentAsk[] | undefined) || [];
  const a: AgentAsk = { text: text.slice(0, 300), at: Date.now() };
  arr.push(a);
  while (arr.length > 20) arr.shift();
  pm?.set(ASK_KEY, arr);
  state.schedulePersist();
  return a;
}

export function asksOf(state: WorldState, uid: string): AgentAsk[] {
  const pm = state.playersDb.get(uid) || state.playersDb.get('u' + uid);
  return ((pm && pm.get(ASK_KEY) as AgentAsk[] | undefined) || []).slice(-5);
}