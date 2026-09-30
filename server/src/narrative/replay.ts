// narrative/replay.ts —— 确定性回放器（设计 M1.4）：从最近快照重放事件到目标点
// 回放器为只读：重建状态走 noPersist 快照重建；同一查询两次结果逐字节一致（Correctness Property）。
import type { App } from '../app.ts';
import type { GameEvent, EventLog } from '../persistence/events.ts';
import { rebuildState, structuredHash } from '../world/apply.ts';
import { buildTimeline, type WatchTarget } from './director.ts';
import type { CameraShot } from './index.ts';

export interface ReplayQuery {
  /** 观战目标：'events'（全事件流）或 'agent:<uid>' */
  watch?: WatchTarget;
  /** 最近 N 个事件（缺省 200） */
  events?: number;
  /** 场景号（agent.pos 缺省场景兜底） */
  scene?: number;
}

export interface ReplayResult {
  watch: WatchTarget;
  fromSeq: number;
  toSeq: number;
  eventCount: number;
  shotCount: number;
  shots: CameraShot[];
  /** 重放终点状态的结构化域哈希（两次回放必一致 = 确定性判据） */
  endHash: string;
  /** 快照起点（重建基准） */
  snapshotSeq: number | null;
}

export function runReplay(app: App, q: ReplayQuery = {}): ReplayResult {
  const log: EventLog = app.log;
  const watch: WatchTarget = q.watch || 'events';
  const scene = q.scene ?? 2;
  const limit = Math.max(1, Math.min(2000, q.events ?? 200));
  const snap = log.lastSnapshot();
  const since = snap ? snap.seq : 0;
  const all = log.since(since);
  const events: GameEvent[] = all.slice(-limit);
  const fromSeq = events.length ? events[0].seq : since;

  const shots = buildTimeline(events, watch, scene);

  // 重放终点状态哈希（结构化域；noPersist 重建，绝不写盘）
  const rebuilt = rebuildState(snap ? snap.state : null, events, app.stateOpts, app.tables);
  const endHash = structuredHash(rebuilt);

  return {
    watch,
    fromSeq,
    toSeq: log.lastEventSeq,
    eventCount: events.length,
    shotCount: shots.length,
    shots,
    endHash,
    snapshotSeq: snap ? snap.seq : null,
  };
}

/** 确定性自检：同一查询跑两次，结果 JSON 完全一致 */
export function verifyReplayDeterminism(app: App, q: ReplayQuery = {}): { deterministic: boolean; a: string; b: string } {
  const a = JSON.stringify(runReplay(app, q));
  const b = JSON.stringify(runReplay(app, q));
  return { deterministic: a === b, a, b };
}
