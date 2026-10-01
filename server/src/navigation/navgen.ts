// navigation/navgen.ts —— B5 导航数据生产（design M3.1）：碰撞 -> nav-grid（blocked/kind/cost/clearance）
// clearance = 切比雪夫距离洪泛填充（多源 BFS，距最近障碍格）；门户图 portals.json（场景出入口）；
// 验收：anchors（出生点/房屋门/矿点）可达性校验。纯函数，无 IO（gen-nav.mjs 做文件层）。
import type { Tables } from '../world/tables.ts';

export type NavKind = 0 | 1 | 2 | 3 | 4; // 0 空地 1 障碍 2 水面（可走高cost/阻挡水） 3 树丛（不可走） 4 路/桥（市政路格，applyRoads 写入）

export interface NavGrid {
  scene: number;
  width: number;
  height: number;
  blocked: number[];   // 行主序 0/1
  kind: number[];      // 行主序 NavKind
  cost: number[];      // 行主序 移动成本（空地 1 / 水 2 / 路 0.6 / 桥 1 / 障碍不可走 -1）
  clearance: number[]; // 行主序 距最近障碍的切比雪夫距离（障碍格 0）
  roadIdx?: number[];  // 行主序 路格反查（applyRoads 写入；-1=非路格）
  roadNames?: string[]; // roadIdx 下标 -> 路名
}

export interface Portal {
  scene: number;
  toScene: number;
  x: number;
  y: number;
  passage?: string;
}

export interface NavAnchor { name: string; x: number; y: number; }

/** 切比雪夫距离洪泛：多源 BFS（源 = 所有障碍格），返回每格距最近障碍的切比雪夫距离 */
export function chebyshevClearance(blocked: number[], w: number, h: number): number[] {
  const n = w * h;
  const dist = new Array<number>(n).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (blocked[i] === 1) { dist[i] = 0; queue.push(i); }
  }
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % w, y = (idx / w) | 0;
    const d = dist[idx];
    // 8 邻域（切比雪夫：一步到 8 向相邻格）
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] === -1) { dist[ni] = d + 1; queue.push(ni); }
    }
  }
  // 无障碍格：距最近障碍（BFS 已覆盖全连通可达格；孤立不可达格保持 -1 -> 视为 0）
  for (let i = 0; i < n; i++) if (dist[i] === -1) dist[i] = 0;
  return dist;
}

/** 由碰撞 + 可选水面/树丛层构建 nav-grid（cost：空地 1、水 2、障碍 Infinity 标记 -1）
 *  水层优先级（D2）：水格同时被 blocked 覆盖时仍标 kind=2（阻挡水，不可走 cost -1，保留水语义供交互环/可视化）；
 *  非 blocked 水格 kind=2 可走 cost 2（高成本绕行塑形）。 */
export function buildNavGrid(scene: number, blocked: number[], w: number, h: number, water?: number[], trees?: number[]): NavGrid {
  const n = w * h;
  const kind = new Array<number>(n).fill(0);
  const cost = new Array<number>(n).fill(1);
  for (let i = 0; i < n; i++) {
    const isWater = !!(water && water[i] === 1);
    if (blocked[i] === 1) { kind[i] = isWater ? 2 : 1; cost[i] = -1; continue; }
    if (trees && trees[i] === 1) { kind[i] = 3; cost[i] = -1; continue; }
    if (isWater) { kind[i] = 2; cost[i] = 2; continue; }
    kind[i] = 0; cost[i] = 1;
  }
  return { scene, width: w, height: h, blocked: [...blocked], kind, cost, clearance: chebyshevClearance(blocked, w, h) };
}

/** 门户提取：门位（像素）落格并吸附最近可达格，连向目标场景 */
export function extractPortals(nav: NavGrid, doors: Array<{ toScene: number; x: number; y: number; passage?: string }>, maxSnap = 8): Portal[] {
  const out: Portal[] = [];
  for (const d of doors) {
    const p = snapToWalkable(nav, d.x, d.y, maxSnap);
    if (p) out.push({ scene: nav.scene, toScene: d.toScene, x: p[0] * 100, y: p[1] * 100, passage: d.passage });
  }
  return out;
}

/** 像素坐标 -> 最近可走格（方形环扩展）；返回 [gx,gy] 或 null */
export function snapToWalkable(nav: NavGrid, px: number, py: number, maxR = 8): [number, number] | null {
  const gx = Math.floor(px / 100), gy = Math.floor(py / 100);
  const walk = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < nav.width && y < nav.height && nav.blocked[y * nav.width + x] !== 1 && nav.cost[y * nav.width + x] > 0;
  if (walk(gx, gy)) return [gx, gy];
  outer:
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (walk(gx + dx, gy + dy)) return [gx + dx, gy + dy];
    }
  }
  return null;
}

/** 可达性校验：BFS 从任一可达 anchor 出发，检查所有 anchor 同连通域 */
export function validateAnchors(nav: NavGrid, anchors: NavAnchor[]): { ok: boolean; unreachable: string[]; reachableFrom: string | null } {
  if (!anchors.length) return { ok: true, unreachable: [], reachableFrom: null };
  const first = snapToWalkable(nav, anchors[0].x, anchors[0].y);
  if (!first) return { ok: false, unreachable: anchors.map(a => a.name), reachableFrom: null };
  const w = nav.width, h = nav.height;
  const seen = new Uint8Array(w * h);
  const queue: number[] = [first[1] * w + first[0]];
  seen[queue[0]] = 1;
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % w, y = (idx / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni]) continue;
      if (nav.blocked[ni] === 1 || nav.cost[ni] <= 0) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  const unreachable: string[] = [];
  for (const a of anchors) {
    const p = snapToWalkable(nav, a.x, a.y);
    if (!(p && seen[p[1] * w + p[0]])) unreachable.push(a.name);
  }
  const firstReachable = !!snapToWalkable(nav, anchors[0].x, anchors[0].y);
  return { ok: unreachable.length === 0, unreachable, reachableFrom: firstReachable ? anchors[0].name : null };
}

/** 从 Tables（村景）构建 nav-grid（供 app 运行时/测试用）
 *  D2：接入 village-farm.json 水层（尺寸匹配时；阻挡水保留不可走语义，free 水 cost 2） */
export function navGridFromTables(tables: Tables, scene = 2): NavGrid {
  const w = tables.gridW, h = tables.gridH;
  const blocked = tables.collision?.blocked ?? new Array<number>(w * h).fill(0);
  const F = tables.farm;
  const water = F && F.waterW === w && F.waterH === h ? F.water : undefined;
  return buildNavGrid(scene, blocked, w, h, water);
}
