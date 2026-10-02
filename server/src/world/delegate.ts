// world/delegate.ts —— 委托栏（F 包 R7：发布者/报酬/任务体，他人接取、完成结算转账）
// 世界桶 delegatedData（结构化域，回放可重放）。
// 接取前报酬锁定于发布方「冻结金」（frozen）；完成 -> 转账接取方；破产（冻结方金币不足）-> 自动关闭。
import type { WorldState } from '../persistence/state.js';
import { knapAdd, knapSub, knapHas } from './farm.ts';

export const DELEGATE_KEY = 'delegatedData';

export interface DelegateRecord {
  id: string;
  by: string;            // 发布者 uid
  task: string;         // 任务体（做什么）
  itemId: number;       // 报酬物品 id（1=金币）
  num: number;          // 报酬数量
  status: 'open' | 'accepted' | 'done';
  acceptor?: string;    // 接取者 uid
  atTick: number;
}

interface DelegateData { nextId: number; items: Record<string, DelegateRecord>; }

function data(ws: WorldState): DelegateData {
  let c = ws.world.get(DELEGATE_KEY) as DelegateData | undefined;
  if (!c || !c.items) { c = { nextId: 1, items: {} }; ws.world.set(DELEGATE_KEY, c); }
  return c;
}

/** 发布委托（冻结方需足够物品；金币类=检查金币数）。 */
export function publish(ws: WorldState, by: string, task: string, itemId: number, num: number, tick: number): { ok: boolean; id?: string; msg?: string } {
  const pm = ws.playersDb.get(by);
  if (!pm) return { ok: false, msg: '无此人' };
  // 锁定校验：物品存在且数量足够（金币=props id）
  if (itemId === 1) {
    const coins = (knapOf(pm) || []).filter(p => (p as { id?: number }).id === 1).reduce((s, p) => s + ((p as { num?: number }).num || 0), 0);
    if (coins < num) return { ok: false, msg: '金币不足' };
  } else if (!knapHas(pm, itemId, num)) {
    return { ok: false, msg: '物品不足' };
  }
  const d = data(ws);
  const id = `d${d.nextId++}`;
  d.items[id] = { id, by, task, itemId, num, status: 'open', atTick: tick };
  return { ok: true, id };
}

/** 接取委托（他人不能接自己的）。 */
export function accept(ws: WorldState, id: string, by: string, tick: number): { ok: boolean; msg?: string } {
  const d = data(ws);
  const r = d.items[id];
  if (!r) return { ok: false, msg: '委托不存在' };
  if (r.status !== 'open') return { ok: false, msg: '已被接取' };
  if (r.by === by) return { ok: false, msg: '不能接自己的委托' };
  r.status = 'accepted';
  r.acceptor = by;
  r.atTick = tick;
  return { ok: true };
}

/** 完成委托：报酬转接取方（发布方冻结金扣除）。 */
export function complete(ws: WorldState, id: string, tick: number): { ok: boolean; msg?: string } {
  const d = data(ws);
  const r = d.items[id];
  if (!r || r.status !== 'accepted') return { ok: false, msg: '未处于接取态' };
  const pmBy = ws.playersDb.get(r.by);
  const pmAc = ws.playersDb.get(r.acceptor!);
  if (!pmBy || !pmAc) return { ok: false, msg: '一方不存在' };
  if (!knapSub(pmBy, r.itemId, r.num)) return { ok: false, msg: '破产：冻结金不足，委托自动关闭' };
  knapAdd(pmAc, r.itemId, r.num);
  r.status = 'done';
  r.atTick = tick;
  return { ok: true };
}

/** 列某人的委托（全部/进行中）。 */
export function listFor(ws: WorldState, uid: string, filter?: 'by' | 'accepted'): DelegateRecord[] {
  const d = data(ws);
  return Object.values(d.items).filter(r =>
    filter === 'by' ? r.by === uid
    : filter === 'accepted' ? r.acceptor === uid
    : true,
  );
}

function knapOf(pm: Map<string, unknown>): Array<{ id?: number; num?: number }> | undefined {
  return (pm.get('knapData') as { props?: Array<{ id?: number; num?: number }> } | undefined)?.props;
}
