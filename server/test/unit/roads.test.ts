// test/unit/roads.test.ts —— 市政路网数据层（roads-landmarks 规划书 §2/§6 验收门）
// 路格吸引（clearance 特判生效证据）、桥过水、负区裁剪、悬空路、双源一致性
import { describe, it, expect } from 'vitest';
import { buildNavGrid, type NavGrid } from '../../src/navigation/navgen.ts';
import { applyRoads, roadCellIdxs, roadOf, connectivityCheck, dualSourceDiff, type RoadLine } from '../../src/navigation/roads.ts';
import { astarClearance, pathCost } from '../../src/navigation/hpath.ts';

/** 全开网格（无障碍）：clearance 全 0，塑形项对草地也退化为 base */
function openNav(w: number, h: number): NavGrid {
  return buildNavGrid(2, new Array(w * h).fill(0), w, h);
}

describe('applyRoads / roadCellIdxs', () => {
  it('路格写 kind=4 cost=0.6，roadOf 反查路名（开放格）', () => {
    const nav = openNav(20, 20);
    const roads: RoadLine[] = [{ id: 'r1', name: '主街', width: 1, line: [[0, 5], [19, 5]] }];
    const res = applyRoads(nav, roads);
    expect(res.errors).toEqual([]);
    expect(res.roadCells).toBe(20);
    expect(nav.kind[5 * 20 + 10]).toBe(4);
    expect(nav.cost[5 * 20 + 10]).toBe(0.6);
    expect(roadOf(nav, 10, 5)).toBe('主街');
    expect(roadOf(nav, 10, 6)).toBe(null); // 非路格
  });

  it('路格永不碰撞：压阻挡格跳过并报错，保持不可走', () => {
    const w = 6, h = 6;
    const blocked = new Array(w * h).fill(0);
    blocked[3 * w + 3] = 1;
    const nav = buildNavGrid(2, blocked, w, h);
    const res = applyRoads(nav, [{ id: 'r', name: '路', width: 1, line: [[1, 3], [5, 3]] }]);
    expect(res.errors.length).toBe(1);
    expect(nav.kind[3 * w + 3]).toBe(1); // 阻挡格未被改写
    expect(nav.cost[3 * w + 3]).toBe(-1);
  });
});

describe('桥过水', () => {
  it('road∧water=桥 kind4 cost1，A* 可过；未标 bridge 穿水报错', () => {
    const w = 8, h = 5;
    const blocked = new Array(w * h).fill(0);
    const water = new Array(w * h).fill(0);
    for (let x = 0; x < w; x++) water[2 * w + x] = 1; // 中间一整排水
    const nav = buildNavGrid(2, blocked, w, h, water);
    const res = applyRoads(nav, [{ id: 'b', name: '石桥', width: 1, bridge: true, line: [[4, 0], [4, 4]] }]);
    expect(res.errors).toEqual([]);
    expect(nav.kind[2 * w + 4]).toBe(4);
    expect(nav.cost[2 * w + 4]).toBe(1);
    const p = astarClearance(nav, 0, 0, 7, 4)!;
    expect(p).not.toBeNull();
    expect(p.some(([x, y]) => x === 4 && y === 2)).toBe(true); // 走桥

    // 未标 bridge 的同类路段 -> 报错（相交档口径）
    const nav2 = buildNavGrid(2, blocked, w, h, water);
    const res2 = applyRoads(nav2, [{ id: 'b2', name: '野路', width: 1, line: [[4, 0], [4, 4]] }]);
    expect(res2.errors.length).toBeGreaterThan(0);
  });
});

describe('负区裁剪', () => {
  it('越界折线段建格裁剪丢弃，不崩、只留界内格', () => {
    const nav = openNav(10, 10);
    const cells = roadCellIdxs(10, 10, { id: 'x', name: '越界路', width: 1, line: [[8, 5], [14, 5]] });
    // 只有 x=8,9 在界内（x>=10 全裁）
    expect(new Set(cells.map(c => c % 10)).size).toBe(2);
    const res = applyRoads(nav, [{ id: 'x', name: '越界路', width: 1, line: [[8, 5], [14, 5]] }]);
    expect(res.roadCells).toBe(2);
  });
});

describe('连通档（悬空路）', () => {
  it('端点贴地图边界=合法出口；悬空端点被报', () => {
    const w = 20, h = 20;
    // 端点 (0,10) 贴左边界 -> 合法；(19,10) 贴右边界 -> 合法
    const ok = connectivityCheck(w, h, [{ id: 'a', name: '通边路', width: 1, line: [[0, 10], [19, 10]] }], [], []);
    expect(ok).toEqual([]);
    // 悬空：端点 (10,10) 无 路/地标/门户/边界 相邻
    const bad = connectivityCheck(w, h, [{ id: 'b', name: '悬空路', width: 1, line: [[10, 10]] }], [], []);
    expect(bad.length).toBeGreaterThan(0);
    // 贴地标则合法
    const anchored = connectivityCheck(w, h, [{ id: 'c', name: '贴地标路', width: 1, line: [[10, 10], [12, 12]] }], [{ x: 12, y: 12 }], []);
    expect(anchored).toEqual([]);
  });
});

describe('双源一致性', () => {
  it('路格集合精确复刻 shilu 掩码时 diff=0；缺一格则 diff>0', () => {
    const w = 10, h = 10;
    const shilu = new Array(w * h).fill(0);
    shilu[3 * w + 4] = 1; shilu[3 * w + 5] = 1; // 一格 2 连
    const blocked = new Array(w * h).fill(0);
    const oldRect = { x0: 0, y0: 0, x1: 9, y1: 9 };
    // 精确复刻：一条 2 格宽 1 折线覆盖 (4,3)(5,3)
    const exact = [{ id: 'm', name: '垫', width: 1, line: [[4, 3], [5, 3]] }];
    expect(dualSourceDiff(w, h, exact, shilu, blocked, oldRect)).toEqual([]);
    // 缺一格：只覆盖 (4,3)
    const missing = [{ id: 'm2', name: '垫2', width: 1, line: [[4, 3]] }];
    expect(dualSourceDiff(w, h, missing, shilu, blocked, oldRect).length).toBe(1);
  });
});

describe('路格吸引（A* 塑形特判生效证据）', () => {
  it('同几何路径：贴路段 g 值比草地路径低（路 cost 0.6 且免 clearance 项）', () => {
    const w = 30, h = 10;
    const withRoad = openNav(w, h);
    applyRoads(withRoad, [{ id: 'r', name: '主路', width: 1, line: [[0, 4], [29, 4]] }]);
    const noRoad = openNav(w, h);
    // 同起同终，A* 在无路格网格里只能走草地（cost 1）
    const pRoad = astarClearance(withRoad, 0, 4, 29, 4)!;
    const pGrass = astarClearance(noRoad, 0, 4, 29, 4)!;
    const gRoad = pathCost(withRoad, pRoad);
    const gGrass = pathCost(noRoad, pGrass);
    // 路格 0.6 vs 草地 1.0 -> 同 30 段直线 gRoad ≈ 0.6*gGrass，差 >= 25%
    expect(gRoad).toBeLessThan(gGrass * 0.75);
    // 同起同终直线步数一致（确定性）
    expect(pRoad.length).toBe(pGrass.length);
  });
});
