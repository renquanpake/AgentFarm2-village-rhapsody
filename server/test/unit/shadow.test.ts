// test/unit/shadow.test.ts —— B4 影子模式（双实例镜像 + 自成流动性 + 对比报告 + 重启恢复）
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
import { MarketService } from '../../src/market/service.ts';
import { ShadowMarket } from '../../src/market/shadow.ts';

interface H { dir: string; app: App; market: MarketService; shadow: ShadowMarket; state: WorldState; db: import('node:sqlite').DatabaseSync; }
const dirs: string[] = [];
function harness(): H {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-shd-'));
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
  const shadow = new ShadowMarket(app);
  (app as unknown as { market: MarketService; shadow: ShadowMarket }).market = market;
  (app as unknown as { market: MarketService; shadow: ShadowMarket }).shadow = shadow;
  market.attachShadow(shadow);
  market.load();
  shadow.load();
  return { dir, app, market, shadow, state, db };
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

describe('影子镜像与自成流动性', () => {
  it('实盘成交时影子簿同镜像出成交（自成做市，maker 可不同）', () => {
    const h = harness();
    h.state.playersDb.set('u1', new Map());
    h.state.playersDb.set('u2', new Map());
    knapAdd(h.state.playersDb.get('u1')!, 12, 3);   // u1 卖 3
    knapAdd(h.state.playersDb.get('u2')!, 1, 500);  // u2 买
    h.market.place('u1', 12, 'sell', 53, 3);
    const r = h.market.place('u2', 12, 'buy', 53, 3);
    expect(r.fills!.length).toBe(1); // 实盘成交
    // 影子也应有成交（自成流动性撮合）
    const shadowFills = h.db.prepare('SELECT COUNT(*) n FROM market_shadow_fills').get() as { n: number };
    expect(shadowFills.n).toBe(1);
    const f = h.db.prepare('SELECT * FROM market_shadow_fills').get() as { price: number; qty: number };
    expect(f.price).toBe(53);
    expect(f.qty).toBe(3);
    h.db.close();
  });

  it('实盘做市商 mm 不镜像进影子（影子自成流动性）', () => {
    const h = harness();
    const out = h.shadow.mirrorPlace('mm', 12, 'buy', 47, 10);
    expect(out.length).toBe(0);
    const n = (h.db.prepare('SELECT COUNT(*) n FROM market_shadow_fills').get() as { n: number }).n;
    expect(n).toBe(0);
    h.db.close();
  });

  it('D8：实盘 mm 主导成交被影子紧镜像跟随（量/价对称）', () => {
    const h = harness();
    h.state.playersDb.set('u1', new Map());
    knapAdd(h.state.playersDb.get('u1')!, 1, 400); // 现金
    // 实盘冷启动挂 mm 双边（marketView 触发 ensureMaker）；taker 买单直接吃实盘 mm ask（mm 驱动成交）
    const ask = h.market.marketView(12).book.asks[0].price;
    const r = h.market.place('u1', 12, 'buy', ask, 3);
    expect(r.fills!.length).toBe(1);
    expect(r.fills![0].maker).toBe('mm');
    const n = (h.db.prepare('SELECT COUNT(*) n FROM market_shadow_fills').get() as { n: number }).n;
    expect(n).toBe(1); // 旧逻辑（基价锚点+宽价差）此处为 0
    const f = h.db.prepare('SELECT price, qty FROM market_shadow_fills').get() as { price: number; qty: number };
    expect(f.price).toBe(ask); // 锚点=实盘 best ask，非 basePrice±8%
    expect(f.qty).toBe(3);
    const rep = h.shadow.report(14);
    expect(rep[0].volumeDeviation).toBe(0);
    expect(rep[0].priceSpreadPct ?? 0).toBeLessThan(15);
    h.db.close();
  });

  it('D8：mm-shadow 深度耗尽后按缺口补挂，后续 taker 仍跟随', () => {
    const h = harness();
    h.state.playersDb.set('u1', new Map());
    knapAdd(h.state.playersDb.get('u1')!, 1, 1000);
    const mk = new ShadowMarket(h.app as App, { makerQty: 2 });
    h.market.attachShadow(mk); // 换小深度实例：两轮 taker 各需补挂
    const ask = h.market.marketView(12).book.asks[0].price;
    const r1 = h.market.place('u1', 12, 'buy', ask, 2);
    expect(r1.fills!.length).toBe(1);
    // 第二轮 taker：实盘 mm 深度仍足（MM_MAX_QTY=50），但影子深度 2 已耗尽 -> 靠补挂跟随
    const r2 = h.market.place('u1', 12, 'buy', ask, 2);
    expect(r2.fills!.length).toBe(1);
    const n = (h.db.prepare('SELECT COUNT(*) n FROM market_shadow_fills').get() as { n: number }).n;
    expect(n).toBe(2); // 旧逻辑首成交后停挂 -> 第二轮 0
    h.db.close();
  });

  it('D8：报价锚点跟随实盘漂移（撤旧 mm ask 后重挂高位）', () => {
    const h = harness();
    h.state.playersDb.set('u1', new Map());
    knapAdd(h.state.playersDb.get('u1')!, 1, 1000);
    const b = h.market.marketView(12).book; // 触发实盘冷启动做市
    const mmAskId = h.market.bookOf(12).openOrders().find(o => o.owner === 'mm' && o.side === 'sell')!.id;
    h.market.cancel('mm', 12, mmAskId); // 撤实盘旧 mm ask -> 盘口上移
    h.market.place('mm', 12, 'sell', 90, 5); // 实盘 best ask = 90
    const r = h.market.place('u1', 12, 'buy', 90, 1);
    expect(r.fills!.length).toBe(1);
    expect(r.fills![0].price).toBe(90);
    const f = h.db.prepare('SELECT price FROM market_shadow_fills ORDER BY ts DESC LIMIT 1').get() as { price: number };
    expect(f.price).toBe(90); // 旧逻辑锚 basePrice -> 影子成交 54 左右，偏差 ~40%
    h.db.close();
  });
});

describe('对比报告', () => {
  it('实盘/影子量与价可聚合，偏差计算正确', () => {
    const h = harness();
    h.state.playersDb.set('u1', new Map());
    h.state.playersDb.set('u2', new Map());
    knapAdd(h.state.playersDb.get('u1')!, 12, 3);
    knapAdd(h.state.playersDb.get('u2')!, 1, 500);
    h.market.place('u1', 12, 'sell', 53, 3);
    h.market.place('u2', 12, 'buy', 53, 3);
    const rep = h.shadow.report(14);
    expect(rep.length).toBe(1);
    expect(rep[0].item).toBe(12);
    expect(rep[0].liveVolume).toBe(3);
    expect(rep[0].shadowVolume).toBe(3);
    expect(rep[0].volumeDeviation).toBe(0);
    expect(rep[0].livePriceMean).toBe(53);
    expect(rep[0].shadowPriceMean).toBe(53);
    h.db.close();
  });

  it('无成交时报告为空', () => {
    const h = harness();
    expect(h.shadow.report(14).length).toBe(0);
    h.db.close();
  });
});

describe('重启恢复', () => {
  it('load() 恢复实盘挂单镜像 + 影子成交历史', () => {
    const h = harness();
    h.state.playersDb.set('u1', new Map());
    knapAdd(h.state.playersDb.get('u1')!, 12, 5);
    // 高位挂单不穿越 -> 落簿（实盘 + 影子都镜像）
    const r = h.market.place('u1', 12, 'sell', 500, 5);
    expect(r.resting).toBe(5);
    h.db.close();
    // 重启：新 harness 同 dir
    const h2 = harness2(h.dir);
    expect(h2.shadow.bookOf(12).openCount()).toBeGreaterThan(0); // 实盘挂单已镜像
    h2.db.close();
  });
});

// 同 dir 重建（模拟重启）
function harness2(dir: string): H {
  const tables = new Tables(path.join(dir, 'data'));
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 600000, init: false };
  const state = new WorldState(opts);
  const db = openDb(path.join(dir, 'events.db'));
  const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
  log.init();
  const app = { state, tables, db, log } as unknown as App;
  const market = new MarketService(app);
  const shadow = new ShadowMarket(app);
  (app as unknown as { market: MarketService; shadow: ShadowMarket }).market = market;
  (app as unknown as { market: MarketService; shadow: ShadowMarket }).shadow = shadow;
  market.attachShadow(shadow);
  market.load();
  shadow.load();
  return { dir, app, market, shadow, state, db };
}
