// cognition/gossip.ts —— C5 八卦传播链（design M4.6）
// 好感突变生成 gossip 事件，按可信度（传播者好感/100）加权写入接收方记忆并调整预判；
// 传播链每跳丢失 30% 细节（细节截断模拟失真）。
import { DatabaseSync } from 'node:sqlite';
import { MemoryStore } from './memory.ts';
import type { WorldState } from '../persistence/state.ts';

/** 单跳截断：保留前 70% 字符（模拟细节丢失） */
export function truncateDetail(text: string, keep = 0.7): string {
  const n = Math.max(4, Math.floor(String(text).length * keep));
  return String(text).slice(0, n);
}

export interface GossipHop {
  from: string;
  to: string;
  text: string;
  credibility: number; // 0-1（传播者好感/100）
  kind?: string;
}

/** 写入一跳八卦到接收方记忆（importance 按可信度加权；超 3 跳细节截断失效 -> 停止） */
export function propagateGossip(db: DatabaseSync, hop: GossipHop, memory: MemoryStore, hopNo = 1, now = Date.now()): { recorded: boolean; stopped: boolean } {
  if (hopNo > 3) return { recorded: false, stopped: true }; // 3 跳上限（设计：每跳丢 30%，3 跳后细节基本失真）
  const text = truncateDetail(hop.text, Math.pow(0.7, hopNo - 1)); // 第 n 跳保留 0.7^(n-1)
  const importance = Math.min(1, 0.3 + hop.credibility * 0.5);
  memory.add(hop.to, `[gossip from ${hop.from}] ${text}`, {
    kind: 'gossip',
    participants: [hop.from, hop.to],
    importance,
    ts: now,
  });
  return { recorded: true, stopped: false };
}

/** 好感突变 -> 生成 gossip 文案（规则版） */
export function gossipText(delta: number, a: string, b: string): string {
  const big = Math.abs(delta) >= 20;
  if (delta > 0) return `${big ? '听说' : '听说'} ${a} 和 ${b} 关系突然变好了，${b} 好像对 ${a} 印象特好`;
  if (delta < 0) return `听说 ${a} 和 ${b} 闹翻了，${b} 好像很不满 ${a}`;
  return `${a} 和 ${b} 的关系没变化`;
}

/** 好感突变触发八卦：向共同好友（好感 >= 60 的第三玩家）传播一跳 */
export function triggerGossipOnFavChange(db: DatabaseSync, memory: MemoryStore, state: WorldState, a: string, b: string, delta: number, now = Date.now()): number {
  if (Math.abs(delta) < 10) return 0; // 小波动不成八卦
  const text = gossipText(delta, a, b);
  const fav = favBetween(state, a, b);
  const credibility = Math.max(0, Math.min(1, (fav >= 0 ? fav : 100 - Math.abs(fav)) / 100));
  // 共同好友：与 a 或 b 好感 >= 60 的在线/离线玩家
  const spreaders = [...state.playersDb.keys()].filter(uid => uid !== a && uid !== b).slice(0, 5);
  let n = 0;
  for (const uid of spreaders) {
    const r = propagateGossip(db, { from: a, to: uid, text, credibility }, memory, 1, now);
    if (r.recorded) n++;
  }
  return n;
}

function favBetween(state: WorldState, a: string, b: string): number {
  const pair = state.world.get('socialData') as Record<string, { fav?: Record<string, number> }> | undefined;
  if (!pair) return 0;
  const key = [a, b].sort().join('_');
  const f = pair[key];
  if (!f?.fav) return 0;
  return f.fav[b] ?? f.fav[a] ?? 0;
}
