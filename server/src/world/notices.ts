// world/notices.ts —— 公告通道（H 包/R9 T1）
// 环形 100 条，世界桶 noticeData；事件挂钩：节日开赛/风暴预警/租约释放/树复生/系统维护。
// 结构化域，回放可重放，参与 structuredHash。
import type { WorldState } from '../persistence/state.js';

export const NOTICE_KEY = 'noticeData';

export type NoticeKind = 'festival' | 'storm' | 'lease' | 'regrow' | 'system' | 'generic';

export interface Notice {
  seq: number;
  tick: number;
  kind: NoticeKind;
  text: string;
}

interface NoticeData { notices: Notice[]; seq: number; }

const MAX = 100;

function data(ws: WorldState): NoticeData {
  let c = ws.world.get(NOTICE_KEY) as NoticeData | undefined;
  if (!c || !c.notices) { c = { notices: [], seq: 0 }; ws.world.set(NOTICE_KEY, c); }
  return c;
}

/** 发公告（环形 100）。 */
export function publishNotice(ws: WorldState, tick: number, kind: NoticeKind, text: string): Notice {
  const d = data(ws);
  d.seq += 1;
  const n: Notice = { seq: d.seq, tick, kind, text };
  d.notices.push(n);
  while (d.notices.length > MAX) d.notices.shift();
  return n;
}

/** 最近 N 条（倒序）。 */
export function recentNotices(ws: WorldState, n = 5): Notice[] {
  const d = data(ws);
  return d.notices.slice(-n).reverse();
}

/** since 之后的全部（/af/notices）。 */
export function noticesSince(ws: WorldState, sinceSeq = 0): Notice[] {
  const d = data(ws);
  return d.notices.filter(x => x.seq > sinceSeq);
}

/** 序列号。 */
export function lastNoticeSeq(ws: WorldState): number {
  return data(ws).seq;
}
