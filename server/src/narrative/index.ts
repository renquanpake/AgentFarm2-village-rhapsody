// narrative/ —— M1 旁观体验层（导演镜头 / AI 画报日报 / 事件溯源回放）
// A8/A10 服务端核心已落地；画报日报（A9）的 LLM 生成 + 生图插画待 M4/M7 编排接入。
//
// 设计要点（见 design.md M1）：
//   - 导演镜头（M1.1）：玩家"观战"某 agent 或事件流，服务端按事件时间线推送镜头指令（director.ts）。
//   - 画报日报（M1.3）：日切换聚合事件 -> LLM 生成栏目化文章 -> 配生图插画（此处先给结构，内容待接 LLM）。
//   - 确定性回放（M1.4）：快照 + 事件重放，同一查询两次结果一致（replay.ts）。
import type { App } from '../app.ts';
import { CameraDirector, buildTimeline, type WatchTarget } from './director.ts';
import { runReplay, type ReplayResult, type ReplayQuery } from './replay.ts';
import type { GameEvent } from '../persistence/events.ts';

export interface CameraShot {
  target: string;
  kind: 'follow_player' | 'follow_agent' | 'focus_event';
  scene?: number;
  x?: number;
  y?: number;
  holdMs?: number;
  /** 想法气泡：观战 agent 的当前活动/意图（M1.2；来自服务端 actState） */
  thought?: string;
}

export interface DailyPaper {
  day: number;
  sections: Array<{ key: string; title: string; text: string; image?: string }>;
}

export interface NarrativeService {
  /** 观战某目标：返回其最近镜头时间线（纯函数，可重放） */
  nextCamera(events: GameEvent[], watch: WatchTarget, scene?: number): CameraShot[];
  /** 生成某日画报（当前为事件聚合骨架；LLM 文案 + 插画待 M4/M7 接入） */
  dailyPaper(day: number): DailyPaper;
  /** 确定性回放：快照 + 事件 -> 镜头时间线 + 终点状态哈希 */
  replay(query?: ReplayQuery): ReplayResult;
  /** 实时导演（EventLog.listen 驱动，向观战者推镜头） */
  liveDirector: CameraDirector;
}

export function createNarrativeService(app: App): NarrativeService {
  const liveDirector = new CameraDirector({
    scene: 2,
    onPush: (spectatorUid, shot, watch) => {
      // 想法气泡（M1.2）：跟随 agent 时附带其当前活动/意图（服务端 actState）
      if (shot.kind === 'follow_agent') {
        const act = app.state.actState.get(shot.target);
        if (act?.text) shot.thought = act.text;
      }
      const p = app.state.online.get(spectatorUid);
      if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'camera', shot, watch }));
    },
  });
  return {
    nextCamera: (events, watch, scene = 2) => buildTimeline(events, watch, scene),
    dailyPaper: (day) => ({ day, sections: [] }), // 骨架：M1.3 由 LLM 编排填充
    replay: (q) => runReplay(app, q),
    liveDirector,
  };
}

// 兼容旧引用：一个惰性默认实例（无 app 时 nextCamera 仍可用纯函数路径）
export const narrativeService: NarrativeService = {
  nextCamera: (events, watch, scene = 2) => buildTimeline(events, watch, scene),
  dailyPaper: (day) => ({ day, sections: [] }),
  replay: () => ({ watch: 'events', fromSeq: 0, toSeq: 0, eventCount: 0, shotCount: 0, shots: [], endHash: '', snapshotSeq: null }),
  liveDirector: new CameraDirector({ onPush: () => { /* 无 app，不推送 */ } }),
};
