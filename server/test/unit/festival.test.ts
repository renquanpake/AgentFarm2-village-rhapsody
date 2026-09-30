// test/unit/festival.test.ts —— B11 节日集市与比赛玩法
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from '../../src/app.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog } from '../../src/persistence/events.ts';
import { Tables } from '../../src/world/tables.ts';
import { knapAdd } from '../../src/world/farm.ts';
import { festivalCfg, activeFestival, stallFee, festivalMakerSpread, recordFestivalScore, settleFestival, snapshotFestivalDecor } from '../../src/world/festival.ts';
import { calendarDay, ensureDayAnchor } from '../../src/world/calendar.ts';

const dirs: string[] = [];
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-fest-'));
  dirs.push(dir);
  const tables = new Tables(path.join(dir, 'data'));
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 1000, init: false };
  const state = new WorldState(opts);
  const db = openDb(path.join(dir, 'events.db'));
  const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
  log.init();
  log.takeSnapshot();
  const app = { state, tables, db, log } as unknown as App;
  return { dir, app, state, db, log, tables, opts };
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

// 找一个节日日（day % 10 == 9）
function festivalDay() { return 9; }

describe('festivalCfg', () => {
  it('四季节日各配一赛制', () => {
    expect(festivalCfg('春花会').contest).toBe('decor');
    expect(festivalCfg('夏钓赛').contest).toBe('fishing');
    expect(festivalCfg('秋丰收').contest).toBe('harvest');
    expect(festivalCfg('冬雪雕').contest).toBe('decor');
  });
});

describe('activeFestival / stallFee / 议价', () => {
  it('节日日有集市，非节日日无', () => {
    const h = harness();
    ensureDayAnchor(h.state, 0);
    // day 9 -> 春花会
    const fest = activeFestival(h.app as unknown as App, 9 * 1000);
    expect(fest).toBe('春花会');
    expect(activeFestival(h.app as unknown as App, 5 * 1000)).toBeNull();
    h.db.close();
  });

  it('节日议价：做市价差收窄', () => {
    expect(festivalMakerSpread('春花会')).toBe(0.04);
    expect(festivalMakerSpread(null)).toBe(0.08);
  });

  it('摊位费 = 100 x 通胀系数（无成交时系数 1）', () => {
    const h = harness();
    expect(stallFee(h.app as unknown as App)).toBe(100);
    h.db.close();
  });
});

describe('比赛计分与结算', () => {
  it('钓鱼赛：夏钓赛日价值累计计分（非赛制日不计）', () => {
    const h = harness();
    h.state.globals.set('afDayAnchor', { val: 0 });
    // day19 = 夏钓赛
    recordFestivalScore(h.app as unknown as App, 'u1', 30, 'fishing', 19 * 1000);
    recordFestivalScore(h.app as unknown as App, 'u1', 20, 'fishing', 19 * 1000);
    const c = h.state.world.get('afFestivalContest') as { day: number; scores: Record<string, number> };
    expect(c.day).toBe(19);
    expect(c.scores['u1']).toBe(50);
    // 非钓鱼赛制日（春花会 day9 = decor）fishing 不计 -> 赛事状态不变
    recordFestivalScore(h.app as unknown as App, 'u1', 99, 'fishing', 9 * 1000);
    const c9 = h.state.world.get('afFestivalContest') as { day: number; scores: Record<string, number> };
    expect(c9.day).toBe(19); // 仍为夏钓赛，未被春花会覆盖
    expect(c9.scores['u1']).toBe(50);
    h.db.close();
  });

  it('settleFestival：非节日日结束 -> 结算发奖（幂等）', () => {
    const h = harness();
    h.state.globals.set('afDayAnchor', { val: 0 });
    // 手工放一个节日比赛状态（day9 春花会 decor，得分 u1=10, u2=5）
    h.state.world.set('afFestivalContest', { festival: '春花会', day: 9, scores: { u1: 10, u2: 5 } });
    knapAdd(h.state.playersDb.get('u1') ?? h.state.playersDb.set('u1', new Map()).get('u1')!, 1, 0);
    // day 10 时结算 day9
    const r = settleFestival(h.app as unknown as App, 10 * 1000);
    expect(r?.winner).toBe('u1');
    // u1 领奖（春花会 500）
    const coins = (h.state.playersDb.get('u1')!.get('knapData') as { props?: Array<{ id: number; num?: number }> })?.props?.find(p => p.id === 1)?.num ?? 0;
    expect(coins).toBe(500);
    // 幂等：再结算一次 -> null
    expect(settleFestival(h.app as unknown as App, 10 * 1000)).toBeNull();
    // 事件入库
    expect(h.log.since(0).filter(e => e.type === 'festival.result').length).toBe(1);
    h.db.close();
  });
});
