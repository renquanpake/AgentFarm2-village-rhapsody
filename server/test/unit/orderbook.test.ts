// test/unit/orderbook.test.ts —— B1.1 CDA 订单簿撮合引擎
import { describe, it, expect } from 'vitest';
import { OrderBook, merchantGuard, MM_MAX_QTY } from '../../src/market/orderbook.ts';

const T = 1_000_000; // 固定时间基线（确定性）

describe('价格优先 + 挂单方价格成交', () => {
  it('吃多档卖盘：从低价到高价，价格取挂单方（逐腿聚合）', () => {
    const b = new OrderBook(12);
    b.place('sell', 100, 10, 'npc:A', T);
    b.place('sell', 90, 5, 'npc:B', T + 1);
    b.place('sell', 110, 9, 'npc:C', T + 2);
    const r = b.place('buy', 105, 8, 'u1', T + 10);
    // 先吃 90x5（npc:B 整腿），再吃 100x3（npc:A 部分腿）
    expect(r.fills.map(f => f.price)).toEqual([90, 100]);
    expect(r.fills.map(f => f.qty)).toEqual([5, 3]);
    expect(r.fills.every(f => f.maker !== 'u1' && f.taker === 'u1')).toBe(true);
    expect(r.resting).toBe(0);
    expect(b.snapshot().asks.map(l => [l.price, l.qty])).toEqual([[100, 7], [110, 9]]);
  });
});

describe('时间优先（同价 FIFO）', () => {
  it('同价两档按挂单先后成交', () => {
    const b = new OrderBook(7);
    const o1 = b.place('sell', 50, 5, 'A', T).orderId;
    const o2 = b.place('sell', 50, 5, 'B', T + 1).orderId;
    const r = b.place('buy', 50, 8, 'u1', T + 2);
    expect(r.fills.map(f => f.makerOrder)).toEqual([o1, o2]);
    expect(r.fills.map(f => f.qty)).toEqual([5, 3]);
    expect(r.resting).toBe(0);
  });
});

describe('部分成交与不穿越', () => {
  it('taker 数量不足：剩余部分落簿', () => {
    const b = new OrderBook(3);
    b.place('sell', 80, 5, 'A', T);
    const r = b.place('buy', 90, 2, 'u1', T + 1);
    expect(r.fills.length).toBe(1);
    expect(r.resting).toBe(0); // 2 < 5，taker 全部成交，maker 剩 3
    const snap = b.snapshot();
    expect(snap.asks).toEqual([{ price: 80, qty: 3 }]);
  });

  it('买价低于卖价：不成交，双边落簿', () => {
    const b = new OrderBook(3);
    b.place('sell', 100, 5, 'A', T);
    const r = b.place('buy', 80, 5, 'u1', T + 1);
    expect(r.fills.length).toBe(0);
    expect(r.resting).toBe(5);
    const s = b.snapshot();
    expect(s.bids).toEqual([{ price: 80, qty: 5 }]);
    expect(s.asks).toEqual([{ price: 100, qty: 5 }]);
  });
});

describe('撤单', () => {
  it('撤未成交单：档位数量减少', () => {
    const b = new OrderBook(3);
    const r = b.place('sell', 100, 10, 'A', T);
    expect(b.cancel(r.orderId)).toBe(true);
    expect(b.snapshot().asks.length).toBe(0);
    expect(b.cancel(99999)).toBe(false);
  });
});

describe('做市商冷启动', () => {
  it('围绕基价挂双边单（价差>=下限，单量<=上限），不自我成交', () => {
    const b = new OrderBook(12);
    b.seedMarketMaker(100, { spread: 0.05, maxQtyPerSide: 10 }, T);
    const s = b.snapshot();
    expect(s.bids).toEqual([{ price: 95, qty: 10 }]);
    expect(s.asks).toEqual([{ price: 105, qty: 10 }]);
    expect(s.last).toBeNull();
    // 玩家买 3 手吃做市买盘上方的卖盘 @95？错：买 3 手 @100 会吃 105？不穿越 -> 落簿
    const r = b.place('buy', 100, 3, 'u1', T + 1);
    expect(r.fills.length).toBe(0);
    // 玩家买 3 手 @106 吃掉做市卖盘 3（价格取做市方 105）
    const r2 = b.place('buy', 106, 3, 'u1', T + 2);
    expect(r2.fills.map(f => f.price)).toEqual([105]);
    expect(r2.fills[0].qty).toBe(3);
    expect(r2.fills[0].maker).toBe('mm');
  });

  it('价差下限：spread < 2% 时按 2% 挂', () => {
    const b = new OrderBook(12);
    b.seedMarketMaker(100, { spread: 0.001 }, T);
    const s = b.snapshot();
    expect(s.bids[0].price).toBe(98); // 100*0.98
    expect(s.asks[0].price).toBe(102);
  });

  it('单量上限封顶', () => {
    const b = new OrderBook(12);
    b.seedMarketMaker(100, { maxQtyPerSide: 9999 }, T);
    expect(b.snapshot().bids[0].qty).toBe(MM_MAX_QTY);
  });
});

describe('熔断与确定性', () => {
  it('熔断期内挂单不撮合（只落簿）', () => {
    const b = new OrderBook(5);
    b.place('sell', 10, 5, 'A', T);
    b.circuitBreak(60_000, T);
    const r = b.place('buy', 99, 9, 'u1', T + 1000);
    expect(r.fills.length).toBe(0);
    expect(r.resting).toBe(9);
  });

  it('同操作序列两次运行成交序列逐笔一致', () => {
    const run = () => {
      const b = new OrderBook(9);
      b.place('sell', 100, 5, 'A', T);
      b.place('sell', 90, 5, 'B', T + 1);
      return b.place('buy', 95, 8, 'u1', T + 2);
    };
    const r = run();
    // buy@95 只穿越 90 档（吃 B 整腿 5），剩 3 落簿
    expect(JSON.stringify(run())).toBe(JSON.stringify(r));
    expect(r.fills.map(f => f.price)).toEqual([90]);
    expect(r.fills.map(f => f.qty)).toEqual([5]);
    expect(r.resting).toBe(3);
  });
});

describe('商人破产保护', () => {
  it('现金低于阈值停采购；再减半清仓', () => {
    expect(merchantGuard(10, 100)).toEqual({ stopBuy: true, liquidate: true });
    expect(merchantGuard(60, 100)).toEqual({ stopBuy: true, liquidate: false });
    expect(merchantGuard(500, 100)).toEqual({ stopBuy: false, liquidate: false });
  });
});
