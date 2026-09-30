// market/merchants.ts —— B2 NPC 商人策略与决策周期（design M2.2）
// 每商人实体 {inventory, cash, risk_appetite, home_scene}（merchants 表）；决策周期 1 游戏小时：
// 基于 7 日 OHLC 动量与库存周转产出买卖意向单；商人单量限额 + 做市价差下限不击穿市场；
// 破产保护：现金低于阈值停止采购、再减半转清仓（merchantGuard）。
import type { App } from '../app.ts';
import type { OhlcRow } from './service.ts';
import { MM_MIN_SPREAD } from './orderbook.ts';

export interface MerchantDef {
  id: number;
  name: string;
  home_scene: number;
  risk_appetite: number;
  cash: number;
  inventory: number;
  item_id: number;
}

// 首批发行 3 家（复用 NPC id：屠夫 4 / 木匠 6 / 杂货店 13）；各盯 1 个主商品
export const MERCHANT_SEED: MerchantDef[] = [
  { id: 4, name: '屠夫', home_scene: 2, risk_appetite: 0.3, cash: 500, inventory: 30, item_id: 19 },
  { id: 6, name: '木匠', home_scene: 2, risk_appetite: 0.5, cash: 800, inventory: 40, item_id: 7 },
  { id: 13, name: '杂货店', home_scene: 2, risk_appetite: 0.4, cash: 600, inventory: 60, item_id: 28 },
];

export interface MerchantDecision {
  op: 'buy' | 'sell' | 'hold';
  price: number;
  qty: number;
  reason: string;
}

export const BANKRUPT_THRESHOLD = 100; // 现金 < 100 停止采购
export const LIQUIDATE_THRESHOLD = 50;  // 现金 < 50 清仓
export const MOMENTUM_BUY = 0.05;      // 7 日动量 +5% 看多
export const MOMENTUM_SELL = -0.05;    // 7 日动量 -5% 看空

/** 动量：7 日 OHLC 首末收盘差（无历史视为 0） */
export function ohlcMomentum(ohlc: OhlcRow[]): number {
  if (ohlc.length < 2) return 0;
  const first = ohlc[0].close;
  const last = ohlc[ohlc.length - 1].close;
  if (first <= 0) return 0;
  return (last - first) / first;
}

/** 纯策略：动量 + 库存周转 + 破产护栏 -> 意向单（价格含做市价差下限，不击穿市场） */
export function merchantDecision(
  m: { risk_appetite: number; cash: number; inventory: number },
  base: number,
  ohlc: OhlcRow[],
): MerchantDecision {
  const mom = ohlcMomentum(ohlc);
  const capQty = Math.max(1, Math.ceil(m.risk_appetite * 50)); // 商人单量限额

  // 破产保护（优先级最高）
  if (m.cash < LIQUIDATE_THRESHOLD && m.inventory > 0) {
    return { op: 'sell', price: Math.max(1, Math.round(base * (1 - MM_MIN_SPREAD))), qty: Math.min(m.inventory, capQty * 2), reason: '破产清仓' };
  }
  if (m.cash < BANKRUPT_THRESHOLD) {
    if (m.inventory > 0) return { op: 'sell', price: Math.max(1, Math.round(base * (1 + MM_MIN_SPREAD))), qty: Math.min(m.inventory, capQty), reason: '现金低位停采、去库存' };
    return { op: 'hold', price: base, qty: 0, reason: '现金低位，停采观望' };
  }

  // 动量策略
  if (mom > MOMENTUM_BUY) {
    const px = Math.max(1, Math.round(base * (1 - MM_MIN_SPREAD))); // 略低于基价吃卖盘
    const qty = Math.min(capQty, Math.floor(m.cash / px));
    if (qty > 0) return { op: 'buy', price: px, qty, reason: `动量 +${Math.round(mom * 100)}% 看多` };
    return { op: 'hold', price: base, qty: 0, reason: '现金不足以买入限额' };
  }
  if (mom < MOMENTUM_SELL && m.inventory > 0) {
    const px = Math.max(1, Math.round(base * (1 + MM_MIN_SPREAD))); // 略高于基价挂卖
    return { op: 'sell', price: px, qty: Math.min(capQty, m.inventory), reason: `动量 ${Math.round(mom * 100)}% 去库存` };
  }
  return { op: 'hold', price: base, qty: 0, reason: '区间震荡，观望' };
}

/** 确保商人台账存在（首启发行种子）；返回全部行 */
export function ensureMerchants(db: import('node:sqlite').DatabaseSync): Array<MerchantDef & { last_cycle: number }> {
  const cnt = Number((db.prepare('SELECT COUNT(*) AS n FROM merchants').get() as { n: number }).n);
  if (cnt === 0) {
    const ins = db.prepare('INSERT INTO merchants (id, name, home_scene, risk_appetite, cash, inventory, item_id, last_cycle, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)');
    for (const s of MERCHANT_SEED) ins.run(s.id, s.name, s.home_scene, s.risk_appetite, s.cash, s.inventory, s.item_id, Date.now());
  }
  return db.prepare('SELECT id, name, home_scene, risk_appetite, cash, inventory, item_id, last_cycle FROM merchants').all() as unknown as Array<MerchantDef & { last_cycle: number }>;
}

/** 决策周期：每家商人对其主商品跑一次策略并挂单（幂等：周期内不重复，由调用方控频） */
export function runMerchantCycle(app: App): number {
  const db = app.db;
  let placed = 0;
  const now = Date.now();
  for (const m of ensureMerchants(db)) {
    if (now - m.last_cycle < 60_000) continue; // 1 分钟最小间隔（历法 B8 前用现实时间粗控频）
    const base = app.market.basePrice(m.item_id);
    const ohlc = app.market.ohlc(m.item_id, 7);
    const d = merchantDecision({ risk_appetite: m.risk_appetite, cash: m.cash, inventory: m.inventory }, base, ohlc);
    if (d.op !== 'hold' && d.qty > 0) {
      const r = app.market.place('npc:' + m.id, m.item_id, d.op, d.price, d.qty);
      if (r.ok) placed++;
    }
    db.prepare('UPDATE merchants SET last_cycle = ? WHERE id = ?').run(now, m.id);
  }
  return placed;
}
