import { describe, it, expect } from 'vitest';
import { WorldState, type StateOpts } from '../../src/persistence/state.js';
import { knapAdd } from '../../src/world/farm.js';
import { publish, accept, complete, listFor } from '../../src/world/delegate.js';

function mkState(): WorldState {
  return new WorldState({ savesDir: '/tmp/x', seedFile: '/tmp/x/s.json', slot: 1, farmLeft: 0, spawns: null, growDayMs: 24 * 3600 * 1000, init: false, noPersist: true } as StateOpts);
}

function withCoins(ws: WorldState, uid: string, coins: number) {
  let pm = ws.playersDb.get(uid);
  if (!pm) { pm = new Map(); ws.playersDb.set(uid, pm); }
  if (coins > 0) knapAdd(pm, 1, coins);
}

function coinsOf(ws: WorldState, uid: string): number {
  const knap = (ws.playersDb.get(uid)?.get('knapData') as { props?: Array<{ id?: number; num?: number }> } | undefined)?.props;
  if (!knap) return 0;
  return knap.filter(x => x.id === 1).reduce((s, x) => s + (x.num || 0), 0);
}

describe('委托栏（F 包 R7）', () => {
  it('发布（金币充足）-> 接取 -> 完成结算转账', () => {
    const ws = mkState();
    withCoins(ws, 'pub', 500);
    withCoins(ws, 'acc', 0);
    const p = publish(ws, 'pub', '砍 5 棵树', 1, 200, 100);
    expect(p.ok).toBe(true);
    const id = p.id!;
    const pubBefore = coinsOf(ws, 'pub');   // 500
    const accBefore = coinsOf(ws, 'acc');   // 0
    expect(accept(ws, id, 'acc', 101)).toMatchObject({ ok: true });
    expect(complete(ws, id, 102)).toMatchObject({ ok: true });
    expect(coinsOf(ws, 'pub')).toBe(pubBefore - 200);
    expect(coinsOf(ws, 'acc')).toBe(accBefore + 200);
  });

  it('不能接自己的委托', () => {
    const ws = mkState();
    withCoins(ws, 'pub', 100);
    const p = publish(ws, 'pub', '任务', 1, 10, 100)!;
    expect(accept(ws, p.id!, 'pub', 101)).toMatchObject({ ok: false });
  });

  it('破产：完成时冻结金不足 -> 自动关闭', () => {
    const ws = mkState();
    withCoins(ws, 'pub', 100);
    withCoins(ws, 'acc', 0);
    const p = publish(ws, 'pub', '任务', 1, 100, 100)!;
    accept(ws, p.id!, 'acc', 101);
    // 扣掉发布方金币使其破产
    const pmPub = ws.playersDb.get('pub')!;
    const knap = pmPub.get('knapData') as { props: Array<{ id?: number; num?: number }> };
    for (const pr of knap.props) if (pr.id === 1) pr.num = 0;
    const r = complete(ws, p.id!, 102);
    expect(r.ok).toBe(false);
  });

  it('金币不足不可发布', () => {
    const ws = mkState();
    withCoins(ws, 'pub', 10);
    const p = publish(ws, 'pub', '任务', 1, 999, 100);
    expect(p.ok).toBe(false);
  });

  it('listFor 过滤 by / accepted', () => {
    const ws = mkState();
    withCoins(ws, 'pub', 1000);
    publish(ws, 'pub', '任务A', 1, 10, 100);
    publish(ws, 'pub', '任务B', 1, 10, 101);
    expect(listFor(ws, 'pub', 'by').length).toBe(2);
  });
});
