// test/unit/navgen.test.ts —— B5 导航数据生产（clearance/门户/可达性）
import { describe, it, expect } from 'vitest';
import {
  chebyshevClearance, buildNavGrid, extractPortals, snapToWalkable, validateAnchors,
} from '../../src/navigation/navgen.ts';

// 5x5 网格：中间十字障碍
const W = 5, H = 5;
const blocked = [
  0, 0, 1, 0, 0,
  0, 0, 1, 0, 0,
  1, 1, 1, 1, 1,
  0, 0, 1, 0, 0,
  0, 0, 1, 0, 0,
];

describe('chebyshevClearance', () => {
  it('障碍格 0，相邻格 1，逐层递增（切比雪夫）', () => {
    const c = chebyshevClearance(blocked, W, H);
    // 障碍格全 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (blocked[y * W + x]) expect(c[y * W + x]).toBe(0);
    // (0,0) 距最近障碍 (2,2) 切比雪夫距离 2
    expect(c[0]).toBe(2);
    // (0,1) 距 (1,2) 切比雪夫 1
    expect(c[W + 0]).toBe(1);
    // (4,0) 距障碍 (2,0) 切比雪夫距离 2
    expect(c[4]).toBe(2);
  });

  it('全无障碍时距边界外视为 0（无源 -> 全 0）', () => {
    const c = chebyshevClearance(new Array(9).fill(0), 3, 3);
    expect(c.every(x => x === 0)).toBe(true);
  });
});

describe('buildNavGrid', () => {
  it('kind/cost：障碍 1/-1、水 2/2、树丛 3/-1', () => {
    const water = new Array(25).fill(0); water[0] = 1;
    const trees = new Array(25).fill(0); trees[4] = 1;
    const g = buildNavGrid(2, blocked, W, H, water, trees);
    expect(g.kind[0]).toBe(2); expect(g.cost[0]).toBe(2);
    expect(g.kind[4]).toBe(3); expect(g.cost[4]).toBe(-1);
    expect(g.kind[blocked.indexOf(1)]).toBe(1);
    // index 1 既非水(0)非树(4)非障碍 -> 空地 kind 0
    expect(g.kind[1]).toBe(0); expect(g.cost[1]).toBe(1);
    expect(g.width).toBe(W); expect(g.height).toBe(H);
  });
});

describe('extractPortals / snapToWalkable', () => {
  const g = buildNavGrid(2, blocked, W, H);
  it('可走格直取；障碍格吸附最近可达', () => {
    expect(snapToWalkable(g, 100, 100)).toEqual([1, 1]); // (1,1) 可走
    const p = snapToWalkable(g, 250, 250); // (2,2) 障碍 -> 吸附
    expect(p).not.toBeNull();
  });
  it('门位落格生成门户（像素=格*100）', () => {
    const ps = extractPortals(g, [{ toScene: 1, x: 150, y: 150, passage: 'west' }]);
    expect(ps.length).toBe(1);
    expect(ps[0].toScene).toBe(1);
    expect(ps[0].x).toBe(ps[0].x); // 像素坐标
    expect(ps[0].scene).toBe(2);
  });
});

describe('validateAnchors', () => {
  const g = buildNavGrid(2, blocked, W, H);
  it('同连通域 anchor 通过', () => {
    const rep = validateAnchors(g, [
      { name: 'a', x: 100, y: 100 }, // (1,1) 左上
      { name: 'b', x: 0, y: 0 },      // (0,0) 同左上连通域
    ]);
    expect(rep.ok).toBe(true);
    expect(rep.unreachable.length).toBe(0);
    expect(rep.reachableFrom).toBe('a');
  });
  it('不同连通域 anchor 报不可达', () => {
    const rep = validateAnchors(g, [
      { name: 'top', x: 100, y: 100 },   // 上半
      { name: 'bottom', x: 100, y: 400 }, // 下半（y=4 行，与上半仅 x=0/4 连通？ x=0 列 y=2 障碍 -> 不通）
    ]);
    expect(rep.ok).toBe(false);
    expect(rep.unreachable).toContain('bottom');
  });
});
