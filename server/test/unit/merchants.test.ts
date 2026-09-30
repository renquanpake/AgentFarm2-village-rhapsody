// test/unit/merchants.test.ts —— B2 NPC 商人策略与决策周期
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from '../../src/app.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog } from '../../src/persistence/events.ts';
import { Tables } from '../../src/world/tables.ts';
import { MarketService, type OhlcRow } from '../../src/market/service.ts';
import { merchantDecision, ohlcMomentum, ensureMerchants, runMerchantCycle, MERCHANT_SEED, LIQUIDATE_THRESHOLD } from '../../src/market/merchants.ts';

const dirs: string[] = [];
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-mch-'));
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
  return { dir, app, market, db, state, log };
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

const mkOhlc = (closes: number[]): OhlcRow[] =>
  closes.map((c, i) => ({ day: i, open: c, high: c, low: c, close: c, volume: 10 }));

describe('ohlcMomentum', () => {
  it('首末收盘差 / 首日收盘；不足 2 日为 0', () => {
    expect(ohlcMomentum(mkOhlc([100, 110]))).toBeCloseTo(0.1);
    expect(ohlcMomentum(mkOhlc([100]))).toBe(0);
    expect(ohlcMomentum(mkOhlc([]))).toBe(0);
  });
});

describe('merchantDecision（纯策略）', () => {
  const base = 100;
  it('动量 > +5% 看多：限价 base*(1-2%) 吃卖盘，数量受 risk 限额约束', () => {
    const d = merchantDecision({ risk_appetite: 0.3, cash: 2000, inventory: 0 }, base, mkOhlc([100, 110]));
    expect(d.op).toBe('buy');
    expect(d.price).toBe(98);
    expect(d.qty).toBe(15); // capQty=ceil(0.3*50)=15，现金 2000/98 足够 -> 限额绑定
  });

  it('看多但现金不够 -> 数量受现金约束（低于限额）', () => {
    const d = merchantDecision({ risk_appetite: 0.5, cash: 490, inventory: 0 }, base, mkOhlc([100, 110]));
    expect(d.op).toBe('buy');
    expect(d.qty).toBe(5); // min(capQty25, floor(490/98)=5)
  });

  it('动量 < -5% 且持库存：限价 base*(1+2%) 挂卖，数量受限额约束', () => {
    const d = merchantDecision({ risk_appetite: 0.5, cash: 500, inventory: 40 }, base, mkOhlc([100, 90]));
    expect(d.op).toBe('sell');
    expect(d.price).toBe(102);
    expect(d.qty).toBe(25); // min(capQty25, inv40)
  });

  it('区间震荡：hold 不动', () => {
    const d = merchantDecision({ risk_appetite: 0.5, cash: 500, inventory: 20 }, base, mkOhlc([100, 102]));
    expect(d.op).toBe('hold');
    expect(d.qty).toBe(0);
  });

  it('破产保护：现金 < 清仓线且有库存 -> 清仓（低于基价 2%，可超限额）', () => {
    const d = merchantDecision({ risk_appetite: 0.5, cash: LIQUIDATE_THRESHOLD - 1, inventory: 30 }, base, mkOhlc([100, 120]));
    expect(d.op).toBe('sell');
    expect(d.price).toBe(98);
    expect(d.qty).toBe(30); // min(inv30, capQty*2=50)
  });

  it('停采线：现金低位无库存 -> 观望', () => {
    const d = merchantDecision({ risk_appetite: 0.5, cash: 90, inventory: 0 }, base, mkOhlc([100, 120]));
    expect(d.op).toBe('hold');
    expect(d.reason).toMatch(/现金低位/);
  });
});

describe('决策周期（集成）', () => {
  it('首启发行种子台账；周期挂单走台账预留', () => {
    const h = harness();
    const rows = ensureMerchants(h.db);
    expect(rows.length).toBe(MERCHANT_SEED.length);
    // 造 7 日上涨 OHLC（成交记录）
    const item = MERCHANT_SEED[0].item_id;
    for (const px of [100, 104, 108, 112, 116, 120, 124]) {
      h.db.prepare('INSERT INTO market_fills (item_id, price, qty, maker, taker, ts) VALUES (?, ?, 1, ?, ?, ?)')
        .run(item, px, 'mm', 'uX', Date.now() - (7 - Math.round(px / 20)) * 86_400_000);
    }
    const app2 = h.app;
    (app2 as unknown as { market: MarketService }).market = h.market;
    const placed = runMerchantCycle(app2 as unknown as App);
    expect(placed).toBeGreaterThanOrEqual(1); // 至少屠夫看多买入
    // 台账现金被预留扣减
    const butcher = ensureMerchants(h.db).find(r => r.name === '屠夫')!;
    expect(butcher.cash).toBeLessThan(MERCHANT_SEED[0].cash);
    expect(butcher.last_cycle).toBeGreaterThan(0);
    h.db.close();
  });

  it('频控：60s 内二次周期不重复挂单', () => {
    const h = harness();
    ensureMerchants(h.db);
    (h.app as unknown as { market: MarketService }).market = h.market;
    runMerchantCycle(h.app as unknown as App);
    const openCount = h.market.bookOf(MERCHANT_SEED[0].item_id).openCount();
    const n2 = runMerchantCycle(h.app as unknown as App);
    expect(n2).toBe(0); // 全部被频控跳过
    expect(h.market.bookOf(MERCHANT_SEED[0].item_id).openCount()).toBe(openCount);
    h.db.close();
  });
});
