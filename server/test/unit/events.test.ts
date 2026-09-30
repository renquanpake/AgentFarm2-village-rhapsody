// test/unit/events.test.ts —— 事件溯源单元测试
// 覆盖：确定性随机 / 事件往返重放（哈希一致）/ 种子可回放 / 崩溃恢复 / 迁移幂等
// 设计：每用例独立临时目录 + 直接构造 WorldState/EventLog（不依赖 App 单例与 config 环境变量），互不串扰。
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { pickWeightedSeeded, mulberry32, freshSeed, canonicalJson, sha256 } from '../../src/world/rng.ts';
import { FISH_POOL, MINE_POOL, Tables } from '../../src/world/tables.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog } from '../../src/persistence/events.ts';
import { rebuildState, structuredHash, applyEvent } from '../../src/world/apply.ts';
import { worldPlants, worldPlots, knapAdd } from '../../src/world/farm.ts';
import { pairOf } from '../../src/world/social.ts';
import { tasksOf } from '../../src/world/tasks.ts';
import type { GameEvent } from '../../src/persistence/events.ts';

interface Harness {
  dir: string;
  state: WorldState;
  tables: Tables;
  log: EventLog;
  db: DatabaseSync;
  opts: StateOpts;
}

function freshHarness(): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-es-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  const tables = new Tables(path.join(dir, 'data')); // 空数据目录 -> 全 fallback
  const opts: StateOpts = {
    savesDir: path.join(dir, 'saves'),
    seedFile: '',
    slot: 1,
    farmLeft: 14,
    spawns: null,
    growDayMs: 600000,
    init: false,
  };
  const state = new WorldState(opts);
  const db = openDb(path.join(dir, 'events.db'));
  const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
  log.init();
  log.takeSnapshot(); // 基线快照（空状态）
  return { dir, state, tables, log, db, opts };
}

const dirs: string[] = [];
function use(h: Harness): Harness { dirs.push(h.dir); return h; }
afterAll(() => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
});

function assertReplayEquals(h: Harness): void {
  const snap = h.log.lastSnapshot()!;
  const events = h.log.since(snap.seq);
  const rebuilt = rebuildState(snap.state, events, h.opts, h.tables);
  expect(structuredHash(rebuilt)).toBe(structuredHash(h.state));
}

describe('确定性随机（回放基石）', () => {
  it('同 seed 必同序列（mulberry32）', () => {
    const a = Array.from({ length: 5 }, () => mulberry32(12345)());
    const b = Array.from({ length: 5 }, () => mulberry32(12345)());
    expect(a).toEqual(b);
  });

  it('pickWeightedSeeded 同 seed 同结果', () => {
    expect(pickWeightedSeeded(FISH_POOL, 7)).toBe(pickWeightedSeeded(FISH_POOL, 7));
    expect(pickWeightedSeeded(MINE_POOL, 999)).toBe(pickWeightedSeeded(MINE_POOL, 999));
  });

  it('不同 seed 结果有分化（种子真实影响结果）', () => {
    const distinct = new Set(Array.from({ length: 30 }, (_, i) => pickWeightedSeeded(MINE_POOL, i)));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('freshSeed 生成 31 位非负整数', () => {
    for (let i = 0; i < 50; i++) {
      const s = freshSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(0x7fffffff);
    }
  });
});

describe('事件往返重放（写事件 -> 快照+事件重建 -> 结构化域哈希一致）', () => {
  it('犁地/播种/好感/任务 全链路可重放且哈希一致', () => {
    const h = use(freshHarness());
    const { state, log } = h;

    // 与 ws.ts handler 同构：先改状态，再 append 对应事件
    state.playersDb.set('u_t', new Map()); // 玩家已"加入"
    worldPlots(state).push({ x: 5, y: 5, plantUID: 0, farmType: 1, owner: 'u_t' });
    log.append('plot.tilled', 'u_t', { x: 5, y: 5, owner: 'u_t' });

    worldPlants(state).push({ uId: 900, plantId: 1, x: 5, y: 5, hp: 10, farmType: 1, growDay: 0, sownAt: 1000 });
    log.append('plant.sown', 'u_t', { uId: 900, plantId: 1, x: 5, y: 5, sownAt: 1000 });
    log.append('item.consumed', 'u_t', { uid: 'u_t', itemId: 36, num: 1 });
    // 与 ws.ts 一致：播种后把该格 plot 关联到植物（applier 会做同样的事，live 须同步）
    const linkedPlot = worldPlots(state).find(pl => pl.x === 5 && pl.y === 5);
    if (linkedPlot) linkedPlot.plantUID = 900;

    pairOf(state, 'u_a', 'u_b').p.fav['u_a'] = 20;
    log.append('social.fav', 'u_a', { a: 'u_a', b: 'u_b', delta: 20 });

    const t = tasksOf(state, 'u_t');
    t.list['task4'] = { cur: 3, total: 3 };
    t.done['task4'] = true;
    log.append('task.progress', 'u_t', { uid: 'u_t', type: 'plant', n: 3 });

    assertReplayEquals(h);

    // 重建状态内容可核对
    const snap = log.lastSnapshot()!;
    const rebuilt = rebuildState(snap.state, log.since(snap.seq), h.opts, h.tables);
    expect(worldPlants(rebuilt).some(p => p.uId === 900 && p.plantId === 1)).toBe(true);
    expect(worldPlots(rebuilt).some(p => p.x === 5 && p.y === 5)).toBe(true);
    expect(pairOf(rebuilt, 'u_a', 'u_b').p.fav['u_a']).toBe(20);
    expect(rebuilt.playersDb.get('u_t')!.get('afTasks') as { done?: Record<string, boolean> })
      .toMatchObject({ done: { task4: true } });
  });

  it('作物播种/浇水/收获 事件可重放', () => {
    const h = use(freshHarness());
    const { state, log } = h;
    state.playersDb.set('u_w', new Map());
    // live 与 ws.ts handler 同构：改状态 + 对应事件
    worldPlants(state).push({ uId: 500, plantId: 1, x: 3, y: 3, hp: 10, farmType: 1, growDay: 0, sownAt: 1000 });
    log.append('plant.sown', 'u_w', { uId: 500, plantId: 1, x: 3, y: 3, sownAt: 1000 });
    // 镜像 ws.ts：plant handler 会调 worldPlots 关联地块（applier 同），触发 farmData 初始化
    const linked = worldPlots(state).find(pl => pl.x === 3 && pl.y === 3);
    if (linked) linked.plantUID = 500;
    const pl = worldPlants(state).find(p => p.uId === 500)!;
    pl.sownAt = 500;
    pl.growDay = 2;
    log.append('crop.watered', 'u_w', { uId: 500, sownAt: 500, growDay: 2 });
    // 中途重放：growDay 应为 2
    const snapMid = log.lastSnapshot()!;
    const rMid = rebuildState(snapMid.state, log.since(snapMid.seq), h.opts, h.tables);
    expect(worldPlants(rMid).find(p => p.uId === 500)?.growDay).toBe(2);
    // 收获
    worldPlants(state).splice(worldPlants(state).indexOf(pl), 1);
    knapAdd(state.playersDb.get('u_w'), 28, 1);
    log.append('crop.harvested', 'u_w', { uId: 500 });
    log.append('item.gained', 'u_w', { uid: 'u_w', itemId: 28, num: 1 });
    assertReplayEquals(h);
  });

  it('重放两次结果一致（回放确定性 Correctness Property）', () => {
    const h = use(freshHarness());
    const { state, log } = h;
    state.playersDb.set('u_d', new Map());
    const seed = 12345;
    const fid = pickWeightedSeeded(FISH_POOL, seed);
    knapAdd(state.playersDb.get('u_d'), fid, 1);
    log.append('fish.caught', 'u_d', { uid: 'u_d', itemId: fid, seed });
    assertReplayEquals(h);
    const snap = log.lastSnapshot()!;
    const r1 = rebuildState(snap.state, log.since(snap.seq), h.opts, h.tables);
    const r2 = rebuildState(snap.state, log.since(snap.seq), h.opts, h.tables);
    expect(sha256(canonicalJson(JSON.parse(r1.serialize())))).toBe(sha256(canonicalJson(JSON.parse(r2.serialize()))));
  });
});

describe('事件库持久化（崩溃恢复）', () => {
  it('关库重开：seq 不重置、事件完整、严格递增', () => {
    const h = use(freshHarness());
    const { state, log, db, opts, tables } = h;
    state.playersDb.set('u_p', new Map());
    log.append('chat.msg', 'u_p', { nick: '甲', text: '你好' });
    log.append('social.fav', 'u_p', { a: 'u_p', b: 'u_q', delta: 2 });
    const before = log.since(0).length;
    const lastSeq = log.lastEventSeq;
    db.close();

    // 重开同一文件
    const db2 = openDb(opts.savesDir ? path.join(h.dir, 'events.db') : h.dir);
    const log2 = new EventLog(db2, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
    log2.init();
    expect(log2.lastEventSeq).toBe(lastSeq);
    const after = log2.since(0);
    expect(after.length).toBe(before);
    for (let i = 1; i < after.length; i++) expect(after[i].seq).toBe(after[i - 1].seq + 1);
    // 重放重建一致性不受重开影响（仅验证可读回）
    const snap = log2.lastSnapshot()!;
    const rebuilt = rebuildState(snap.state, log2.since(snap.seq), opts, tables);
    expect(rebuilt).toBeInstanceOf(WorldState);
    db2.close();
  });
});

describe('applyEvent 边界', () => {
  it('未知事件类型重放跳过（前向兼容）', () => {
    const h = use(freshHarness());
    const ev: GameEvent = { seq: 99, ts: 0, type: 'future.some_event', actor: 'u_x', payload: {}, seed: null };
    expect(() => applyEvent(h.state, ev, h.tables)).not.toThrow();
  });

  it('ensurePlayer：玩家不在快照中时事件自动建档', () => {
    const h = use(freshHarness());
    const { state, log } = h;
    log.append('item.gained', 'u_new', { uid: 'u_new', itemId: 1, num: 100 });
    const snap = log.lastSnapshot()!;
    const rebuilt = rebuildState(snap.state, log.since(snap.seq), h.opts, h.tables);
    const kn = rebuilt.playersDb.get('u_new')?.get('knapData') as { props?: Array<{ id: number; num: number }> };
    expect(kn?.props?.find(x => x.id === 1)?.num).toBe(100);
  });
});

describe('migrations 幂等', () => {
  it('同一 DB 文件迁移多次不报错、表结构稳定', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-mig-'));
    dirs.push(dir);
    const f = path.join(dir, 'events.db');
    const d1 = openDb(f);
    d1.close();
    const d2 = openDb(f); // 第二次：迁移已应用，幂等
    const tables = (d2.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map(r => r.name);
    expect(tables).toEqual(expect.arrayContaining(['events', 'snapshots', 'schema_migrations']));
    d2.close();
  });
});
