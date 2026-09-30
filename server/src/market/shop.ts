// market/shop.ts —— NPC 商店（价目表 + 询价 + 购买）
// 说明：当前为"固定价目 NPC 商人"实现；B1（M2.1）将替换为 CDA 订单簿撮合引擎。
import type { Tables } from '../world/tables.ts';
import type { WorldState } from '../persistence/state.ts';
import { knapAdd, knapSub } from '../world/farm.ts';

/** 物品卖出价 ×2（NPC 商人价目基价） */
export function sellX2(tables: Tables, itemId: number): number {
  const it = tables.items.find(x => x.id === itemId);
  return it && typeof it.sell_price === 'number' ? it.sell_price * 2 : 0;
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

/** 购买（价目优先取 SHOP_TABLE，其次 sell_price * 2；金币不足/不可买给出原因） */
export function doBuy(state: WorldState, tables: Tables, uid: string, itemId: number, count: number, shop: Record<number, Array<[number, number]>>): BuyResult {
  const it = tables.items.find(x => x.id === itemId);
  if (!it) return { ok: false, msg: '没有这个物品' };
  let shopPrice: number | null = null;
  for (const [, s] of Object.entries(shop)) {
    const entry = s.find(([id]) => id === itemId);
    if (entry) { shopPrice = entry[1]; break; }
  }
  const price = shopPrice ?? (typeof it.sell_price === 'number' && it.sell_price > 0 ? it.sell_price * 2 : null);
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
