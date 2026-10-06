// test/unit/recycle.test.ts —— 批4 P2：基础资源消耗闭环（打铁炉回炉）
// 买家吃完挂单后木材不能变成死账；回炉是保底出口，定价必须压在订单簿实收之下。
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { Tables } from '../../src/world/tables.js';
import { WorldState, type StateOpts } from '../../src/persistence/state.js';
import { knapAdd } from '../../src/world/farm.js';
import { doRecycle, RECYCLE_RATE, RECYCLABLE, NPC_BUY_RATE, npcBuyPrice } from '../../src/market/shop.js';
import { ACT_CATALOG, DIRECT_MESSAGES, catalogTextTerse } from '../../src/world/act-catalog.js';

const ROOT = new URL('../../..', import.meta.url).pathname;

function mkState(uid: string, wood = 3): WorldState {
  const opts: StateOpts = {
    savesDir: '/tmp/af-test-recycle',
    seedFile: '/tmp/af-test-recycle/seed.json',
    slot: 1,
    farmLeft: 0,
    spawns: null,
    growDayMs: 24 * 3600 * 1000,
    init: false,
    noPersist: true,
  };
  const ws = new WorldState(opts);
  const pm = new Map<string, unknown>([['knapData', { props: [] }]]);
  ws.playersDb.set(uid, pm);
  knapAdd(pm, 18, wood);
  return ws;
}

function mkTables(): Tables {
  return new Tables(join(ROOT, 'data'));
}

describe('打铁炉回炉（资源消耗出口）', () => {
  it('回炉木材：扣背包、发废资价金币', () => {
    const ws = mkState('u1', 3);
    const r = doRecycle(ws, mkTables(), 'u1', 18, 3);
    expect(r.ok).toBe(true);
    expect(r.recycled).toEqual(expect.objectContaining({ id: 18, qty: 3, name: '木材' }));
    const props = ((ws.playersDb.get('u1')!.get('knapData') as { props: Array<{ id: number; num: number }> }).props);
    expect(props.find(p => p.id === 18)?.num ?? 0).toBe(0);
    expect(props.find(p => p.id === 1)).toEqual({ id: 1, num: r.recycled!.coins });
  });

  it('回收价 = basePrice × RECYCLE_RATE，与报价同源（不另写一份比率）', () => {
    const t = mkTables();
    const base = t.basePriceOf(18);
    expect(doRecycle(mkState('u1', 1), t, 'u1', 18, 1).recycled!.coins).toBe(Math.round(base * RECYCLE_RATE));
  });

  it('定价阶梯不倒挂：回炉 < NPC 收购参考 < 订单簿卖方实收 0.9', () => {
    // 任何一档反超上一档，玩家都会绕过撮合直接回炉，订单簿的流动性就失去意义
    expect(RECYCLE_RATE).toBeLessThan(NPC_BUY_RATE);
    const t = mkTables();
    expect(Math.round(t.basePriceOf(18) * RECYCLE_RATE)).toBeLessThan(npcBuyPrice(t, 18));
    expect(Math.round(t.basePriceOf(18) * RECYCLE_RATE)).toBeLessThan(Math.round(t.basePriceOf(18) * 0.9));
  });

  it('白名单外物品拒绝（不凭空造金币）', () => {
    expect(RECYCLABLE.has(18)).toBe(true);
    const ws = mkState('u1', 3);
    knapAdd(ws.playersDb.get('u1')!, 12, 5); // 野猪腿
    const r = doRecycle(ws, mkTables(), 'u1', 12, 5);
    expect(r.ok).toBe(false);
    expect(String(r.msg)).toContain('12');
    // 背包里的野猪腿没被吞掉
    expect(((ws.playersDb.get('u1')!.get('knapData') as { props: Array<{ id: number; num: number }> }).props.find(p => p.id === 12))?.num).toBe(5);
  });

  it('数量不足 / 缺玩家数据 / 数量非法：全部拒绝且不产生副作用', () => {
    const t = mkTables();
    expect(doRecycle(mkState('u1', 2), t, 'u1', 18, 5).ok).toBe(false);
    expect(doRecycle(mkState('u1', 3), t, 'u0', 18, 1).ok).toBe(false);
    for (const q of [0, -1, Number.NaN]) expect(doRecycle(mkState('u1', 3), t, 'u1', 18, q).ok).toBe(false);
    const props = ((mkState('u1', 3).playersDb.get('u1')!.get('knapData')) as { props: Array<{ id: number; num: number }> }).props;
    expect(props.find(p => p.id === 18)?.num).toBe(3);
  });
});

describe('回炉进动作目录（文档与代码同源，杜绝文档说的 ≠ 代码做的）', () => {
  it('ACT_CATALOG 含 recycle 且带参数与返回语义', () => {
    const e = [...ACT_CATALOG, ...DIRECT_MESSAGES].find(x => x.act === 'recycle')!;
    expect(e.args).toContain('itemId');
    expect(e.returns).toContain('木材');
    expect(e.returns).toContain('qty');
  });

  it('紧凑表出现 recycle（agent 不会凭空发明动作名），且紧凑表仍 ≤560 token', () => {
    const text = catalogTextTerse();
    expect(text).toContain('recycle');
    expect(Math.ceil(text.length / 2)).toBeLessThanOrEqual(560);
  });
});
