// test/unit/market.test.ts —— B1.2 市场服务（做市冷启动 / 挂单预留 / 成交过户 / 持久化 / OHLC）
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from '../../src/app.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog } from '../../src/persistence/events.ts';
import { Tables } from '../../src/world/tables.ts';
import { knapAdd, knapHas } from '../../src/world/farm.ts';
import { MarketService } from '../../src/market/service.ts';

interface H { dir: string; app: App; market: MarketService; state: WorldState; db: import('node:sqlite').DatabaseSync; log: EventLog; }
const dirs: string[] = [];
function harness(): H {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-mkt-'));
  dirs.push(dir);
  const tables = new Tables(path.join(dir, 'data'));
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 600000, init: false };
  const state = new WorldState(opts);
  const db = openDb(path.join(dir, 'events.db'));
  const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
  log.init();
  log.takeSnapshot();
  const app = { state, tables, db, log } as unknown as App;
  const market = new MarketService(app);
  market.load();
  return { dir, app, market, state, db, log };
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

const pm = (h: H, uid: string) => h.state.playersDb.get(uid)!;
function give(h: H, uid: string, itemId: number, n: number) {
  if (!h.state.playersDb.has(uid)) h.state.playersDb.set(uid, new Map());
  knapAdd(pm(h, uid), itemId, n);
}

describe('做市冷启动', () => {
  it('空簿自动挂 mm 双边单；吃做市卖盘成交且 mm 不记账', () => {
    const h = harness();
    give(h, 'u1', 1, 1000);
    const v = h.market.marketView(12);
    expect(v.book.bids.length).toBe(1);
    expect(v.book.asks.length).toBe(1);
    const ask = v.book.asks[0].price;
    const r = h.market.place('u1', 12, 'buy', ask + 1, 2);
    expect(r.ok).toBe(true);
    expect(r.fills!.length).toBe(1);
    expect(r.fills![0].maker).toBe('mm');
    expect(r.fills![0].price).toBe(ask);
    expect(knapHas(pm(h, 'u1'), 12, 2)).toBe(true); // 买到物品
    h.db.close();
  });
});

describe('挂单预留与撤单退还', () => {
  it('买单预留现金；撤单全额退还', () => {
    const h = harness();
    give(h, 'u1', 1, 20000);
    // 挂买卖盘中间价（不穿越做市商）-> 必落簿
    const px = h.market.basePrice(12);
    const r = h.market.place('u1', 12, 'buy', px, 10);
    expect(r.ok).toBe(true);
    expect(r.fills!.length).toBe(0);
    expect(r.resting).toBe(10);
    const cost = px * 10;
    expect(knapHas(pm(h, 'u1'), 1, 20000 - cost)).toBe(true); // 预留后余现金
    const c = h.market.cancel('u1', 12, r.orderId!);
    expect(c.ok).toBe(true);
    expect(knapHas(pm(h, 'u1'), 1, 20000)).toBe(true); // 全额退还
    h.db.close();
  });

  it('现金不足拒单（不撮合不挂簿）', () => {
    const h = harness();
    give(h, 'u1', 1, 10);
    const r = h.market.place('u1', 12, 'buy', 100, 5); // 需 500
    expect(r.ok).toBe(false);
    h.db.close();
  });

  it('卖单预留物品', () => {
    const h = harness();
    give(h, 'u1', 12, 5);
    const r = h.market.place('u1', 12, 'sell', 1000, 3); // 高位不穿越
    expect(r.ok).toBe(true);
    expect(knapHas(pm(h, 'u1'), 12, 3)).toBe(false);
    expect(knapHas(pm(h, 'u1'), 12, 2)).toBe(true);
    h.db.close();
  });
});

describe('玩家间成交过户', () => {
  it('卖方收钱、买方收物（价取挂单方；同价 FIFO mm 先挂先吃，故挂低价吃单）', () => {
    const h = harness();
    give(h, 'u1', 12, 5);
    give(h, 'u2', 1, 1000);
    const base = h.market.basePrice(12);
    const sellPx = Math.round(base * 1.05) - 1; // 比做市卖盘低 1 -> 优先被吃
    const rs = h.market.place('u1', 12, 'sell', sellPx, 5);
    expect(rs.fills!.length).toBe(0); // 52 高于做市买盘 47，不穿越
    const rb = h.market.place('u2', 12, 'buy', sellPx, 2);
    expect(rb.fills!.length).toBe(1);
    expect(rb.fills![0].maker).toBe('u1');
    expect(rb.fills![0].taker).toBe('u2');
    expect(rb.fills![0].price).toBe(sellPx);
    expect(knapHas(pm(h, 'u2'), 12, 2)).toBe(true);   // 买方收物
    expect(knapHas(pm(h, 'u1'), 1, 2 * sellPx)).toBe(true); // 卖方收钱
    expect(rb.resting).toBe(0);
    h.db.close();
  });
});

describe('持久化与 OHLC', () => {
  it('重启 load() 恢复挂单与成交历史；OHLC 可查', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-mkt2-'));
    dirs.push(dir);
    const build = () => {
      const tables = new Tables(path.join(dir, 'data'));
      const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 600000, init: false };
      const state = new WorldState(opts);
      const db = openDb(path.join(dir, 'events.db'));
      const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
      log.init();
      const app = { state, tables, db, log } as unknown as App;
      return { app, state, db, market: new MarketService(app) };
    };
    const a = build();
    give(a, 'u1', 12, 5);
    give(a, 'u2', 1, 1000);
    const sellPx = Math.round(a.market.basePrice(12) * 1.05);
    a.market.place('u1', 12, 'sell', sellPx, 5);
    const rb = a.market.place('u2', 12, 'buy', sellPx, 2);
    expect(rb.fills!.length).toBe(1);
    const openBefore = a.market.bookOf(12).openCount();
    const fillsBefore = a.market.bookOf(12).recentFills(10).length;
    a.db.close();

    const b = build();
    b.market.load();
    expect(b.market.bookOf(12).openCount()).toBe(openBefore);
    expect(b.market.bookOf(12).recentFills(10).length).toBe(fillsBefore);
    const o = b.market.ohlc(12, 7);
    expect(o.length).toBe(1);
    expect(o[0].close).toBe(sellPx);
    expect(o[0].volume).toBe(2);
    b.db.close();
  });
});
