// world/gossip.ts —— 显著事件八卦链（F 包 R7）
// 白名单事件（大额送礼/委托完成/节日得分/租约纠纷）写入世界桶 gossipData（环形 50 条）；
// 最近一条注入 NPC talk 的 LLM system（村口八卦素材），形成异步社交氛围。
// 结构化域，回放可重放，参与 structuredHash。
import type { WorldState } from '../persistence/state.js';

export const GOSSIP_KEY = 'gossipData';

export type GossipKind = 'gift' | 'delegate' | 'festival' | 'lease' | 'generic';

export interface Gossip {
  seq: number;
  tick: number;
  kind: GossipKind;
  text: string;
}

interface GossipData { items: Gossip[]; seq: number; }

const MAX = 50;

function data(ws: WorldState): GossipData {
  let c = ws.world.get(GOSSIP_KEY) as GossipData | undefined;
  if (!c || !c.items) { c = { items: [], seq: 0 }; ws.world.set(GOSSIP_KEY, c); }
  return c;
}

/** 记录一条八卦（仅白名单显著事件调用）。 */
export function recordGossip(ws: WorldState, tick: number, kind: GossipKind, text: string): Gossip {
  const d = data(ws);
  d.seq += 1;
  const g: Gossip = { seq: d.seq, tick, kind, text };
  d.items.push(g);
  while (d.items.length > MAX) d.items.shift();
  return g;
}

/** 最近一条（注入 NPC talk system）。 */
export function latestGossip(ws: WorldState): Gossip | null {
  const d = data(ws);
  return d.items.length ? d.items[d.items.length - 1] : null;
}

/** 是否属于「显著事件白名单」——大额送礼（金币>=100）/ 委托 / 节日 / 租约。 */
export function isSignificant(kind: GossipKind, amount: number | undefined): boolean {
  if (kind === 'delegate' || kind === 'festival' || kind === 'lease') return true;
  if (kind === 'gift') return (amount || 0) >= 100;
  return false;
}
