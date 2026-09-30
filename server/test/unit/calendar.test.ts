// test/unit/calendar.test.ts —— B8 历法/天气/季节 + 日切换执行器
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from '../../src/app.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog } from '../../src/persistence/events.ts';
import { Tables } from '../../src/world/tables.ts';
import {
  calendarDay, seasonOf, weatherOf, festivalOf, growthMultOf, isStormVictim,
  ensureDayAnchor, currentGameDay, advanceGameDay,
} from '../../src/world/calendar.ts';
import { worldPlants } from '../../src/world/farm.ts';

const dirs: string[] = [];
function harness(growDayMs = 600_000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-cal-'));
  dirs.push(dir);
  const tables = new Tables(path.join(dir, 'data'));
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs, init: false };
  const state = new WorldState(opts);
  const db = openDb(path.join(dir, 'events.db'));
  const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
  log.init();
  log.takeSnapshot();
  const app = { state, tables, db, log } as unknown as App;
  return { dir, app, db, state, log };
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

describe('历法纯函数', () => {
  it('季节 10 天制循环', () => {
    expect(seasonOf(0)).toBe('spring');
    expect(seasonOf(9)).toBe('spring');
    expect(seasonOf(10)).toBe('summer');
    expect(seasonOf(39)).toBe('winter');
    expect(seasonOf(40)).toBe('spring');
    expect(seasonOf(-5)).toBe('winter'); // -5 mod 40 = 35 -> 冬季（安全取正）
  });

  it('节日：每季最后一天', () => {
    expect(festivalOf(9)).toBe('春花会');
    expect(festivalOf(19)).toBe('夏钓赛');
    expect(festivalOf(29)).toBe('秋丰收');
    expect(festivalOf(39)).toBe('冬雪雕');
    expect(festivalOf(8)).toBeNull();
  });

  it('天气确定性：同日同天气', () => {
    for (let d = 0; d < 100; d++) expect(weatherOf(d)).toBe(weatherOf(d));
    const cal = calendarDay(500);
    expect(['clear', 'rain', 'snow', 'storm']).toContain(cal.weather);
  });

  it('生长倍率：雨 1.5 / 雪 0.5 / 其他 1', () => {
    expect(growthMultOf('rain')).toBe(1.5);
    expect(growthMultOf('snow')).toBe(0.5);
    expect(growthMultOf('clear')).toBe(1);
    expect(growthMultOf('storm')).toBe(1);
  });

  it('风暴损毁确定性 + 约 20% 比例', () => {
    for (let u = 1; u <= 1000; u++) expect(isStormVictim(7, u)).toBe(isStormVictim(7, u));
    const n = Array.from({ length: 1000 }, (_, i) => isStormVictim(7, i + 1)).filter(Boolean).length;
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(300);
  });
});

describe('游戏日时钟', () => {
  it('锚点后按 growDay 计日', () => {
    const h = harness(1000);
    const t0 = 1_000_000;
    ensureDayAnchor(h.state, t0);
    expect(currentGameDay(h.state, t0)).toBe(0);
    expect(currentGameDay(h.state, t0 + 999)).toBe(0);
    expect(currentGameDay(h.state, t0 + 1000)).toBe(1);
    h.db.close();
  });
});

describe('advanceGameDay 日效应', () => {
  it('推进跨日：落 calendar.day 事件 + 幂等（同日不重复）', () => {
    const h = harness(1000);
    const t0 = 2_000_000;
    ensureDayAnchor(h.state, t0);
    const r1 = advanceGameDay(h.app as unknown as App, t0 + 1000);
    expect(r1.advanced).toBe(true);
    expect(r1.day).toBe(1);
    let evs = (h.log.since(0) as Array<{ type: string; payload: { day?: number } }>).filter(e => e.type === 'calendar.day');
    expect(evs.length).toBe(2); // 日 0（锚点日）+ 日 1
    expect(evs.map(e => e.payload.day)).toEqual([0, 1]);
    // 幂等
    const r2 = advanceGameDay(h.app as unknown as App, t0 + 1500);
    expect(r2.advanced).toBe(false);
    evs = (h.log.since(0) as Array<{ type: string }>).filter(e => e.type === 'calendar.day');
    expect(evs.length).toBe(2);
    h.db.close();
  });

  it('风暴日损毁露天作物 + 次日保险赔付', () => {
    const h = harness(1000);
    const gday = 1000;
    const nowBase = 50_000_000;
    // 找一个风暴日 S，且 S+1 非风暴（保证保险次日必发）
    let S = 0;
    for (let d = 1; d < 400; d++) if (weatherOf(d) === 'storm' && weatherOf(d + 1) !== 'storm') { S = d; break; }
    expect(S).toBeGreaterThan(0);
    // 该日必被毁的 uId
    let victimUId = 0;
    for (let u = 1; u < 500 && !victimUId; u++) if (isStormVictim(S, u)) victimUId = u;
    expect(victimUId).toBeGreaterThan(0);
    // 锚点使 S-1 为"已处理日"，advance 只推进 S 单日（无中间日干扰）
    h.state.globals.set('afDayAnchor', { val: nowBase - (S - 1) * gday });
    h.state.globals.set('afLastGameDay', { val: S - 1 });
    h.state.playersDb.set('u1', new Map());
    // 4 天作物（迷幻花 plantId 8）刚种下，未成熟
    worldPlants(h.state).push({ uId: victimUId, plantId: 8, x: 5, y: 5, farmType: 1, sownAt: nowBase + gday, growDay: 0, owner: 'u1' });
    // 推进到 S -> 损毁
    const r1 = advanceGameDay(h.app as unknown as App, nowBase + gday);
    expect(r1.day).toBe(S);
    expect(worldPlants(h.state).filter(p => p.uId === victimUId).length).toBe(0);
    expect(h.log.since(0).filter(e => e.type === 'crop.stormDamaged').length).toBe(1);
    // 次日 -> 保险赔付
    advanceGameDay(h.app as unknown as App, nowBase + 2 * gday);
    const ins = h.log.since(0).filter(e => e.type === 'crop.insurance');
    expect(ins.length).toBe(1);
    expect(ins[0].payload.uId).toBe(victimUId);
    expect(knapHas(h.state, 'u1', 10)).toBe(true);
    h.db.close();
  });
});

function knapHas(state: WorldState, uid: string, n: number): boolean {
  const kn = state.playersDb.get(uid)?.get('knapData') as { props?: Array<{ id: number; num?: number }> } | undefined;
  return (kn?.props?.find(p => p.id === 1)?.num ?? 0) >= n;
}
