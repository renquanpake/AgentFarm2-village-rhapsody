// test/unit/hpath.test.ts —— B6 分层寻路（A* clearance + 门户 Dijkstra + planRoute + 航点校验）
import { describe, it, expect } from 'vitest';
import { buildNavGrid } from '../../src/navigation/navgen.ts';
import { astarClearance, dijkstraScenes, portalGraph, planRoute, checkArrive, snapInteraction } from '../../src/navigation/hpath.ts';

// 6x6 全开网格
function openNav(w = 6, h = 6) { return buildNavGrid(2, new Array(w * h).fill(0), w, h); }

describe('astarClearance', () => {
  it('开网格直线可达（8 向，步数 = 切比雪夫距离+1 含起点）', () => {
    const nav = openNav();
    const p = astarClearance(nav, 0, 0, 5, 5)!;
    expect(p[0]).toEqual([0, 0]);
    expect(p[p.length - 1]).toEqual([5, 5]);
    expect(p.length).toBe(6); // 对角直达
  });

  it('障碍绕行（墙留缺口可绕）', () => {
    const w = 6, h = 6;
    const blocked = new Array(w * h).fill(0);
    for (let y = 0; y < h - 1; y++) blocked[y * w + 3] = 1; // 竖墙 x=3，底部 (3,5) 留缺口
    const nav = buildNavGrid(2, blocked, w, h);
    const p = astarClearance(nav, 1, 3, 5, 3)!;
    expect(p).not.toBeNull();
    // x=3 只在缺口行 y=5 出现
    expect(p.filter(([x]) => x === 3).every(([, y]) => y === 5)).toBe(true);
    expect(p[p.length - 1]).toEqual([5, 3]);
  });

  it('wallHug 与避墙塑形代价不同（同可达，路径形态可异）', () => {
    const w = 8, h = 8;
    const blocked = new Array(w * h).fill(0);
    for (let y = 0; y < h - 1; y++) blocked[y * w + 4] = 1; // 中缝竖墙，底部留缺口
    const nav = buildNavGrid(2, blocked, w, h);
    const openP = astarClearance(nav, 1, 4, 7, 4, { wallHug: false })!;
    const hugP = astarClearance(nav, 1, 4, 7, 4, { wallHug: true })!;
    expect(openP[openP.length - 1]).toEqual([7, 4]);
    expect(hugP[hugP.length - 1]).toEqual([7, 4]);
    // 确定性：同参数两次一致
    const open2 = astarClearance(nav, 1, 4, 7, 4, { wallHug: false })!;
    expect(JSON.stringify(openP)).toBe(JSON.stringify(open2));
  });

  it('目标被围 -> null', () => {
    const w = 5, h = 5;
    const blocked = new Array(w * h).fill(0);
    // 围住 (2,2)
    for (const [x, y] of [[1, 1], [2, 1], [3, 1], [1, 2], [3, 2], [1, 3], [2, 3], [3, 3]] as Array<[number, number]>) blocked[y * w + x] = 1;
    const nav = buildNavGrid(2, blocked, w, h);
    expect(astarClearance(nav, 0, 0, 2, 2)).toBeNull();
  });
});

describe('dijkstraScenes / portalGraph', () => {
  it('三场景门户图最短路', () => {
    const portals = [
      { scene: 1, toScene: 2, x: 0, y: 0 },
      { scene: 2, toScene: 3, x: 0, y: 0 },
      { scene: 1, toScene: 3, x: 0, y: 0 }, // 直连
    ];
    const g = portalGraph(portals);
    expect(dijkstraScenes(g, 1, 3)).toEqual([1, 3]);
    expect(dijkstraScenes(g, 1, 2)).toEqual([1, 2]);
    // 删除直连 -> 须经 2
    const g2 = portalGraph(portals.slice(0, 2));
    expect(dijkstraScenes(g2, 1, 3)).toEqual([1, 2, 3]);
    expect(dijkstraScenes(g2, 1, 9)).toBeNull(); // 无场景 9
  });
});

describe('planRoute', () => {
  const navOf = (sc: number) => (sc === 2 ? openNav() : sc === 3 ? openNav() : null);
  const portals = [{ scene: 2, toScene: 3, x: 550, y: 550 }];

  it('同场景出航点序列', () => {
    const r = planRoute({ scene: 2, x: 100, y: 100 }, { scene: 2, x: 550, y: 550 }, navOf, portals);
    expect(r.ok).toBe(true);
    expect(r.crossScene).toBe(false);
    expect(r.waypoints.length).toBeGreaterThan(0);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual({ scene: 2, x: 550, y: 550 });
  });

  it('跨场景：经门户门位 + 目标', () => {
    const r = planRoute({ scene: 2, x: 100, y: 100 }, { scene: 3, x: 300, y: 300 }, navOf, portals);
    expect(r.ok).toBe(true);
    expect(r.crossScene).toBe(true);
    // 应含场景 2 内航点 + 门户门位 + 场景 3 目标
    expect(r.waypoints.some(w => w.scene === 2)).toBe(true);
    expect(r.waypoints[r.waypoints.length - 1].scene).toBe(3);
  });

  it('无导航数据场景 -> 不可达', () => {
    const r = planRoute({ scene: 2, x: 100, y: 100 }, { scene: 9, x: 100, y: 100 }, navOf, [{ scene: 2, toScene: 9, x: 0, y: 0 }]);
    expect(r.ok).toBe(false);
    expect(r.crossScene).toBe(true);
  });

  it('同场景不可达（被围）-> ok=false', () => {
    const w = 5, h = 5;
    const blocked = new Array(w * h).fill(0);
    for (const [x, y] of [[1, 1], [2, 1], [3, 1], [1, 2], [3, 2], [1, 3], [2, 3], [3, 3]] as Array<[number, number]>) blocked[y * w + x] = 1;
    const badNav = buildNavGrid(2, blocked, w, h);
    const r = planRoute({ scene: 2, x: 100, y: 100 }, { scene: 2, x: 250, y: 250 }, () => badNav, []);
    expect(r.ok).toBe(false);
  });
});

describe('checkArrive（航点偏差）', () => {
  it('同场景且偏差 <= 容差 -> true；跨场景或超差 -> false', () => {
    expect(checkArrive({ scene: 2, x: 100, y: 100 }, { scene: 2, x: 110, y: 90 }, 120)).toBe(true);
    expect(checkArrive({ scene: 2, x: 100, y: 100 }, { scene: 3, x: 100, y: 100 }, 120)).toBe(false);
    expect(checkArrive({ scene: 2, x: 100, y: 100 }, { scene: 2, x: 500, y: 100 }, 120)).toBe(false);
  });
});

describe('snapInteraction（D3 交互环）', () => {
  it('障碍格目标吸附到最近可走格（不再直接不可达）', () => {
    const w = 6, h = 6;
    const blocked = new Array(w * h).fill(0);
    blocked[3 * w + 3] = 1; // (3,3) 障碍
    const nav = buildNavGrid(2, blocked, w, h);
    const r = snapInteraction(nav, 3, 3);
    expect(r).not.toBeNull();
    expect(nav.blocked[r![1] * w + r![0]]).toBe(0); // 可走
    expect(Math.max(Math.abs(r![0] - 3), Math.abs(r![1] - 3))).toBeLessThanOrEqual(1); // 紧邻目标
  });

  it('water 目标：吸附到贴水的可站立格（水边）', () => {
    const w = 6, h = 6;
    const blocked = new Array(w * h).fill(0);
    const water = new Array(w * h).fill(0);
    for (let x = 2; x <= 3; x++) { water[2 * w + x] = 1; water[3 * w + x] = 1; } // 2x2 水塘 (2,2)-(3,3)
    const nav = buildNavGrid(2, blocked, w, h, water);
    const r = snapInteraction(nav, 2, 2, 'water');
    expect(r).not.toBeNull();
    const [x, y] = r!;
    expect(nav.kind[y * w + x]).toBe(0); // 非水
    expect(nav.blocked[y * w + x]).toBe(0);
    // 贴水：8 邻内有水
    let nearW = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && water[ny * w + nx] === 1) nearW = true;
    }
    expect(nearW).toBe(true);
  });

  it('水塘被墙围死 -> null（无水边可站）', () => {
    const w = 6, h = 6;
    const blocked = new Array(w * h).fill(0);
    const water = new Array(w * h).fill(0);
    water[3 * w + 3] = 1;
    for (const [x, y] of [[2, 2], [4, 2], [2, 4], [4, 4], [3, 2], [2, 3], [3, 4], [4, 3]] as Array<[number, number]>) blocked[y * w + x] = 1;
    const nav = buildNavGrid(2, blocked, w, h, water);
    expect(snapInteraction(nav, 3, 3, 'water', 2)).toBeNull();
  });

  // 村庄河道是 blocked=1 && water=1（buildNavGrid 记 kind=2, cost=-1）。
  // 旧实现用 walk() && kind===2 判水，walk 要求 cost>0，于是每格真水都因不可走被判成非水，
  // move_to {near:'water'} 在真实地图上恒无解。kind=2 本身才是权威水标记。
  it('不可走的河（blocked+water）也算水边：吸附到岸上可站格', () => {
    const w = 8, h = 8;
    const blocked = new Array(w * h).fill(0);
    const water = new Array(w * h).fill(0);
    for (let x = 3; x <= 4; x++) for (let y = 1; y <= 6; y++) { water[y * w + x] = 1; blocked[y * w + x] = 1; } // 竖河，走不进去
    const nav = buildNavGrid(2, blocked, w, h, water);
    const r = snapInteraction(nav, 3, 4, 'water');
    expect(r).not.toBeNull();
    const [x, y] = r!;
    expect(nav.blocked[y * w + x]).toBe(0);   // 站在岸上，不在河里
    expect(nav.kind[y * w + x]).not.toBe(2);
    const onRiver = nav.kind[(y - 1) * w + x] === 2 || nav.kind[(y + 1) * w + x] === 2 || nav.kind[y * w + x - 1] === 2 || nav.kind[y * w + x + 1] === 2;
    expect(onRiver).toBe(true);                 // 紧邻真水
  });

  it('不可走的河也算水边：目标在河对岸时仍能吸到近岸', () => {
    const w = 8, h = 8;
    const blocked = new Array(w * h).fill(0);
    const water = new Array(w * h).fill(0);
    for (let x = 3; x <= 4; x++) for (let y = 1; y <= 6; y++) { water[y * w + x] = 1; blocked[y * w + x] = 1; }
    const nav = buildNavGrid(2, blocked, w, h, water);
    const r = snapInteraction(nav, 4, 4, 'water');
    expect(r).not.toBeNull();
    // 河占 x=3,4：最近岸格必在 x=2 或 x=5
    expect([2, 5]).toContain(r![0]);
  });

  it('非水目标贴水格：返回目标本身（水可走 cost 高但可站）', () => {
    const w = 6, h = 6;
    const blocked = new Array(w * h).fill(0);
    const water = new Array(w * h).fill(0);
    water[3 * w + 3] = 1;
    const nav = buildNavGrid(2, blocked, w, h, water);
    expect(snapInteraction(nav, 3, 3)).toEqual([3, 3]); // 水格可站
    expect(snapInteraction(nav, 3, 3, 'npc')).toEqual([3, 3]);
  });

  it('目标越界/全障碍无解 -> null', () => {
    const w = 3, h = 3;
    const blocked = new Array(w * h).fill(1); // 全障碍
    const nav = buildNavGrid(2, blocked, w, h);
    expect(snapInteraction(nav, 1, 1, undefined, 4)).toBeNull();
    // 仅 (1,1) 可走：目标 (0,0) 在 1 环内命中 (1,1)
    const blocked2 = new Array(w * h).fill(1);
    blocked2[w + 1] = 0;
    const nav2 = buildNavGrid(2, blocked2, w, h);
    expect(snapInteraction(nav2, 0, 0, undefined, 4)).toEqual([1, 1]);
    expect(snapInteraction(nav2, 1, 1)).toEqual([1, 1]);
  });
});
