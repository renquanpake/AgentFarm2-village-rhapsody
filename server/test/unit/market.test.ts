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
import { TRADE_FEE_RATE } from '../../src/market/economy.ts';

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
    const fee = Math.round(2 * sellPx * TRADE_FEE_RATE);
    expect(knapHas(pm(h, 'u1'), 1, 2 * sellPx - fee)).toBe(true); // 卖方实收 90%（10% 手续费烧币）
    expect(rb.resting).toBe(0);
    h.db.close();
  });
});

describe('交易所系统手续费（10% 烧币通缩回收）', () => {
  it('卖方实收 90%，10% 烧币 + trade.fee 事件入库', () => {
    const h = harness();
    give(h, 'u1', 12, 5);
    give(h, 'u2', 1, 1000);
    const sellPx = Math.round(h.market.basePrice(12) * 1.05) - 1;
    h.market.place('u1', 12, 'sell', sellPx, 5); // 挂卖（不穿越）
    const rb = h.market.place('u2', 12, 'buy', sellPx, 2);
    expect(rb.fills!.length).toBe(1);
    const gross = 2 * sellPx;
    const fee = Math.round(gross * TRADE_FEE_RATE);
    const net = gross - fee;
    // 卖方只拿到 90%（fee 烧掉，不入任何人）
    expect(knapHas(pm(h, 'u1'), 1, net)).toBe(true);
    expect(h.log.since(0).filter(e => e.type === 'trade.fee').length).toBe(1);
    h.db.close();
  });
});

describe('持久化与 OHLC', () => {
  // SQLite 磁盘 I/O 重（两次 WorldState+EventLog 构造与快照），多文件并行时 5s 默认超时会偶发抖动
  it('重启 load() 恢复挂单与成交历史；OHLC 可查', async () => {
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
  }, 15000);
});

describe('买入限价改善退差（价格改善归买方）', () => {
  it('吃单方低价挂单：买方拿回限价与成交价之差', () => {
    const h = harness();
    give(h, 'u1', 12, 5);
    give(h, 'u2', 1, 1000);
    const sellPx = Math.round(h.market.basePrice(12) * 1.05) - 1;
    h.market.place('u1', 12, 'sell', sellPx, 5);
    const limit = sellPx + 3; // 买方限价更高
    const coins = (uid: string) => Number(((pm(h, uid).get('knapData') as { props: Array<{ id: number; num?: number }> }).props.find(p => p.id === 1)?.num) || 0);
    const before = coins('u2');
    const rb = h.market.place('u2', 12, 'buy', limit, 2);
    expect(rb.fills!.length).toBe(1);
    expect(rb.fills![0].price).toBe(sellPx); // 成交价取挂单方
    // 价差 (limit - sellPx) * 2 全额退回
    expect(before - coins('u2')).toBe(2 * sellPx);
    expect(h.log.since(0).filter(e => e.type === 'trade.refund').length).toBe(1);
    h.db.close();
  });

  it('限价等于成交价不产生退款事件', () => {
    const h = harness();
    give(h, 'u1', 12, 5);
    give(h, 'u2', 1, 1000);
    const sellPx = Math.round(h.market.basePrice(12) * 1.05) - 1;
    h.market.place('u1', 12, 'sell', sellPx, 5);
    h.market.place('u2', 12, 'buy', sellPx, 2);
    expect(h.log.since(0).filter(e => e.type === 'trade.refund').length).toBe(0);
    h.db.close();
  });

  it('买方才挂单被卖方吃掉：成交价即买方挂单价，无退款', () => {
    const h = harness();
    give(h, 'u1', 12, 5);
    give(h, 'u2', 1, 1000);
    const base = h.market.basePrice(12);
    const buyPx = Math.round(base * 0.95) + 1; // 高于做市买盘 -> 挂簿
    const rb = h.market.place('u2', 12, 'buy', buyPx, 2);
    expect(rb.fills!.length).toBe(0);
    const rs = h.market.place('u1', 12, 'sell', buyPx, 2); // 卖方主动来吃
    expect(rs.fills!.length).toBe(1);
    expect(rs.fills![0].maker).toBe('u2');
    expect(h.log.since(0).filter(e => e.type === 'trade.refund').length).toBe(0);
    h.db.close();
  });

  it('守恒：买方净支出=成交总价，卖方=gross-fee，烧币=fee', () => {
    const h = harness();
    give(h, 'u1', 12, 5);
    give(h, 'u2', 1, 1000);
    const sellPx = Math.round(h.market.basePrice(12) * 1.05) - 1;
    h.market.place('u1', 12, 'sell', sellPx, 5);
    const coins = (uid: string) => Number(((pm(h, uid).get('knapData') as { props: Array<{ id: number; num?: number }> }).props.find(p => p.id === 1)?.num) || 0);
    const b0 = coins('u2'), s0 = coins('u1');
    h.market.place('u2', 12, 'buy', sellPx + 4, 2);
    const gross = 2 * sellPx;
    const fee = Math.round(gross * TRADE_FEE_RATE);
    expect(b0 - coins('u2')).toBe(gross);          // 退差后只付成交总价
    expect(coins('u1') - s0).toBe(gross - fee);     // 卖方收 90%
    h.db.close();
  });
});

describe('重启 ID 校准（market_orders.id UNIQUE）', () => {
  it('重启后新挂单不复用已成交历史行 id（restoreOpen 只回灌未成交单）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-mkt-cal-'));
    dirs.push(dir);
    const build = () => {
      const tables = new Tables(path.join(dir, 'data'));
      const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 600000, init: false };
      const state = new WorldState(opts);
      const db = openDb(path.join(dir, 'events.db'));
      const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
      log.init();
      const app = { state, tables, db, log } as unknown as App;
      return { state, db, market: new MarketService(app) };
    };

    // 阶段一：卖单压在 mm 卖盘下方成为最高 open id -> 买单把它全部吃光，该行状态转 'filled'。
    // 重启后 restoreOpen 只回灌仍 open 的行，未校准时新单会重生该 'filled' 行的 id
    const a = build();
    give(a, 'u1', 12, 5);
    const ask = Math.round(a.market.basePrice(12) * 1.05); // 做市卖盘价
    const aPx = ask - 1;                                     // 压在 mm 卖盘下方：买盘只吃得到它
    const r1 = a.market.place('u1', 12, 'sell', aPx, 5);
    give(a, 'u2', 1, 100000);
    const r2 = a.market.place('u2', 12, 'buy', aPx, 5);
    expect(r1.fills!.length).toBe(0);
    expect(r2.fills!.length).toBe(1);
    expect(r2.fills![0].maker).toBe('u1'); // 锁死场景：A 被吃光，B 全部成交不残留
    const rows = a.db.prepare('SELECT id, status FROM market_orders WHERE item_id = ? ORDER BY id').all(12) as Array<{ id: number; status: string }>;
    const openIds = rows.filter(r => r.status === 'open').map(r => r.id);
    const maxRestored = Math.max(...openIds);
    const maxAll = Math.max(...rows.map(r => r.id));
    expect(maxRestored).toBeLessThan(maxAll); // 'filled' 行排在最后 -> 不进 restoreOpen
    // r2 全成交从不落 market_orders：它的单号在 market_orders 里查不到，是「幽灵单号」
    const takerGhost = r2.orderId!;
    expect(rows.some(r => r.id === takerGhost)).toBe(false);
    expect(takerGhost).toBeGreaterThan(maxAll);
    // 模拟 v7 迁移前的历史成交行：maker_order/taker_order 全为 0，幽灵单号只剩 order.placed 事件里那份
    a.db.prepare('UPDATE market_fills SET maker_order = 0, taker_order = 0').run();
    a.db.close();

    // 阶段二：重启。未校准的簿 nextId 只被 open 行推到 maxRestored+1，新单撞 'filled' 行；
    // 只查 market_orders/market_fills 又会回绕到幽灵单号（它比所有 market_orders 行都大）
    const b = build();
    b.market.load();
    give(b, 'u3', 12, 5);
    const rn = b.market.place('u3', 12, 'sell', aPx * 3, 5);
    expect(rn.ok).toBe(true);
    expect(rn.orderId!).toBeGreaterThan(maxAll);
    expect(rn.orderId!).toBeGreaterThan(takerGhost);
    b.db.close();
  });
});

describe('限价买单吃低价卖盘时正确退还价差预留', () => {
  it('卖方挂单 60 块 1 件、买方挂单 100 块 1 件（预留 100）：成交 60、卖方实收 54、买方实付 60 且退 40', () => {
    const h = harness();
    const coins = (uid: string) => Number(((pm(h, uid).get('knapData') as { props: Array<{ id: number; num?: number }> }).props.find(p => p.id === 1)?.num) || 0);
    // 先清掉做市商卖盘，否则买 100 会先吃到做市低价卖单，撞不到 60 的那笔
    const mv = h.market.marketView(12);
    const mmAsk = mv.book.asks[0];
    expect(mmAsk.price).toBeLessThan(60);
    give(h, 'u3', 1, 100000);
    expect(h.market.place('u3', 12, 'buy', mmAsk.price, mmAsk.qty).fills!.length).toBe(1);

    // 卖方挂卖 60 x1：高于做市买盘，落簿不成交
    give(h, 'u1', 12, 1);
    const rs = h.market.place('u1', 12, 'sell', 60, 1);
    expect(rs.fills!.length).toBe(0);
    expect(rs.resting).toBe(1);

    // 买方限价 100 吃 60 的卖单：预留 100，实际只该支出 60
    give(h, 'u2', 1, 1000);
    const s0 = coins('u1'), b0 = coins('u2');
    const rb = h.market.place('u2', 12, 'buy', 100, 1);
    expect(rb.fills!.length).toBe(1);
    expect(rb.fills![0].price).toBe(60);       // 成交价取挂单方（卖方）价
    expect(rb.fills![0].maker).toBe('u1');
    expect(rb.fills![0].taker).toBe('u2');
    expect(knapHas(pm(h, 'u2'), 12, 1)).toBe(true);  // 买方收货
    expect(b0 - coins('u2')).toBe(60);                // 预留 100 -> 实付 60（差额 40 已退回钱包）
    const gross = 60;
    const fee = Math.round(gross * TRADE_FEE_RATE);
    expect(gross - fee).toBe(54);
    expect(coins('u1') - s0).toBe(54);                // 卖方实收 60 - 10% 税 6
    const refunds = h.log.since(0).filter(e => e.type === 'trade.refund');
    expect(refunds.length).toBe(1);
    expect(refunds[0].payload).toMatchObject({ refund: 40, limit: 100, price: 60, qty: 1 });
    h.db.close();
  });
});
