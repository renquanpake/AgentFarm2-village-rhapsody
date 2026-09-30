// test/unit/economy.test.ts —— B3 货币治理（中位数 / 通胀指数 / 回收档位 / 货币总量）
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
import { median, feeMultiplier, economyReport, moneySupplyOf, computeInflation } from '../../src/market/economy.ts';

const dirs: string[] = [];
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-eco-'));
  dirs.push(dir);
  const tables = new Tables(path.join(dir, 'data'));
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 600000, init: false };
  const state = new WorldState(opts);
  const db = openDb(path.join(dir, 'events.db'));
  const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
  log.init();
  log.takeSnapshot();
  const app = { state, tables, db, log } as unknown as App;
  return { dir, app, db, state, log };
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

describe('median / feeMultiplier（纯函数）', () => {
  it('中位数奇偶', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('回收档位单调且封顶 1.5', () => {
    expect(feeMultiplier(null)).toBe(1.0);
    expect(feeMultiplier(1.0)).toBe(1.0);
    expect(feeMultiplier(1.11)).toBe(1.15);
    expect(feeMultiplier(1.31)).toBe(1.3);
    expect(feeMultiplier(2.0)).toBe(1.5);
  });
});

describe('货币总量', () => {
  it('玩家背包现金 + 商人台账现金之和', () => {
    const h = harness();
    h.state.playersDb.set('u1', new Map());
    knapAdd(h.state.playersDb.get('u1')!, 1, 300);
    h.db.prepare("INSERT INTO merchants (id,name,home_scene,risk_appetite,cash,inventory,item_id,last_cycle,updated_at) VALUES (4,'屠夫',2,0.3,500,30,19,0,0)").run();
    expect(moneySupplyOf(h.state, h.db)).toBe(800);
    h.db.close();
  });
});

describe('通胀指数与报告', () => {
  it('当日中位数 > 前 7 日 -> 指数 >1 -> 触发回收档位', () => {
    const h = harness();
    const now = Date.now();
    // 前 7 日成交价 100
    for (let i = 1; i <= 7; i++) h.db.prepare('INSERT INTO market_fills (item_id,price,qty,maker,taker,ts) VALUES (12,?,1,?, ?, ?)').run(100, 'mm', 'u1', now - i * 86_400_000);
    // 当日成交价 145
    h.db.prepare('INSERT INTO market_fills (item_id,price,qty,maker,taker,ts) VALUES (12,145,2,?, ?, ?)').run('u1', 'u2', now);
    const inf = computeInflation(h.app as unknown as App);
    expect(inf.todayMedian).toBe(145);
    expect(inf.weekMedian).toBe(100);
    expect(inf.index).toBeCloseTo(1.45);
    const rep = economyReport(h.app as unknown as App);
    expect(rep.feeMultiplier).toBe(1.3); // 1.3 < 1.45 <= 1.5 -> 1.3x 档
    expect(rep.alerts.length).toBeGreaterThan(0);
    h.db.close();
  });

  it('无成交数据 -> 指数 null、无回收', () => {
    const h = harness();
    const rep = economyReport(h.app as unknown as App);
    expect(rep.inflationIndex).toBeNull();
    expect(rep.feeMultiplier).toBe(1.0);
    expect(rep.alerts.length).toBe(0);
    h.db.close();
  });
});
