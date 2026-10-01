// market/orderbook.ts —— B1.1 CDA 限价订单簿撮合引擎（纯、确定性、无 DB/网络耦合）
// 设计 M2.1：每可交易物品一本簿，买卖各一档位表；价格优先 + 时间优先；成交价取挂单方（resting）价格。
// 冷启动：NPC 做市商围绕基价提供双边流动性（做市价差下限 + 单量上限）；熔断：异常期停撮合。
// 本段只做引擎核心；B1.2 再落 DB 迁移 / app 接线 / 商人实体 / 路由。

export type Side = 'buy' | 'sell';

export interface LimitOrder {
  id: number;
  side: Side;
  price: number;
  qty: number;      // 落簿时的剩余数量（撮合后更新）
  owner: string;    // 玩家 uid / 'mm'（做市商）/ 'npc:<merchant>'
  seq: number;      // 全局序号（时间优先用）
  ts: number;
}

export interface Fill {
  taker: string;
  maker: string;
  item: number;
  price: number;    // 挂单方价格
  qty: number;
  makerOrder: number;
  takerOrder: number;
  ts: number;
}

export interface BookLevel { price: number; qty: number }

export interface BookSnapshot {
  bids: BookLevel[];   // 买盘：价格从高到低
  asks: BookLevel[];   // 卖盘：价格从低到高
  last: Fill | null;
  openOrders: number;
}

export interface PlaceResult {
  fills: Fill[];       // 本次逐笔成交
  orderId: number;
  resting: number;     // 未成交、留在簿上的数量
}

export interface MakerSeedOpts {
  spread?: number;        // 做市价差（默认 5%）
  maxQtyPerSide?: number; // 单边做市单量上限（商人单量限额）
}

// 护栏常量：做市价差下限 / 默认单量上限
export const MM_MIN_SPREAD = 0.02;
export const MM_MAX_QTY = 50;

interface Level { price: number; orders: LimitOrder[] } // 价格档位 -> FIFO 队列（时间优先）

export class OrderBook {
  readonly item: number;
  private bids = new Map<number, Level>();
  private asks = new Map<number, Level>();
  private fills: Fill[] = [];
  private seq = 0;
  private nextId = 1;      // 本簿本地序号
  private idBase: number;  // item 分段基址：market_orders 为全局表，订单 id 须跨 item 唯一
  private brokenUntil = 0;

  constructor(item: number) { this.item = item; this.idBase = item * 1_000_000; }

  isBroken(now = Date.now()): boolean { return now < this.brokenUntil; }
  /** 熔断该订单簿（设计：交易异常后 1 游戏小时停撮合） */
  circuitBreak(ms: number, now = Date.now()): void { this.brokenUntil = now + ms; }

  /** 撤单；成功返回 true。 */
  cancel(id: number): boolean {
    for (const book of [this.bids, this.asks]) {
      for (const [price, lv] of book) {
        const i = lv.orders.findIndex(o => o.id === id);
        if (i >= 0) {
          lv.orders.splice(i, 1);
          if (lv.orders.length === 0) book.delete(price);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 挂单 + 撮合。熔断期内只挂不撮合。
   * 成交取挂单方价格；同价时间优先（FIFO）。
   */
  place(side: Side, price: number, qty: number, owner: string, now = Date.now()): PlaceResult {
    if (qty <= 0 || price <= 0) return { fills: [], orderId: 0, resting: 0 };
    const id = this.idBase + this.nextId++;
    const o: LimitOrder = { id, side, price, qty, owner, seq: ++this.seq, ts: now };
    let remaining = qty;
    const fills: Fill[] = [];
    if (!this.isBroken(now)) {
      remaining = this.match(o, remaining, fills);
    }
    if (remaining > 0) this.rest(o, remaining);
    for (const f of fills) this.fills.push(f);
    return { fills, orderId: id, resting: remaining };
  }

  /** 吃对手盘，返回 taker 未成交剩余量 */
  private match(taker: LimitOrder, remaining: number, out: Fill[]): number {
    if (taker.side === 'buy') {
      // 吃卖盘：ask 价从低到高，问价 <= 买价
      for (const price of [...this.asks.keys()].sort((a, b) => a - b)) {
        if (price > taker.price) break;
        remaining = this.consume(this.asks, price, taker, remaining, out);
        if (remaining === 0) break;
      }
    } else {
      // 吃买盘：bid 价从高到低，问价 >= 卖价
      for (const price of [...this.bids.keys()].sort((a, b) => b - a)) {
        if (price < taker.price) break;
        remaining = this.consume(this.bids, price, taker, remaining, out);
        if (remaining === 0) break;
      }
    }
    return remaining;
  }

  private consume(book: Map<number, Level>, price: number, taker: LimitOrder, remaining: number, out: Fill[]): number {
    const lv = book.get(price);
    if (!lv) return remaining;
    while (remaining > 0 && lv.orders.length > 0) {
      const maker = lv.orders[0]; // 时间优先：FIFO 队首
      const take = Math.min(remaining, maker.qty);
      if (take <= 0) break;
      maker.qty -= take;
      remaining -= take;
      out.push({
        taker: taker.owner, maker: maker.owner,
        item: this.item, price, qty: take,
        makerOrder: maker.id, takerOrder: taker.id,
        ts: taker.ts,
      });
      if (maker.qty <= 0) lv.orders.shift();
    }
    if (lv.orders.length === 0) book.delete(price);
    return remaining;
  }

  private rest(o: LimitOrder, remaining: number): void {
    o.qty = remaining; // 落簿后 qty 表示"剩余"
    const book = o.side === 'buy' ? this.bids : this.asks;
    let lv = book.get(o.price);
    if (!lv) { lv = { price: o.price, orders: [] }; book.set(o.price, lv); }
    lv.orders.push(o);
  }

  /** 冷启动：做市商围绕基价挂双边流动性（价差下限 + 单量上限） */
  seedMarketMaker(base: number, opts: MakerSeedOpts = {}, now = Date.now()): number[] {
    const spread = Math.max(opts.spread ?? 0.05, MM_MIN_SPREAD);
    const maxQty = Math.min(opts.maxQtyPerSide ?? MM_MAX_QTY, MM_MAX_QTY);
    const bid = Math.max(1, Math.round(base * (1 - spread)));
    const ask = Math.max(1, Math.round(base * (1 + spread)));
    const b = this.place('buy', bid, maxQty, 'mm', now);
    const a = this.place('sell', ask, maxQty, 'mm', now);
    // 买价 < 卖价，做市双边不会自成交；落簿订单号即 place 返回的 orderId
    return [b.orderId, a.orderId];
  }

  /** 订单簿快照（top N 档位 + 最近成交 + 挂单总数） */
  snapshot(topN = 5): BookSnapshot {
    const agg = (book: Map<number, Level>, highFirst: boolean) =>
      [...book.entries()]
        .map(([price, lv]) => ({ price, qty: lv.orders.reduce((s, o) => s + o.qty, 0) }))
        .filter(l => l.qty > 0)
        .sort((a, b) => (highFirst ? b.price - a.price : a.price - b.price))
        .slice(0, topN);
    return {
      bids: agg(this.bids, true),
      asks: agg(this.asks, false),
      last: this.fills[this.fills.length - 1] ?? null,
      openOrders: this.openCount(),
    };
  }

  openCount(): number {
    return [...this.bids.values(), ...this.asks.values()].reduce((s, lv) => s + lv.orders.length, 0);
  }

  recentFills(n = 10): Fill[] { return this.fills.slice(-n); }

  /** 全部挂单（平铺，DB 同步用） */
  openOrders(): Array<{ id: number; side: Side; price: number; qty: number; owner: string; ts: number }> {
    const out: Array<{ id: number; side: Side; price: number; qty: number; owner: string; ts: number }> = [];
    for (const book of [this.bids, this.asks]) for (const lv of book.values()) for (const o of lv.orders) out.push(o);
    return out;
  }

  /** 重启恢复：挂单原样入簿（不撮合、保留原 id） */
  restoreOpen(o: { id: number; side: Side; price: number; qty: number; owner: string; ts: number }): void {
    if (o.qty <= 0) return;
    const book = o.side === 'buy' ? this.bids : this.asks;
    let lv = book.get(o.price);
    if (!lv) { lv = { price: o.price, orders: [] }; book.set(o.price, lv); }
    lv.orders.push({ ...o, seq: ++this.seq });
    // 兼容：新 id = idBase+本地序号（o.id>=idBase）；旧无偏移小 id 原样取本地值（远小于 idBase，不冲突）
    const local = o.id >= this.idBase ? o.id - this.idBase : o.id;
    this.nextId = Math.max(this.nextId, local + 1);
  }

  /** 重启恢复：导入历史成交（快照 last / OHLC 用） */
  importFills(fs: Fill[]): void { this.fills.push(...fs); }
}

// 商人破产保护（B2 策略层引用）：现金低于阈值停止采购、转清仓
export function merchantGuard(cash: number, threshold: number): { stopBuy: boolean; liquidate: boolean } {
  return { stopBuy: cash < threshold, liquidate: cash < threshold * 0.5 };
}
