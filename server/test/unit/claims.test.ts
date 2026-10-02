import { describe, it, expect } from 'vitest';
import { tryClaim, release, holderOf, claimsOf, releaseAll, CLAIMS_KEY } from '../../src/world/claims';
import { WorldState, type StateOpts } from '../../src/persistence/state.js';

function mkState(): WorldState {
  const opts: StateOpts = {
    savesDir: '/tmp/af-test-claims',
    seedFile: '/tmp/af-test-claims/seed.json',
    slot: 1,
    farmLeft: 0,
    spawns: null,
    growDayMs: 24 * 3600 * 1000,
    init: false,
    noPersist: true, // 单测不落盘
  };
  return new WorldState(opts);
}

describe('资源抢占原子化（C 包/M-O2）', () => {
  it('空闲资源可抢占，fresh=true', () => {
    const ws = mkState();
    const r = tryClaim(ws, 'u1', 'tree', 'tree@3', 100);
    expect(r).toMatchObject({ ok: true, fresh: true });
  });

  it('同资源他人已占 -> 先到先得拒绝', () => {
    const ws = mkState();
    tryClaim(ws, 'u1', 'tree', 'tree@3', 100);
    const r = tryClaim(ws, 'u2', 'tree', 'tree@3', 101) as { ok: boolean; holder?: string };
    expect(r.ok).toBe(false);
    expect(r.holder).toBe('u1');
  });

  it('同主体重复抢占幂等（fresh=false 不重复）', () => {
    const ws = mkState();
    const a = tryClaim(ws, 'u1', 'mine', 'mine@5', 100);
    expect(a).toMatchObject({ ok: true, fresh: true });
    const b = tryClaim(ws, 'u1', 'mine', 'mine@5', 101);
    expect(b).toMatchObject({ ok: true, fresh: false });
  });

  it('过期后可被他人抢占', () => {
    const ws = mkState();
    tryClaim(ws, 'u1', 'stall', 'stall@east', 100, 200); // 200 过期
    const r = tryClaim(ws, 'u2', 'stall', 'stall@east', 201) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(holderOf(ws, 'stall', 'stall@east')).toBe('u2');
  });

  it('未过期他人不可抢', () => {
    const ws = mkState();
    tryClaim(ws, 'u1', 'plot', 'plot@1', 100, 500);
    expect((tryClaim(ws, 'u2', 'plot', 'plot@1', 300) as { ok: boolean }).ok).toBe(false);
  });

  it('holderOf / claimsOf / releaseAll', () => {
    const ws = mkState();
    tryClaim(ws, 'u1', 'tree', 'a', 1);
    tryClaim(ws, 'u1', 'mine', 'b', 1);
    tryClaim(ws, 'u2', 'tree', 'c', 1);
    expect(claimsOf(ws, 'u1').length).toBe(2);
    expect(holderOf(ws, 'tree', 'a')).toBe('u1');
    expect(releaseAll(ws, 'u1')).toBe(2);
    expect(holderOf(ws, 'tree', 'a')).toBeNull();
    expect(holderOf(ws, 'tree', 'c')).toBe('u2');
  });

  it('release 仅持有者可释放', () => {
    const ws = mkState();
    tryClaim(ws, 'u1', 'tree', 'a', 1);
    expect(release(ws, 'u2', 'tree', 'a')).toBe(false);
    expect(holderOf(ws, 'tree', 'a')).toBe('u1');
    expect(release(ws, 'u1', 'tree', 'a')).toBe(true);
  });

  it('claimsData 登记进 WORLD_KEYS（回放参与哈希）', () => {
    expect(CLAIMS_KEY).toBe('claimsData');
  });
});
