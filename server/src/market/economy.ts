// market/economy.ts —— B3 货币治理与通胀回收（design M2.3）
// 货币总量监控（玩家 + 商人台账现金之和）；通胀指数 = 当日成交价中位数 / 前 7 日中位数；
// 触发回收：造价/NPC 服务费/集市摊位费动态上浮（feeMultiplier 供 B8 历法与集市玩法接入）。
import type { App } from '../app.ts';
import { economyHookStatus } from '../world/economy-gates.ts';
import { DEFAULT_ECONOMY, type EconomyTable } from '../world/tables.ts';

const DAY_MS = 86_400_000;

/** 交易所/银行系统手续费（B3 通缩回收）：成交时按成交额 10% 从卖方所得扣除并烧币（不入任何账），
 *  货币总量随之下降，对冲"打工/卖货投放"造成的通胀。固定 10%（原 feeMultiplier 动态上浮为正交的第二层回收）。 */
export const TRADE_FEE_RATE = 0.10;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 回收档位：通胀指数越高，费用上浮越多（截断护栏：最高 1.5x） */
export function feeMultiplier(index: number | null): number {
  if (index === null || index <= 1.1) return 1.0;
  if (index <= 1.3) return 1.15;
  if (index <= 1.5) return 1.3;
  return 1.5;
}

/** 经济设计总账（N10）：设计值（economy-tables.json）与实盘值的偏差，供 /af/economy-design 与经济总账门消费 */
export interface EconomyDesignReport {
  tableVersion: number;
  policy: EconomyTable['policy'];
  fees: EconomyTable['fees'];
  inflationTarget: { bandLow: number; bandHigh: number; warn: number; critical: number };
  actual: { moneySupply: number; inflationIndex: number | null; todayMedian: number | null; weekMedian: number | null; feeMultiplier: number; tradeFeeRate: number };
  /** 作物设计 vs 实际：basePrice 用的是设计覆盖，drift 只反映市场成交价偏离 */
  crops: Array<{
    name: string; cropItemId: number; seedItemId: number; seedCost: number; sellPrice: number;
    roi: number; growDays: number; hourlyAt8Plots: number;
    npcUnitNow: number; marketBaseNow: number; medianFilled: number | null; driftVsBase: number | null;
  }>;
  gather: EconomyTable['gather'];
  alerts: string[];
}

export function economyDesignReport(app: App): EconomyDesignReport {
  const t = app.tables.economy || DEFAULT_ECONOMY;
  const actual = economyReport(app);
  const rows: EconomyDesignReport['crops'] = [];
  for (const c of t.crops || []) {
    // 实盘成交中位（该物品近 7 日）
    const weekAgo = Date.now() - 7 * DAY_MS;
    const q = app.db.prepare('SELECT price FROM market_fills WHERE item_id = ? AND ts >= ?').all(c.cropItemId, weekAgo) as Array<{ price: number }>;
    const medianFilled = median(q.map(r => r.price));
    const base = app.tables.basePriceOf(c.cropItemId);
    rows.push({
      name: c.name, cropItemId: c.cropItemId, seedItemId: c.seedItemId,
      seedCost: c.seedCost, sellPrice: c.sellPrice, roi: c.roi, growDays: c.growDays, hourlyAt8Plots: c.hourlyAt8Plots,
      npcUnitNow: app.tables.npcUnitPrice(c.seedItemId),
      marketBaseNow: base,
      medianFilled,
      driftVsBase: medianFilled === null ? null : Number((medianFilled / base).toFixed(3)),
    });
  }
  const alerts: string[] = [];
  const target = app.tables.inflationTarget();
  if (actual.inflationIndex !== null && actual.inflationIndex > target.critical) alerts.push(`通胀指数 ${actual.inflationIndex.toFixed(2)} 超顶格线 ${target.critical}`);
  else if (actual.inflationIndex !== null && actual.inflationIndex > target.warn) alerts.push(`通胀指数 ${actual.inflationIndex.toFixed(2)} 超警戒线 ${target.warn}`);
  for (const r of rows) if (r.driftVsBase !== null && (r.driftVsBase < 0.6 || r.driftVsBase > 1.6)) alerts.push(`${r.name} 成交中位偏离基价 ${Math.round((r.driftVsBase - 1) * 100)}%`);
  return {
    tableVersion: t.version, policy: t.policy, fees: t.fees, inflationTarget: target,
    actual: {
      moneySupply: actual.moneySupply, inflationIndex: actual.inflationIndex,
      todayMedian: actual.todayMedian, weekMedian: actual.weekMedian,
      feeMultiplier: actual.feeMultiplier, tradeFeeRate: actual.tradeFeeRate,
    },
    crops: rows, gather: t.gather, alerts,
  };
}

export interface EconomyReport {
  moneySupply: number;
  todayMedian: number | null;
  weekMedian: number | null;
  inflationIndex: number | null;
  feeMultiplier: number;
  tradeFeeRate: number; // 交易所/银行固定手续费（通缩回收），见 TRADE_FEE_RATE
  /** 经济类钩子冻结闸状态（M-B1 影子窗判门前全 false；运营按 AF_ECON_HOOKS 解冻） */
  hooksFrozen: Record<string, boolean>;
  alerts: string[];
}

/** 货币总量：玩家背包现金（item 1）+ 商人台账现金 */
export function moneySupplyOf(state: import('../persistence/state.ts').WorldState, db: import('node:sqlite').DatabaseSync): number {
  let total = 0;
  for (const pm of state.playersDb.values()) {
    const kn = pm.get('knapData') as { props?: Array<{ id: number; num?: number }> } | undefined;
    const c = kn?.props?.find(p => p.id === 1);
    total += c?.num ?? 0;
  }
  for (const r of db.prepare('SELECT cash FROM merchants').all() as Array<{ cash: number }>) total += r.cash;
  return total;
}

/** 通胀指数 = 当日成交均价中位数 / 前 7 日中位数（缺数据为 null） */
export function computeInflation(app: App): { todayMedian: number | null; weekMedian: number | null; index: number | null } {
  const db = app.db;
  const dayStart = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const weekStart = dayStart - 6 * DAY_MS;
  const pick = (from: number, to: number | null) => {
    const q = to === null
      ? db.prepare('SELECT price FROM market_fills WHERE ts >= ?').all(from)
      : db.prepare('SELECT price FROM market_fills WHERE ts >= ? AND ts < ?').all(from, to);
    return median((q as Array<{ price: number }>).map(r => r.price));
  };
  const todayMedian = pick(dayStart, null);
  const weekMedian = pick(weekStart, dayStart);
  const index = todayMedian !== null && weekMedian !== null && weekMedian > 0 ? todayMedian / weekMedian : null;
  return { todayMedian, weekMedian, index };
}

export function economyReport(app: App): EconomyReport {
  const { todayMedian, weekMedian, index } = computeInflation(app);
  const supply = moneySupplyOf(app.state, app.db);
  const mult = feeMultiplier(index);
  const alerts: string[] = [];
  if (index !== null && index > 1.5) alerts.push(`通胀严重（指数 ${index.toFixed(2)}），费用已顶格上浮 1.5x`);
  else if (mult > 1) alerts.push(`通胀回收启动：费用上浮至 ${mult}x（指数 ${index!.toFixed(2)}）`);
  if (supply > 500_000) alerts.push(`货币总量偏高（${supply}），关注回收节奏`);
  // 钩子冻结态走 hooksFrozen 字段，不混进 alerts（alerts 是通胀/总量告警语义）
  return { moneySupply: supply, todayMedian, weekMedian, inflationIndex: index, feeMultiplier: mult, tradeFeeRate: TRADE_FEE_RATE, hooksFrozen: economyHookStatus(), alerts };
}
