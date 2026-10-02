import { describe, it, expect } from 'vitest';
import { openLease, care, tickLease, regrow, stormWarning } from '../../src/world/lease.js';
import { WorldState, type StateOpts } from '../../src/persistence/state.js';

function mkState(): WorldState {
  return new WorldState({ savesDir: '/tmp/x', seedFile: '/tmp/x/s.json', slot: 1, farmLeft: 0, spawns: null, growDayMs: 24 * 3600 * 1000, init: false, noPersist: true } as StateOpts);
}

describe('租约与再生（D 包/M-O2）', () => {
  it('起租 -> 未超租约不枯萎', () => {
    const ws = mkState();
    openLease(ws, 'p1', 'u1', 0, 100);
    expect(tickLease(ws, 50)).toEqual([]);
  });

  it('超租约 -> 枯萎并排定再生', () => {
    const ws = mkState();
    openLease(ws, 'p1', 'u1', 0, 100);
    expect(tickLease(ws, 101)).toEqual(['p1']);
  });

  it('照料延长租约（上限内）', () => {
    const ws = mkState();
    openLease(ws, 'p1', 'u1', 0, 100);
    care(ws, 'p1', 'u1', 50, 100);
    // 延长后租约 > 100，tick 150 不应枯萎
    expect(tickLease(ws, 150)).toEqual([]);
  });

  it('照料上限防无限占位', () => {
    const ws = mkState();
    openLease(ws, 'p1', 'u1', 0, 100);
    for (let i = 0; i < 9; i++) care(ws, 'p1', 'u1', i * 10, 1000);
    // 最多 5 次有效延长
    const w = tickLease(ws, 5200 + 1);
    expect(w).toEqual(['p1']);
  });

  it('非持有者照料无效', () => {
    const ws = mkState();
    openLease(ws, 'p1', 'u1', 0, 100);
    expect(care(ws, 'p1', 'u2', 10, 100)).toBeNull();
  });

  it('再生：枯萎后到再生点释放田块', () => {
    const ws = mkState();
    openLease(ws, 'p1', 'u1', 0, 100);
    tickLease(ws, 101);
    const freed = regrow(ws, 101 + 300);
    expect(freed).toEqual(['p1']);
    // 再生后可被他人重新起租
    openLease(ws, 'p1', 'u2', 101 + 300, 100);
    expect(tickLease(ws, 101 + 300 + 50)).toEqual([]);
  });

  it('风暴预警：临期未照料 -> 预警', () => {
    const ws = mkState();
    openLease(ws, 'p1', 'u1', 0, 100);
    expect(stormWarning(ws, 90, 30)).toContain('p1'); // 距到期 10 <= 30
    expect(stormWarning(ws, 10, 30)).toEqual([]); // 距到期 90 > 30
  });

  it('枯萎后不再预警', () => {
    const ws = mkState();
    openLease(ws, 'p1', 'u1', 0, 100);
    tickLease(ws, 101);
    expect(stormWarning(ws, 101, 30)).toEqual([]);
  });
});
