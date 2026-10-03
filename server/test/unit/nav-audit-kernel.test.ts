// nav-audit-kernel.test —— 障碍审计纯函数内核（批1a Task1）
import { describe, it, expect } from 'vitest';
import { rectMisses, unattributedCells, portalsBidirectional, isolatedCell, nearestStand, type AuditRect } from '../../src/navigation/audit.ts';
import { buildNavGrid, type NavGrid, type Portal } from '../../src/navigation/navgen.ts';


function nav(w: number, h: number, blocked: number[], water?: number[]): NavGrid {
  return buildNavGrid(2, blocked, w, h, water);
}

describe('rectMisses', () => {
  it('报告矩形内未被登记的格（精确坐标）', () => {
    const w = 5, h = 5;
    const blocked = new Array(25).fill(0);
    blocked[2 * 5 + 2] = 1;           // (2,2) 已挡
    const r: AuditRect = { name: '气象台', x: 2, y: 1, w: 2, h: 3 }; // (2,1)-(3,3)
    const miss = rectMisses(w, h, blocked, r);
    expect(miss).toEqual([[2, 1], [3, 1], [3, 2], [2, 3], [3, 3]]); // (2,2) 已挡被排除，行主序 y 后 x
  });
  it('越界 rect 部分也计入漏登', () => {
    const blocked = [0, 0, 0, 0];
    expect(rectMisses(2, 2, blocked, { name: 'x', x: 1, y: 1, w: 3, h: 1 })).toEqual([[1, 1], [2, 1], [3, 1]]);
  });
});

describe('unattributedCells', () => {
  it('每个阻挡格都有归因来源则漏网格为空', () => {
    const blocked = [1, 1, 0, 1];
    const attrib = [
      { name: 'fanzi', mask: [1, 1, 0, 0] },
      { name: 'shuich', mask: [0, 0, 0, 1] },
    ];
    const r = unattributedCells(2, 2, blocked, attrib);
    expect(r.unattributed).toEqual([]);
    expect(r.perSource.fanzi).toBe(2);
    expect(r.perSource.shuich).toBe(1);
  });
  it('未覆盖的阻挡格被点名', () => {
    const blocked = [1, 1, 0, 1];
    const r = unattributedCells(2, 2, blocked, [{ name: 'fanzi', mask: [1, 0, 0, 0] }]);
    expect(r.unattributed).toEqual([[1, 0], [1, 1]]); // idx=1/3 未覆盖
  });
});

describe('portalsBidirectional', () => {
  const w = 4, h = 4;
  const open = new Array(16).fill(0);
  const nA = nav(w, h, open);
  it('双向齐备无违规', () => {
    const ps: Portal[] = [
      { scene: 1, toScene: 2, x: 100, y: 100 },
      { scene: 2, toScene: 1, x: 300, y: 300 },
    ];
    expect(portalsBidirectional(ps, (sc) => (sc === 1 ? nA : sc === 2 ? nA : null))).toEqual([]);
  });
  it('缺反向门户报违规行', () => {
    const ps: Portal[] = [{ scene: 1, toScene: 2, x: 100, y: 100 }];
    const v = portalsBidirectional(ps, (sc) => (sc === 1 ? nA : null));
    expect(v.length).toBe(1);
    expect(v[0]).toContain('反向');
  });
  it('门位所在场景无导航数据报违规', () => {
    const ps: Portal[] = [{ scene: 9, toScene: 2, x: 0, y: 0 }, { scene: 2, toScene: 9, x: 0, y: 0 }];
    const v = portalsBidirectional(ps, (sc) => (sc === 2 ? nA : null));
    expect(v.some((s) => s.includes('无导航数据'))).toBe(true);
  });
  it('门位落阻挡格且吸附不到可走格报违规', () => {
    const wall = new Array(16).fill(0);
    for (let i = 0; i < 16; i++) wall[i] = 1; // 全阻挡
    const ps: Portal[] = [{ scene: 7, toScene: 2, x: 50, y: 50 }, { scene: 2, toScene: 7, x: 50, y: 50 }];
    const v = portalsBidirectional(ps, (sc) => (sc === 7 ? nav(w, h, wall) : nA), 2);
    expect(v.some((s) => s.includes('吸附'))).toBe(true);
  });
});

describe('isolatedCell / nearestStand', () => {
  it('本格不可走且8邻全不可走判孤岛', () => {
    const w = 5, h = 5;
    const blocked = new Array(25).fill(1); // 全阻挡
    expect(isolatedCell(nav(w, h, blocked), 2, 2)).toBe(true);
    blocked[2 * 5 + 3] = 0;                // (3,2) 可走
    expect(isolatedCell(nav(w, h, blocked), 2, 2)).toBe(false);
  });
  it('全围阻力唯一可走格时按切比雪夫环给出', () => {
    const w = 7, h = 7;
    const blocked = new Array(49).fill(1);
    blocked[1 * 7 + 3] = 0;                                     // 唯一可走 (3,1)
    expect(nearestStand(nav(w, h, blocked), 3, 3)).toEqual([3, 1]); // r=2 环命中
    expect(nearestStand(nav(w, h, blocked), 3, 1)).toEqual([3, 1]); // 本格可走
  });
  it('超出搜索半径返回 null', () => {
    const blocked = new Array(25).fill(1);
    expect(nearestStand(nav(5, 5, blocked), 2, 2, 2)).toBeNull();
  });
});

