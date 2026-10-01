// market/shadow.ts —— B4 影子模式：撮合引擎双实例（design M2.4）
// 影子实例与实盘同收订单、各自撮合，但只记账不结算（不动资产、不预留、不熔断），
// 自成流动性（报价锚定实盘 best 盘口，默认 0 价差紧镜像；可配宽价差/单量做 what-if 对比）。
// 14 日对比报告（价差分布、成交量偏差）作为启用真实结算的验收依据（M-B1 门）。
import type { App } from '../app.ts';
import { OrderBook, type Fill, type Side } from './orderbook.ts';

export interface ShadowOpts {
  spread?: number;   // 影子报价相对实盘 best 的价差（默认 0 = 紧镜像，M-B1 跟随口径；设 >0 做宽价差 what-if 观察）
  makerQty?: number; // 影子做市单量（单边深度目标）
}

export interface ShadowItemReport {
  item: number;
  liveVolume: number;
  shadowVolume: number;
  volumeDeviation: number;   // |live-shadow| / max(1, live)
  livePriceMean: number | null;
  shadowPriceMean: number | null;
  priceSpreadPct: number | null; // |liveMean-shadowMean| / liveMean * 100
}

export class ShadowMarket {
  private books = new Map<number, OrderBook>();
  private app: App;
  private spread: number;
  private makerQty: number;
  constructor(app: App, opts: ShadowOpts = {}) {
    this.app = app;
    this.spread = opts.spread ?? 0;
    this.makerQty = opts.makerQty ?? 40;
  }

  bookOf(item: number): OrderBook {
    let b = this.books.get(item);
    if (!b) { b = new OrderBook(item); this.books.set(item, b); }
    return b;
  }

  /** 镜像实盘挂单（排除实盘做市商 mm：影子自成流动性） */
  mirrorPlace(owner: string, item: number, side: Side, price: number, qty: number): Fill[] {
    if (owner === 'mm') return []; // 影子不用实盘做市单
    this.topShadowMaker(item);
    const b = this.bookOf(item);
    const r = b.place(side, price, qty, owner, Date.now());
    for (const f of r.fills) this.insertShadowFill(item, f);
    return r.fills;
  }

  /** 镜像实盘撤单（按 owner+side+price 匹配最老挂单） */
  mirrorCancel(owner: string, item: number, side: Side, price: number): void {
    if (owner === 'mm') return;
    const b = this.bookOf(item);
    const open = b.openOrders().filter(o => o.owner === owner && o.side === side && o.price === price);
    if (open.length) b.cancel(open[0].id);
  }

  /**
   * 影子自成流动性（D8 根因修复）：锚点跟随实盘 best bid/ask（无盘口回落基价），
   * 按深度缺口补挂 mm-shadow（存量 < makerQty 即补），不再因「有成交」停挂——
   * 旧逻辑锚定 basePrice±8% 且首成交后停止补挂，导致实盘 mm 主导的物品影子系统性漏成交。
   */
  private topShadowMaker(item: number): void {
    const b = this.bookOf(item);
    const live = this.app.market.bookOf(item).snapshot();
    const base = this.app.market.basePrice(item);
    const bid0 = live.bids[0]?.price ?? base;
    const ask0 = live.asks[0]?.price ?? base;
    const bid = Math.max(1, Math.round(bid0 * (1 - this.spread)));
    let ask = Math.max(1, Math.round(ask0 * (1 + this.spread)));
    if (ask <= bid) ask = bid + 1; // 单边/空簿回落时防双边报价自成交
    const now = Date.now();
    const have = (s: Side) => b.openOrders().filter(o => o.owner === 'mm-shadow' && o.side === s).reduce((sum, o) => sum + o.qty, 0);
    const buyNeed = this.makerQty - have('buy');
    if (buyNeed > 0) b.place('buy', bid, buyNeed, 'mm-shadow', now);
    const sellNeed = this.makerQty - have('sell');
    if (sellNeed > 0) b.place('sell', ask, sellNeed, 'mm-shadow', now);
  }

  /** 重启恢复：实盘挂单（非 mm）镜像进影子簿 + 影子成交回灌 */
  load(): void {
    const db = this.app.db;
    const opens = db.prepare("SELECT item_id, side, price, qty, owner FROM market_orders WHERE status = 'open' AND owner != 'mm'").all() as Array<Record<string, number | string>>;
    for (const o of opens) {
      const item = Number(o.item_id);
      this.topShadowMaker(item);
      this.bookOf(item).restoreOpen({
        id: Number(o.id), side: String(o.side) as Side, price: Number(o.price),
        qty: Number(o.qty), owner: String(o.owner), ts: Date.now(),
      });
    }
    const fills = db.prepare('SELECT item_id, price, qty, maker, taker, ts FROM market_shadow_fills ORDER BY ts ASC LIMIT 2000').all() as Array<Record<string, number | string>>;
    for (const f of fills) {
      this.bookOf(Number(f.item_id)).importFills([{
        taker: String(f.taker), maker: String(f.maker), item: Number(f.item_id),
        price: Number(f.price), qty: Number(f.qty), makerOrder: 0, takerOrder: 0, ts: Number(f.ts),
      }]);
    }
  }

  private insertShadowFill(item: number, f: Fill): void {
    this.app.db.prepare('INSERT INTO market_shadow_fills (item_id, price, qty, maker, taker, ts) VALUES (?, ?, ?, ?, ?, ?)')
      .run(item, f.price, f.qty, f.maker, f.taker, f.ts);
  }

  /** 对比报告：实盘 vs 影子（N 日窗口，默认 14） */
  report(days = 14): ShadowItemReport[] {
    const db = this.app.db;
    const from = Date.now() - days * 86_400_000;
    const items = new Set<number>();
    for (const r of db.prepare('SELECT DISTINCT item_id FROM market_fills WHERE ts >= ?').all(from) as Array<{ item_id: number }>) items.add(r.item_id);
    for (const r of db.prepare('SELECT DISTINCT item_id FROM market_shadow_fills WHERE ts >= ?').all(from) as Array<{ item_id: number }>) items.add(r.item_id);
    const out: ShadowItemReport[] = [];
    for (const item of items) {
      const agg = (q: string, p: number[]) => {
        const rows = db.prepare(q).all(...p) as Array<{ qty: number; price: number }>;
        const vol = rows.reduce((s, r) => s + r.qty, 0);
        const mean = rows.length ? rows.reduce((s, r) => s + r.price * r.qty, 0) / Math.max(1, vol) : null;
        return { vol, mean };
      };
      const live = agg('SELECT price, qty FROM market_fills WHERE item_id = ? AND ts >= ?', [item, from]);
      const shadow = agg('SELECT price, qty FROM market_shadow_fills WHERE item_id = ? AND ts >= ?', [item, from]);
      const spreadPct = live.mean && shadow.mean && live.mean > 0
        ? Math.abs(live.mean - shadow.mean) / live.mean * 100 : null;
      out.push({
        item,
        liveVolume: live.vol,
        shadowVolume: shadow.vol,
        volumeDeviation: Math.abs(live.vol - shadow.vol) / Math.max(1, live.vol),
        livePriceMean: live.mean,
        shadowPriceMean: shadow.mean,
        priceSpreadPct: spreadPct,
      });
    }
    return out.sort((a, b) => a.item - b.item);
  }
}
