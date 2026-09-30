// narrative/report.ts —— A9 画报日报骨架：事件聚合（纯函数，确定性）
// 完整形态（LLM 文案 + 生图插画 + 回落截图）依赖 M4/M7 编排与客户端，本段先落地可测的聚合层。
import type { GameEvent } from '../persistence/events.ts';
import { eventPos } from './director.ts';

export interface DailyReportOpts {
  limit?: number;
  maxHighlights?: number;
  fallbackScene?: number;
}

export interface DailyReport {
  eventCount: number;
  byType: Record<string, number>;
  players: Array<{ uid: string; events: number; byType: Record<string, number> }>;
  highlights: Array<{ seq: number; type: string; actor: string; x: number; y: number; scene: number }>;
  reportHash: string;
}

// 纯函数：同一输入必同输出（画报可离线重放）
export function buildDailyReport(events: GameEvent[], opts: DailyReportOpts = {}): DailyReport {
  const limit = opts.limit ?? 500;
  const maxHighlights = opts.maxHighlights ?? 20;
  const fallbackScene = opts.fallbackScene ?? 0;
  const evs = events.slice(-limit);

  const byType: Record<string, number> = {};
  const perPlayer = new Map<string, { events: number; byType: Record<string, number> }>();
  const highlights: DailyReport['highlights'] = [];

  for (const ev of evs) {
    byType[ev.type] = (byType[ev.type] ?? 0) + 1;
    const actor = ev.actor ?? '';
    let p = perPlayer.get(actor);
    if (!p) { p = { events: 0, byType: {} }; perPlayer.set(actor, p); }
    p.events += 1;
    p.byType[ev.type] = (p.byType[ev.type] ?? 0) + 1;
    const pos = eventPos(ev, fallbackScene);
    if (pos) highlights.push({ seq: ev.seq, type: ev.type, actor, x: pos.x, y: pos.y, scene: pos.scene });
  }

  const players = [...perPlayer.entries()]
    .map(([uid, v]) => ({ uid, ...v }))
    .sort((a, b) => b.events - a.events || a.uid.localeCompare(b.uid));
  const topHighlights = highlights.slice(-maxHighlights);

  const canonical = JSON.stringify({ c: evs.length, byType, players, h: topHighlights });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) { h ^= canonical.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  for (let i = 0; i < 4; i++) h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  const reportHash = h.toString(16).padStart(8, '0') + ((Math.imul(h, 0x27d4eb2d) >>> 0).toString(16).padStart(8, '0'));

  return { eventCount: evs.length, byType, players, highlights: topHighlights, reportHash };
}
