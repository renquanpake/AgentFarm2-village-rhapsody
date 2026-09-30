// narrative/director.ts —— 导演镜头（设计 M1.1）：把事件流转成镜头指令，供观战玩家/回放器消费
// 纯函数 buildTimeline：同一事件序列 + 同一观战目标 -> 同一镜头时间线（回放确定性的一部分）。
import type { GameEvent } from '../persistence/events.ts';
import type { CameraShot } from './index.ts';

const PUSH_THROTTLE_MS = 2000; // 每观战者镜头推送节流

/** 事件 -> 世界坐标（像素）；无位置语义的事件返回 null */
export function eventPos(ev: GameEvent, fallbackScene = 2): { x: number; y: number; scene: number } | null {
  const p = ev.payload;
  switch (ev.type) {
    case 'agent.pos':
      return { x: Number(p.x), y: Number(p.y), scene: Number(p.scene ?? fallbackScene) };
    case 'plant.sown':
    case 'crop.harvested':
      return gridPos(ev, p, fallbackScene);
    case 'plot.tilled':
    case 'sprinkler.placed':
      return { x: Number(p.x) * 100 + 50, y: Number(p.y) * 100 + 50, scene: fallbackScene };
    case 'tree.chopped':
    case 'crop.watered':
      return gridPos(ev, p, fallbackScene);
    case 'fish.caught':
    case 'ore.mined':
      return agentPosOf(ev); // 发生在该 agent 当时位置（agent.pos 事件携带）
    default:
      return null;
  }
}
function gridPos(ev: GameEvent, p: Record<string, unknown>, scene: number): { x: number; y: number; scene: number } | null {
  if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x * 100 + 50, y: p.y * 100 + 50, scene };
  return null;
}
function agentPosOf(ev: GameEvent): { x: number; y: number; scene: number } | null {
  const p = ev.payload;
  if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y, scene: Number(p.scene ?? 2) };
  return null;
}

/** 值得给"事件流"观战模式出镜头的事件（有位置语义的关键行为） */
const EVENT_SHOT_TYPES = new Set([
  'plant.sown', 'crop.harvested', 'crop.watered', 'plot.tilled', 'tree.chopped',
  'sprinkler.placed', 'fish.caught', 'ore.mined', 'social.fav', 'dm.unlocked',
]);

export type WatchTarget = string; // 'agent:<uid>' 观战某托管 agent；'events' 观战全事件流

/** 纯函数：事件序列 -> 镜头时间线（同一输入必同一输出） */
export function buildTimeline(events: GameEvent[], watch: WatchTarget, scene = 2): CameraShot[] {
  const shots: CameraShot[] = [];
  for (const ev of events) {
    if (watch.startsWith('agent:')) {
      const tuid = watch.slice(6);
      if (ev.actor !== tuid) continue;
      if (ev.type === 'agent.pos' || EVENT_SHOT_TYPES.has(ev.type)) {
        const pos = eventPos(ev, scene) ?? lastAgentPos(events, tuid, ev.seq);
        if (pos) shots.push({ target: tuid, kind: 'follow_agent', scene: pos.scene, x: pos.x, y: pos.y, holdMs: 0 });
      }
    } else if (watch === 'events') {
      if (!EVENT_SHOT_TYPES.has(ev.type)) continue;
      const pos = eventPos(ev, scene);
      if (pos) shots.push({ target: ev.actor || 'world', kind: 'focus_event', scene: pos.scene, x: pos.x, y: pos.y, holdMs: 3000 });
    }
  }
  return shots;
}

/** 取 seq 之前最近一次该 agent 的位置（fish/mine 事件无坐标时兜底） */
function lastAgentPos(events: GameEvent[], uid: string, beforeSeq: number): { x: number; y: number; scene: number } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.seq >= beforeSeq) continue;
    if (e.actor === uid && e.type === 'agent.pos') {
      return { x: Number(e.payload.x), y: Number(e.payload.y), scene: Number(e.payload.scene ?? 2) };
    }
  }
  return null;
}

/** 实时导演：为每个观战者节流推送镜头（经 EventLog.listen 订阅） */
export class CameraDirector {
  private watch = new Map<string, WatchTarget>(); // 观战者 uid -> 目标
  private lastPush = new Map<string, number>();
  private scene: number;
  private onPush: (spectatorUid: string, shot: CameraShot, watch: WatchTarget) => void;

  constructor(opts: { scene?: number; onPush: (spectatorUid: string, shot: CameraShot, watch: WatchTarget) => void }) {
    this.scene = opts.scene ?? 2;
    this.onPush = opts.onPush;
  }

  setWatch(spectator: string, target: WatchTarget): void { this.watch.set(spectator, target); }
  clearWatch(spectator: string): void { this.watch.delete(spectator); this.lastPush.delete(spectator); }
  watchers(): Array<{ spectator: string; target: WatchTarget }> {
    return [...this.watch.entries()].map(([spectator, target]) => ({ spectator, target }));
  }

  /** 事件到达（EventLog.listen 触发）：按观战目标出镜头（节流） */
  ingest(ev: GameEvent): void {
    if (ev.type !== 'agent.pos' && !EVENT_SHOT_TYPES.has(ev.type)) return;
    const now = Date.now();
    for (const [sp, target] of this.watch) {
      if (now - (this.lastPush.get(sp) || 0) < PUSH_THROTTLE_MS) continue;
      const shots = buildTimeline([ev], target, this.scene);
      const shot = shots[shots.length - 1];
      if (shot) { this.lastPush.set(sp, now); this.onPush(sp, shot, target); }
    }
  }
}

export { PUSH_THROTTLE_MS };
