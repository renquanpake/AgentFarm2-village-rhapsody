// market/service.ts —— B1.2 CDA 市场接线：app 级市场服务（订单簿 + 挂单预留 + 成交结算 + 持久化 + OHLC）
// 设计 M2.1：
//  - 每物品一簿；挂单即预留资产（买=扣现金、卖=扣物品），成交=双方资产过户，撤单=退还预留
//  - 冷启动：簿空时围绕基价（N10 口径 Tables.basePriceOf）挂做市商双边单（'mm' 虚拟账户，不记账）
//  - 护栏：成交异常（负现金/负库存）-> 该簿熔断 1 游戏小时
//  - 持久化：market_orders（挂单生命周期）/ market_fills（成交与 OHLC）；重启 restoreOpen + importFills 恢复
//  - 事件溯源：order.placed / trade.filled / order.cancelled 落事件库（applyEvent 无需重放：资产已在 live 结算）
import type { App } from '../app.ts';
import { OrderBook, type Fill, type Side, type BookSnapshot } from './orderbook.ts';
import { knapAdd, knapSub } from '../world/farm.ts';
import { TRADE_FEE_RATE } from './economy.ts';
import { log } from '../logging.ts';

export interface PlaceResult { ok: boolean; msg?: string; orderId?: number; resting?: number; fills?: Fill[]; }
export interface CancelResult { ok: boolean; msg?: string; }

export interface OhlcRow { day: number; open: number; high: number; low: number; close: number; volume: number }

const DAY_MS = 86_400_000;
const BREAK_MS = 3_600_000; // 熔断 1 游戏小时（历法接入前用现实小时）

export class MarketService {
  private books = new Map<number, OrderBook>();
  private app: App;
  private shadow: import('./shadow.ts').ShadowMarket | null = null;
  constructor(app: App) { this.app = app; }

  /** B4：接影子实例（镜像挂单/撤单；影子只记账不结算） */
  attachShadow(shadow: import('./shadow.ts').ShadowMarket): void { this.shadow = shadow; }

  bookOf(item: number): OrderBook {
    let b = this.books.get(item);
    if (!b) {
      b = new OrderBook(item);
      // 重启校准：自增序号须越过磁盘历史最大值。已成交/已撤销行不进 restoreOpen，
      // 不校准则新单复用旧 id -> UNIQUE constraint failed: market_orders.id
      const mx = (this.app.db.prepare('SELECT MAX(id) AS mx FROM market_orders WHERE item_id = ?').get(item) as { mx: number | null }).mx;
      if (mx) b.calibrateTo(mx);
      this.books.set(item, b);
    }
    return b;
  }

  /** 基价（N10 口径，见 Tables.basePriceOf）：经济表覆盖 -> items.sell_price x 2 -> 回退 50 */
  basePrice(item: number): number {
    return this.app.tables.basePriceOf(item);
  }

  /** 冷启动：簿空（无挂单无成交）时挂做市商双边单 */
  ensureMaker(item: number): void {
    const b = this.bookOf(item);
    if (b.openCount() === 0 && b.recentFills(1).length === 0) {
      b.seedMarketMaker(this.basePrice(item), {}, Date.now());
      for (const o of b.openOrders()) this.insertOrderRow(item, o, 'open');
      log.write('info', 'market', `订单簿冷启动：物品${item} 挂做市商双边单（基价 ${this.basePrice(item)}）`);
    }
  }

  private pmOf(uid: string) {
    if (!this.app.state.playersDb.has(uid)) this.app.state.playersDb.set(uid, new Map());
    return this.app.state.playersDb.get(uid)!;
  }

  // ---------- NPC 商人台账（'npc:<id>' -> merchants 表；预留/过户/退还走台账而非玩家背包） ----------

  private npcLedger(owner: string): { id: number; cash: number; inventory: number; item_id: number } | null {
    const m = owner.match(/^npc:(\d+)$/);
    if (!m) return null;
    const row = this.app.db.prepare('SELECT id, cash, inventory, item_id FROM merchants WHERE id = ?').get(m[1]) as { id: number; cash: number; inventory: number; item_id: number } | undefined;
    return row ?? null;
  }

  private adjustLedger(id: number, dCash: number, dInv: number): void {
    this.app.db.prepare('UPDATE merchants SET cash = cash + ?, inventory = inventory + ?, updated_at = ? WHERE id = ?').run(dCash, dInv, Date.now(), id);
  }

  /** 预留：买扣现金、卖扣库存；不足返回 false */
  private npcReserve(owner: string, side: Side, price: number, qty: number): boolean {
    const led = this.npcLedger(owner);
    if (!led) return false;
    if (side === 'buy') {
      if (led.cash < price * qty) return false;
      this.adjustLedger(led.id, -price * qty, 0);
    } else {
      if (led.inventory < qty) return false;
      this.adjustLedger(led.id, 0, -qty);
    }
    return true;
  }

  /** 撤销预留（撤单） */
  private npcUnreserve(owner: string, side: Side, price: number, qty: number): void {
    const led = this.npcLedger(owner);
    if (!led) return;
    if (side === 'buy') this.adjustLedger(led.id, price * qty, 0);
    else this.adjustLedger(led.id, 0, qty);
  }

  /** 成交过户：买方收库存、卖方收现金（预留已在挂单时扣除） */
  private npcSettle(owner: string, side: Side, item: number, price: number, qty: number): void {
    const led = this.npcLedger(owner);
    if (!led) return;
    if (side === 'buy') this.adjustLedger(led.id, 0, qty);
    else this.adjustLedger(led.id, price * qty, 0);
  }

  /** 挂单（预留 -> 撮合 -> 结算过户 -> 落库/事件） */
  place(uid: string, item: number, side: Side, price: number, qty: number): PlaceResult {
    if (qty <= 0 || price <= 0) return { ok: false, msg: 'price/qty 需为正数' };
    this.ensureMaker(item);
    const b = this.bookOf(item);
    if (b.isBroken()) return { ok: false, msg: '该订单簿熔断中（交易异常），暂停撮合' };

    // 预留：买扣现金、卖扣物品（mm 虚拟账户不预留；npc 走台账）
    const isNpc = uid.startsWith('npc:');
    if (uid !== 'mm' && !isNpc) {
      const pm = this.pmOf(uid);
      if (side === 'buy') {
        const cost = price * qty;
        if (!knapSub(pm, 1, cost)) return { ok: false, msg: `金币不足（需 ${cost}，先挂单时预留）` };
      } else {
        if (!knapSub(pm, item, qty)) return { ok: false, msg: `物品不足（需 ${qty}，先挂单时预留）` };
      }
    }
    if (isNpc && !this.npcReserve(uid, side, price, qty)) {
      return { ok: false, msg: '商人资金/库存不足（台账）' };
    }

    const now = Date.now();
    const r = b.place(side, price, qty, uid, now);
    // B4 影子：镜像挂单（影子自成流动性，只记账不结算）
    this.shadow?.mirrorPlace(uid, item, side, price, qty);
    let anomaly = false;
    for (const f of r.fills) {
      // 过户：买方收物、卖方收钱（mm 虚拟跳过；npc 走台账）
      const buyer = side === 'buy' ? f.taker : f.maker;
      const seller = side === 'buy' ? f.maker : f.taker;
      if (buyer !== 'mm') {
        if (buyer.startsWith('npc:')) this.npcSettle(buyer, 'buy', item, f.price, f.qty);
        else if (!knapAdd(this.pmOf(buyer), item, f.qty)) anomaly = true;
        // 限价改善退差：成交价取挂单方（maker）价格，买方限价更优时把价差退回买方。
        // place() 已按限价预留 price*qty —— 未成交部分撤单时退（见 cancel），
        // 但已成交部分的价差此前凭空消失：既没给卖方、也没记 trade.fee，
        // 是一笔无日志的漏账（对买方不公平，对 moneySupply 是隐性回收）。
        // maker 即买方时（side==='sell'）成交价就是其挂单价，refund 恒为 0。
        const buyerLimit = side === 'buy' ? price : f.price;
        const refund = Math.max(0, (buyerLimit - f.price) * f.qty);
        if (refund > 0) {
          if (buyer.startsWith('npc:')) { const led = this.npcLedger(buyer); if (led) this.adjustLedger(led.id, refund, 0); }
          else if (!knapAdd(this.pmOf(buyer), 1, refund)) anomaly = true;
          this.app.log.append('trade.refund', buyer, { item, price: f.price, qty: f.qty, limit: buyerLimit, refund, ts: now });
        }
      }
      if (seller !== 'mm') {
        // 交易所/银行系统手续费：卖方所得扣 10% 并烧币（通缩回收，moneySupply 随之下降）
        const gross = f.price * f.qty;
        const fee = Math.round(gross * TRADE_FEE_RATE);
        const net = gross - fee;
        if (seller.startsWith('npc:')) {
          const led = this.npcLedger(seller);
          if (led) this.adjustLedger(led.id, net, 0); // NPC 台账同付手续费（现金只入 net）
        } else if (!knapAdd(this.pmOf(seller), 1, net)) anomaly = true;
        if (fee > 0) this.app.log.append('trade.fee', seller, { item, price: f.price, qty: f.qty, fee, ts: now });
      }
      this.insertFillRow(item, f, now);
      this.app.log.append('trade.filled', f.maker, { item, price: f.price, qty: f.qty, maker: f.maker, taker: f.taker, ts: now });
    }
    if (!isNpc) this.app.state.persist();
    this.syncOpen(item, b);
    this.app.log.append('order.placed', uid, { item, side, price, qty, orderId: r.orderId });

    if (anomaly) {
      // 护栏：负现金/负库存 -> 熔断 1 游戏小时 + 告警
      b.circuitBreak(BREAK_MS, now);
      log.write('error', 'market', '成交异常（负现金/负库存），订单簿熔断 1 游戏小时', { item, uid });
    }
    return { ok: true, orderId: r.orderId, resting: r.resting, fills: r.fills };
  }

  /** 撤单（退还预留） */
  cancel(uid: string, item: number, orderId: number): CancelResult {
    const b = this.bookOf(item);
    if (!b.cancel(orderId)) return { ok: false, msg: '订单不存在或已全部成交' };
    const row = this.orderRow(orderId);
    // B4 影子：镜像撤单
    if (row) this.shadow?.mirrorCancel(uid, item, row.side as Side, row.price);
    if (uid !== 'mm' && row) {
      if (uid.startsWith('npc:')) {
        this.npcUnreserve(uid, row.side as Side, row.price, row.qty);
      } else {
        const pm = this.pmOf(uid);
        const back = row.side === 'buy' ? 1 : item;
        const n = row.side === 'buy' ? row.price * row.qty : row.qty;
        knapAdd(pm, back, n); // 退还预留（现金或物品）
        this.app.state.persist();
      }
    }
    this.app.db.prepare("UPDATE market_orders SET status = 'cancelled' WHERE id = ? AND status = 'open'").run(orderId);
    this.syncOpen(item, b);
    this.app.log.append('order.cancelled', uid, { item, orderId });
    return { ok: true };
  }

  /** 订单簿快照 + 7 日 OHLC + 最近成交 */
  marketView(item: number, ohlcDays = 7): { book: BookSnapshot; ohlc: OhlcRow[]; fills: Fill[] } {
    this.ensureMaker(item);
    const b = this.bookOf(item);
    return { book: b.snapshot(), ohlc: this.ohlc(item, ohlcDays), fills: b.recentFills(10) };
  }

  /** 7 日 OHLC（按成交聚合；无成交日缺省不补） */
  ohlc(item: number, days = 7): OhlcRow[] {
    const db = this.app.db;
    const rows = db.prepare('SELECT ts, price, qty FROM market_fills WHERE item_id = ? AND ts >= ? ORDER BY ts ASC').all(item, Date.now() - DAY_MS * days) as Array<{ ts: number; price: number; qty: number }>;
    const out: OhlcRow[] = [];
    for (const r of rows) {
      const day = Math.floor(r.ts / DAY_MS);
      let d = out[out.length - 1];
      if (!d || d.day !== day) { d = { day, open: r.price, high: r.price, low: r.price, close: r.price, volume: r.qty }; out.push(d); }
      else {
        d.high = Math.max(d.high, r.price);
        d.low = Math.min(d.low, r.price);
        d.close = r.price;
        d.volume += r.qty;
      }
    }
    return out;
  }

  /** 重启恢复：挂单 + 最近成交回灌订单簿 */
  load(): void {
    const db = this.app.db;
    const opens = db.prepare("SELECT * FROM market_orders WHERE status = 'open'").all() as Array<Record<string, number | string>>;
    for (const o of opens) {
      const item = Number(o.item_id);
      this.bookOf(item).restoreOpen({
        id: Number(o.id), side: String(o.side) as Side, price: Number(o.price),
        qty: Number(o.qty), owner: String(o.owner), ts: Number(o.ts),
      });
    }
    const fills = db.prepare('SELECT item_id, price, qty, maker, taker, ts FROM market_fills ORDER BY ts ASC LIMIT 500').all() as Array<Record<string, number | string>>;
    for (const f of fills) {
      this.bookOf(Number(f.item_id)).importFills([{
        taker: String(f.taker), maker: String(f.maker), item: Number(f.item_id),
        price: Number(f.price), qty: Number(f.qty), makerOrder: 0, takerOrder: 0, ts: Number(f.ts),
      }]);
    }
    if (opens.length) log.write('info', 'market', `市场恢复：${opens.length} 笔挂单 + ${fills.length} 笔历史成交`);
  }

  // ---------- DB 辅助 ----------

  private insertOrderRow(item: number, o: { id: number; side: Side; price: number; qty: number; owner: string; ts: number }, status: string): void {
    this.app.db.prepare(
      'INSERT INTO market_orders (id, item_id, side, price, qty, owner, status, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(o.id, item, o.side, o.price, o.qty, o.owner, status, o.ts);
  }

  private orderRow(orderId: number): { side: string; price: number; qty: number } | null {
    const row = this.app.db.prepare('SELECT side, price, qty FROM market_orders WHERE id = ?').get(orderId) as { side: string; price: number; qty: number } | undefined;
    return row ?? null;
  }

  /** 挂单生命周期同步：撤单改 cancelled、全成交改 filled、挂单新插/扣减 qty */
  private syncOpen(item: number, b: OrderBook): void {
    const db = this.app.db;
    const open = b.openOrders();
    const openIds = new Set(open.map(o => o.id));
    const prev = db.prepare("SELECT id FROM market_orders WHERE item_id = ? AND status = 'open'").all(item) as Array<{ id: number }>;
    for (const p of prev) if (!openIds.has(p.id)) db.prepare("UPDATE market_orders SET status = 'filled' WHERE id = ?").run(p.id);
    const prevIds = new Set(prev.map(p => p.id));
    for (const o of open) {
      if (!prevIds.has(o.id)) this.insertOrderRow(item, o, 'open');
      else db.prepare('UPDATE market_orders SET qty = ? WHERE id = ?').run(o.qty, o.id);
    }
  }

  private insertFillRow(item: number, f: Fill, now: number): void {
    this.app.db.prepare(
      'INSERT INTO market_fills (item_id, price, qty, maker, taker, ts) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(item, f.price, f.qty, f.maker, f.taker, now);
  }
}
