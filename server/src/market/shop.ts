// market/shop.ts —— NPC 商店（价目表 + 询价 + 购买）
// 说明：当前为"固定价目 NPC 商人"实现；B1（M2.1）将替换为 CDA 订单簿撮合引擎。
import type { Tables } from '../world/tables.ts';
import type { WorldState } from '../persistence/state.ts';
import { knapAdd, knapHas, knapSub } from '../world/farm.ts';

/** NPC 基准价（items.sell_price x 2，种子类按 N10 折扣 —— 见 Tables.npcUnitPrice） */
export function sellX2(tables: Tables, itemId: number): number {
  return tables.npcUnitPrice(itemId);
}

/**
 * NPC 收购折扣（规划书 §3.1 价格摘要口径：NPC 收购 6 折）。
 * 唯一数值源：任何地方要报「NPC 收购价」都必须走 npcBuyPrice，
 * 规则提示词/对话/文档都不得另写一份 0.6。
 * 注意与 economy-tables.policy.seedPriceMul（当前也是 0.6，但那是**种子买入折扣**）是两回事：
 * 两者数值相同纯属巧合，改动其一会让种子行的「收购参考」与买入价关系漂移 —— 靠测试盯住。
 */
export const NPC_BUY_RATE = 0.6;

/** NPC 收购价 = 市场基价 × NPC_BUY_RATE（向下取整，最少 1 金币）
 *  注意：这是**规则参考口径**（spec §3.1），NPC 商店本身没有买入/回收动作。
 *  agent 报这个数时必须同时说明卖出走 act trade place sell 挂订单簿（含 10% 手续费），
 *  否则等于教 LLM 把参考口径当成实际卖出价。 */
export function npcBuyPrice(tables: Tables, itemId: number): number {
  return Math.max(1, Math.round(tables.basePriceOf(itemId) * NPC_BUY_RATE));
}

/**
 * 玩家实付价（与 doBuy 同一解析顺序：商店价目 → npcUnitPrice → 0=不可购买）。
 * 规则提示词必须报这个数：basePriceOf 对 sell_price=0 的物品会兜底成 50（凭空价），
 * 且种子少了 seedPriceMul 折扣，两者都不是玩家真实付出的金币。
 */
export function buyPriceOf(tables: Tables, itemId: number, shop?: Record<number, Array<[number, number]>>): number {
  const table = shop ?? shopTable(tables);
  for (const list of Object.values(table)) {
    const hit = list.find(([id]) => id === itemId);
    if (hit) return hit[1];
  }
  return tables.npcUnitPrice(itemId);
}

/**
 * 回收出口（批4 P2：基础资源消耗闭环）。
 * 木材此前只有两个去向——挂订单簿等撮合、或者躺在背包里当死账。买方吃完卖方挂单后
 * 手里压着木材却没有任何合法出口把它变成生产力，「砍伐→挂单→购买」这条链在买方手里断了。
 * 这里补一个「打铁炉回炉」：直接烧成炉灰换回废资价，走通「砍伐→挂单→购买→消耗」。
 *
 * 定价阶梯（低→高，故意留档，任何一档不能反超上一档，否则玩家会绕过撮合）：
 *   回炉 RECYCLE_RATE 0.5  <  NPC 收购参考 NPC_BUY_RATE 0.6  <  订单簿卖方实收 0.9
 * 所以回炉只在「没买家 / 不想等撮合」时作保底出口，日常卖货仍走订单簿。
 * 唯一数值源：报「回收价」一律走 RECYCLE_RATE，不要在对话/文档里另写一个比率。
 */
export const RECYCLE_RATE = 0.5;

/** 可回炉的原料（id=18 木材）。扩展时在 doRecycle 的报错文案里同步说明白名单。 */
export const RECYCLABLE = new Set([18]);

export interface RecycleResult {
  ok: boolean; msg?: string;
  recycled?: { id: number; name: string; qty: number; coins: number };
  coins?: number;
}

/** 打铁炉回炉：烧掉原料换废资价金币（回收价 = basePrice × RECYCLE_RATE） */
export function doRecycle(state: WorldState, tables: Tables, uid: string, itemId: number, qty: number): RecycleResult {
  if (!RECYCLABLE.has(itemId)) return { ok: false, msg: `打铁炉只回炉木材（id=18）；物品 ${itemId} 不能回炉` };
  if (!Number.isFinite(qty) || qty < 1) return { ok: false, msg: '数量需 ≥1' };
  const pm = state.playersDb.get(uid);
  if (!pm) return { ok: false, msg: '玩家数据不存在' };
  if (!knapHas(pm, itemId, qty)) return { ok: false, msg: `背包木材不足（需要 ${qty}）` };
  const coins = Math.round(tables.basePriceOf(itemId) * RECYCLE_RATE) * qty;
  knapSub(pm, itemId, qty);
  knapAdd(pm, 1, coins);
  state.persist();
  return { ok: true, recycled: { id: itemId, name: tables.items.find(x => x.id === itemId)?.name || '物品' + itemId, qty, coins }, coins };
}

// NPC 商店价目（服务器内部；agent 通过 talk 向 NPC 询价获得）
export function shopTable(tables: Tables): Record<number, Array<[number, number]>> {
  return {
    4: [[12, sellX2(tables, 12)], [10, sellX2(tables, 10)], [19, sellX2(tables, 19)]],          // 屠夫：野猪腿/六眼飞鱼/杂鱼
    6: [[18, sellX2(tables, 18)], [7, sellX2(tables, 7)]],                                       // 木匠：木材/水磨石
    13: [[28, sellX2(tables, 28)], [29, sellX2(tables, 29)], [30, sellX2(tables, 30)], [15, sellX2(tables, 15)], [16, sellX2(tables, 16)], [77, 200], [78, 500], [79, 1200]], // 杂货店
    7: [[28, sellX2(tables, 28)], [29, sellX2(tables, 29)]],                                       // 村长：粮食
    25: [[22, sellX2(tables, 22)]],                                                                // 医生：陷阱（临时）
  };
}

export interface BuyResult { ok: boolean; msg?: string; bought?: { id: number; name: string; count: number; total: number }; coins?: number; }

/** 购买（价目优先取 shopTable；缺项走 N10 口径 NPC 基准价 = items.sell_price x 2，种子类打折） */
export function doBuy(state: WorldState, tables: Tables, uid: string, itemId: number, count: number, shop: Record<number, Array<[number, number]>>): BuyResult {
  const it = tables.items.find(x => x.id === itemId);
  if (!it) return { ok: false, msg: '没有这个物品' };
  let shopPrice: number | null = null;
  for (const [, s] of Object.entries(shop)) {
    const entry = s.find(([id]) => id === itemId);
    if (entry) { shopPrice = entry[1]; break; }
  }
  const npcUnit = tables.npcUnitPrice(itemId);
  const price = shopPrice ?? (npcUnit > 0 ? npcUnit : null);
  if (price === null) return { ok: false, msg: '该物品不可购买' };
  const pm = state.playersDb.get(uid);
  if (!pm) return { ok: false, msg: '玩家数据不存在' };
  const kn = (pm.get('knapData') as { props?: Array<{ id: number; num: number }> } | undefined) || { props: [] };
  if (!kn.props) kn.props = [];
  const coinsProp = kn.props.find(p => p.id === 1);
  const coins = coinsProp ? (coinsProp.num || 0) : 0;
  const total = price * count;
  if (coins < total) return { ok: false, msg: `金币不足（需要 ${total}，现有 ${coins}）` };
  if (!coinsProp) kn.props.push({ id: 1, num: 0 });
  kn.props.find(p => p.id === 1)!.num = coins - total;
  const exist = kn.props.find(p => p.id === itemId);
  if (exist) exist.num = (exist.num || 0) + count;
  else kn.props.push({ id: itemId, num: count });
  pm.set('knapData', kn);
  state.persist();
  return { ok: true, bought: { id: itemId, name: it.name ?? '道具' + itemId, count, total }, coins: coins - total };
}
