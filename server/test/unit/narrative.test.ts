// test/unit/narrative.test.ts —— M1 导演镜头与确定性回放（A8/A10 服务端核心）
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from '../../src/app.ts';
import type { GameEvent } from '../../src/persistence/events.ts';

import { eventPos, buildTimeline, CameraDirector } from '../../src/narrative/director.ts';
import { runReplay, verifyReplayDeterminism } from '../../src/narrative/replay.ts';
import { buildDailyReport } from '../../src/narrative/report.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog } from '../../src/persistence/events.ts';
import { Tables } from '../../src/world/tables.ts';

const dirs: string[] = [];
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-nd-'));
  dirs.push(dir);
  const tables = new Tables(path.join(dir, 'data'));
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 600000, init: false };
  const state = new WorldState(opts);
  const db = openDb(path.join(dir, 'events.db'));
  const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
  log.init();
  log.takeSnapshot();
  const fake = { log, stateOpts: opts, tables, state, db } as unknown as App;
  return { dir, fake, log, state, db, opts };
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

const ev = (seq: number, type: string, actor: string, payload: Record<string, unknown>, seed?: number): GameEvent =>
  ({ seq, ts: 0, type, actor, payload, seed: seed ?? null });

describe('eventPos 事件->坐标', () => {
  it('agent.pos 直读像素坐标', () => {
    expect(eventPos(ev(1, 'agent.pos', 'u1', { x: 3550, y: 3050, scene: 2 }))).toEqual({ x: 3550, y: 3050, scene: 2 });
  });
  it('plant.sown/plot.tilled 格子转像素', () => {
    expect(eventPos(ev(1, 'plot.tilled', 'u1', { x: 5, y: 5, owner: 'u1' }))).toEqual({ x: 550, y: 550, scene: 2 });
  });
  it('无位置语义事件为 null', () => {
    expect(eventPos(ev(1, 'chat.msg', 'u1', { nick: '甲', text: 'hi' }))).toBeNull();
  });
});

describe('buildTimeline（纯函数、可重放）', () => {
  const events: GameEvent[] = [
    ev(1, 'agent.pos', 'u1', { x: 100, y: 100, scene: 2 }),
    ev(2, 'chat.msg', 'u1', { nick: '甲', text: 'hi' }),
    ev(3, 'plant.sown', 'u1', { uId: 9, plantId: 1, x: 3, y: 3, sownAt: 1000 }),
    ev(4, 'agent.pos', 'u2', { x: 900, y: 900, scene: 2 }),
    ev(5, 'crop.harvested', 'u1', { uId: 9 }),
  ];

  it('观战 agent 只收其自身事件', () => {
    const shots = buildTimeline(events, 'agent:u1');
    // agent.pos(u1) + plant.sown(u1) + crop.harvested(u1, 坐标取最近 agent.pos 兜底) = 3
    expect(shots.length).toBe(3);
    expect(shots.every(s => s.kind === 'follow_agent' && s.target === 'u1')).toBe(true);
  });

  it('观战事件流只出有位置语义的镜头（无坐标兜底）', () => {
    const shots = buildTimeline(events, 'events');
    // 仅 plant.sown（有格子坐标）；crop.harvested 无坐标在 events 模式不出镜头
    expect(shots.length).toBe(1);
    expect(shots.every(s => s.kind === 'focus_event')).toBe(true);
  });

  it('同输入必同输出（确定性）', () => {
    expect(JSON.stringify(buildTimeline(events, 'agent:u1'))).toBe(JSON.stringify(buildTimeline(events, 'agent:u1')));
  });

  it('fish.caught 无坐标时用最近 agent.pos 兜底', () => {
    const evs: GameEvent[] = [
      ev(1, 'agent.pos', 'u9', { x: 500, y: 500, scene: 2 }),
      ev(2, 'fish.caught', 'u9', { uid: 'u9', itemId: 19, seed: 7 }),
    ];
    const shots = buildTimeline(evs, 'agent:u9');
    expect(shots[shots.length - 1]).toMatchObject({ kind: 'follow_agent', x: 500, y: 500 });
  });
});

describe('CameraDirector（实时观战推送）', () => {
  it('setWatch 后事件触发推送；节流窗口内不重复推', () => {
    const h = harness();
    const pushed: Array<{ sp: string; x: number }> = [];
    const dir = new CameraDirector({
      scene: 2,
      onPush: (sp, shot) => pushed.push({ sp, x: shot.x ?? 0 }),
    });
    dir.setWatch('spec1', 'agent:u1');
    dir.ingest(ev(1, 'agent.pos', 'u1', { x: 100, y: 100, scene: 2 }));
    dir.ingest(ev(2, 'agent.pos', 'u1', { x: 200, y: 200, scene: 2 })); // 节流内，不推
    expect(pushed.length).toBe(1);
    expect(pushed[0]).toEqual({ sp: 'spec1', x: 100 });
    h.db.close();
  });
});

describe('确定性回放（M1.4）', () => {
  it('同一查询两次回放结果逐字节一致（含状态哈希）', () => {
    const h = harness();
    h.log.append('plant.sown', 'u1', { uId: 1, plantId: 1, x: 2, y: 2, sownAt: 1 });
    h.log.append('agent.pos', 'u1', { x: 250, y: 250, scene: 2 });
    h.log.append('crop.harvested', 'u1', { uId: 1 });
    const v = verifyReplayDeterminism(h.fake as unknown as App, { watch: 'events', events: 50 });
    expect(v.deterministic).toBe(true);
    const r1 = runReplay(h.fake as unknown as App, { watch: 'agent:u1', events: 50 });
    const r2 = runReplay(h.fake as unknown as App, { watch: 'agent:u1', events: 50 });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.eventCount).toBe(3);
    expect(r1.shotCount).toBeGreaterThanOrEqual(2);
    expect(r1.endHash).toMatch(/^[0-9a-f]{64}$/);
    h.db.close();
  });
});

describe('buildDailyReport（A9 聚合骨架）', () => {
  const events: GameEvent[] = [
    ev(1, 'chat.msg', 'u1', { nick: '甲', text: 'hi' }),
    ev(2, 'plant.sown', 'u1', { uId: 3, plantId: 1, x: 2, y: 2, sownAt: 0 }),
    ev(3, 'plant.sown', 'u2', { uId: 4, plantId: 2, x: 3, y: 3, sownAt: 0 }),
    ev(4, 'crop.harvested', 'u1', { uId: 3 }),
  ];

  it('聚合 byType / 玩家排行（确定性排序）', () => {
    const r = buildDailyReport(events);
    expect(r.eventCount).toBe(4);
    expect(r.byType['plant.sown']).toBe(2);
    expect(r.byType['chat.msg']).toBe(1);
    expect(r.players[0].uid).toBe('u1'); // u1=3 > u2=1
    expect(r.players[0].byType['plant.sown']).toBe(1);
  });

  it('highlights 只收有位置语义事件且限窗', () => {
    const r = buildDailyReport(events, { maxHighlights: 1 });
    expect(r.highlights.length).toBe(1);
    expect(r.highlights[0].type).toBe('plant.sown'); // 最后一个有坐标的
    expect(r.highlights[0].x).toBe(350); // 格子 3*100+50
  });

  it('同输入必同 reportHash（可离线重放）', () => {
    expect(buildDailyReport(events).reportHash).toBe(buildDailyReport(events).reportHash);
  });
});
