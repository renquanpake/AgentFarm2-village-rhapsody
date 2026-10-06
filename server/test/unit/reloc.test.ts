import { describe, it, expect } from 'vitest';
import {
  cellKindOf, stdRingOf, bestStandCell, targetUnreachableMsg, moveFailMsg, actionPrecheck, chopReachable,
} from '../../src/navigation/reloc.ts';
import { buildNavGrid, type NavGrid } from '../../src/navigation/navgen.ts';

// 5x5：中心 (2,2) 为水（blocked=1, water=1）→ kind=2；(2,1) 为纯障碍 → kind=1
function grid5(): NavGrid {
  const blocked = new Array(25).fill(0);
  blocked[2 * 5 + 2] = 1; // 水格
  blocked[1 * 5 + 2] = 1; // 障碍格
  const water = new Array(25).fill(0);
  water[2 * 5 + 2] = 1;
  return buildNavGrid(9, blocked, 5, 5, water);
}

describe('cellKindOf', () => {
  it('out/blocked/water/open 五类', () => {
    const n = grid5();
    expect(cellKindOf(n, 5, 0)).toBe('out');
    expect(cellKindOf(n, -1, 0)).toBe('out');
    expect(cellKindOf(n, 2, 1)).toBe('block');
    expect(cellKindOf(n, 2, 2)).toBe('water');
    expect(cellKindOf(n, 0, 0)).toBe('open');
  });
  it('无 nav（null 场景）视为 out 由调用方兜底', () => {
    // reloc 纯函数层不接收 null nav；跨场景 null 在 ws 层判
  });
});

describe('stdRingOf', () => {
  it('环形升序：先 r=1 八格', () => {
    const n = grid5();
    const ring = stdRingOf(n, 0, 0, 1);
    // maxR=1 含 r=0 自身 + r=1 环；(0,0) 角上 8 邻可走的只有 (1,0)(0,1)(1,1)
    expect(ring).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
  });
  it('maxR=0 仅自身（若自身可走）', () => {
    const n = grid5();
    expect(stdRingOf(n, 0, 0, 0)).toEqual([[0, 0]]);
    expect(stdRingOf(n, 2, 2, 0)).toEqual([]); // 水格自身不可站
  });
  it('水格与障碍格的环', () => {
    const n = grid5();
    const ring = stdRingOf(n, 2, 2, 1);
    expect(ring[3]).toEqual([3, 2]);
    expect(ring).not.toContain([2, 1] as [number, number]); // 障碍不入
    expect(ring).not.toContain([2, 2] as [number, number]); // 水格自身不入
  });
});

describe('bestStandCell', () => {
  it('切比雪夫最近且平局取列升序', () => {
    const n = grid5();
    // 目标 (2,2) 水格；from=(4,4)：最近可站 (3,3)（同距 1 按环遍历序先命中）
    expect(bestStandCell(n, 2, 2, [4, 4])).toEqual([3, 3]);
    // 全封锁返回 null
    const all = buildNavGrid(9, new Array(25).fill(1), 5, 5);
    expect(bestStandCell(all, 2, 2, [4, 4], 8)).toBeNull();
  });
});

describe('targetUnreachableMsg / moveFailMsg', () => {
  it('目标不可达文案点名格坐标与来源', () => {
    const n = grid5();
    const msg = targetUnreachableMsg([2, 2], cellKindOf(n, 2, 2), bestStandCell(n, 2, 2, [0, 0]));
    expect(msg).toMatch(/2,2/);
    expect(msg).toMatch(/水面/);
    expect(msg).toMatch(/建议|move_to/);
  });
  it('out 格（跨场景门位）文案不误导为水', () => {
    const msg = targetUnreachableMsg([4, 4], 'out', null);
    expect(msg).toMatch(/越界|边界/);
    expect(msg).not.toMatch(/水面/);
  });
  it('moveFailMsg 双端点名 + 目标格 kind 词', () => {
    const n = grid5();
    const msg = moveFailMsg([0, 0], [2, 2], n, null);
    expect(msg).toMatch(/0,0/);
    expect(msg).toMatch(/2,2/);
  });
});

describe('actionPrecheck（目标格动作三 reason）', () => {
  it('far：距离 >1 格保留旧短语前缀「离目标太远」', () => {
    const n = grid5();
    const r = actionPrecheck(n, [0, 0], [4, 4]);
    expect(r.ok).toBe(false);
    expect(r!.reason).toBe('far');
    expect(r!.msg).toMatch(/离目标太远/);
  });
  it('target-blocked：目标格自身不可站（水/障碍）点名 kind', () => {
    const n = grid5();
    const r = actionPrecheck(n, [2, 2], [3, 2]);
    expect(r.ok).toBe(false);
    expect(r!.reason).toBe('target-blocked');
    expect(r!.msg).toMatch(/2,2/);
    expect(r!.msg).toMatch(/水面/);
  });
  it('no-stand：目标格可走但 8 邻全不可站（孤岛环）', () => {
    // 手工造：(2,2) 可走，8 邻全 block
    const blocked = new Array(25).fill(1);
    blocked[2 * 5 + 2] = 0;
    const n = buildNavGrid(9, blocked, 5, 5);
    const r = actionPrecheck(n, [2, 2], [2, 2]);
    expect(r.ok).toBe(false);
    expect(r!.reason).toBe('no-stand');
  });
  it('全部通过 → ok', () => {
    const n = grid5();
    const r = actionPrecheck(n, [0, 0], [0, 0]);
    expect(r).toEqual({ ok: true } as const);
  });
});

describe('reloc：同场景不可达时吸附可站环重试（ws.ts 行为）', () => {
  it('目标格 blocked 但 8 邻有可站格 -> bestStandCell 给出可站环', () => {
    // 构造 3x3，中心(1,1) blocked，四周 open
    const blocked = [0,0,0, 0,1,0, 0,0,0];
    const n = buildNavGrid(9, blocked, 3, 3);
    const alt = bestStandCell(n, 1, 1, [0, 0], 1);
    expect(alt).not.toBeNull();
    expect(cellKindOf(n, alt[0], alt[1])).toBe('open');
  });
});

describe('actionPrecheck', () => {
  const nav5 = buildNavGrid(2, [0,0,0,0,0, 0,0,1,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0], 5, 5);
  it('far: 距离>1 报 far', () => {
    const r = actionPrecheck(nav5, [0,0], [4,4]);
    expect(r).toMatchObject({ ok: false, reason: 'far' });
    expect(r.msg).toMatch(/离目标太远/);
  });
  it('target-blocked: 目标格 blocked 报 target-blocked', () => {
    const r = actionPrecheck(nav5, [2,1], [2,1]);
    expect(r).toMatchObject({ ok: false, reason: 'target-blocked' });
    expect(r.msg).toMatch(/2,1/);
  });
  it('no-stand: 目标格可站但四周全 block 报 no-stand', () => {
    const blocked = [1,1,1,1,1, 1,1,0,1,1, 1,1,1,1,1, 0,0,0,0,0, 0,0,0,0,0];
    const n = buildNavGrid(2, blocked, 5, 5);
    const r = actionPrecheck(n, [2,1], [2,1]);
    expect(r).toMatchObject({ ok: false, reason: 'no-stand' });
  });
  it('ok: 目标格 open 且邻接可站', () => {
    const r = actionPrecheck(nav5, [0,0], [0,0]);
    expect(r).toEqual({ ok: true });
  });
});

describe('chopReachable（treesNear 假目标过滤）', () => {
  it('树长在阻挡格上 -> 不可砍（actionPrecheck 会报 target-blocked）', () => {
    const nav = buildNavGrid(2, [0,0,0,0,0, 0,0,1,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0], 5, 5);
    expect(cellKindOf(nav, 2, 1)).toBe('block');
    expect(chopReachable(nav, 2, 1)).toBe(false);
  });
  it('树长在水格 / 树丛格上 -> 不可砍', () => {
    const blocked = new Array(25).fill(0);
    blocked[2 * 5 + 2] = 1;
    const water = new Array(25).fill(0);
    water[2 * 5 + 2] = 1;
    const trees = new Array(25).fill(0);
    trees[3 * 5 + 3] = 1;
    const nav = buildNavGrid(2, blocked, 5, 5, water, trees);
    expect(cellKindOf(nav, 2, 2)).toBe('water');
    expect(cellKindOf(nav, 3, 3)).toBe('tree');
    expect(chopReachable(nav, 2, 2)).toBe(false);
    expect(chopReachable(nav, 3, 3)).toBe(false);
  });
  it('树长在孤岛空地（四周全阻挡）-> 不可砍（actionPrecheck 会报 no-stand）', () => {
    const blocked = [1,1,1,1,1, 1,1,0,1,1, 1,1,1,1,1, 0,0,0,0,0, 0,0,0,0,0];
    const nav = buildNavGrid(2, blocked, 5, 5);
    expect(cellKindOf(nav, 2, 1)).toBe('open');
    expect(chopReachable(nav, 2, 1)).toBe(false);
  });
  it('正常空地树 -> 可砍', () => {
    expect(chopReachable(buildNavGrid(2, new Array(25).fill(0), 5, 5), 2, 2)).toBe(true);
  });
  it('nav 为 null（非村景/无网格）不过滤，保持下发', () => {
    expect(chopReachable(null, 71, 0)).toBe(true);
  });
});

