// test/unit/municipal.test.ts —— L3 市政指引纯函数（municipalContext：方位/距离/排序/路名反查）
import { describe, it, expect } from 'vitest';
import { buildNavGrid, type NavGrid } from '../../src/navigation/navgen.ts';
import { applyRoads } from '../../src/navigation/roads.ts';
import { municipalContext, type Landmark } from '../../src/navigation/municipal.ts';

function roadNav(): NavGrid {
  const nav = buildNavGrid(2, new Array(20 * 20).fill(0), 20, 20);
  applyRoads(nav, [{ id: 'main', name: '东西主街', width: 1, line: [[0, 5], [19, 5]] }]);
  return nav;
}

describe('municipalContext', () => {
  it('最近地标按切比雪夫距离排序 + 方位（radius 内）', () => {
    const nav = roadNav();
    const lms: Landmark[] = [
      { id: 'a', name: '东', type: 'monument', x: 14, y: 10 }, // dx=4 -> 东
      { id: 'b', name: '北', type: 'tower', x: 10, y: 2 },    // dy=-8 -> 北
      { id: 'c', name: '西', type: 'bridge', x: 4, y: 10 },   // dx=-6 -> 西
    ];
    // 位置 (10,10)，radius=12 -> 方位阈值 4
    const ctx = municipalContext(nav, 10, 10, lms, 4, 12);
    // 切比雪夫：a=4, c=6, b=8 -> 顺序 a,c,b
    expect(ctx.nearest.map(n => n.id)).toEqual(['a', 'c', 'b']);
    expect(ctx.nearest[0].dir).toBe('东');
    expect(ctx.nearest[1].dir).toBe('西');
    expect(ctx.nearest[2].dir).toBe('北');
    expect(ctx.nearest[0].dist).toBe(4);
  });

  it('站在路格上 -> onRoad 命中路名', () => {
    const nav = roadNav();
    const ctx = municipalContext(nav, 8, 5, []);
    expect(ctx.onRoad).toBe('东西主街');
  });

  it('非路格 -> onRoad null', () => {
    const nav = roadNav();
    const ctx = municipalContext(nav, 10, 10, []);
    expect(ctx.onRoad).toBe(null);
  });

  it('nav 为 null（卫星场景无路网）-> onRoad null，地标方位仍可算', () => {
    const lms: Landmark[] = [{ id: 'x', name: '石桥', type: 'bridge', x: 5, y: 5 }];
    const ctx = municipalContext(null, 5, 12, lms, 4, 12);
    expect(ctx.onRoad).toBe(null);
    expect(ctx.nearest[0].id).toBe('x');
    expect(ctx.nearest[0].dir).toBe('北'); // (5,5) 在 (5,12) 北面（dy=-7 <= -4）
  });

  it('超出 radius 的地标不进最近列表', () => {
    const nav = roadNav();
    const lms: Landmark[] = [{ id: 'far', name: '远地标', type: 'monument', x: 19, y: 19 }];
    // (10,10) 到 (19,19) 切比雪夫 9 > radius 4 -> 过滤
    const ctx = municipalContext(nav, 10, 10, lms, 4, 4);
    expect(ctx.nearest.length).toBe(0);
  });
});
