// navigation/hpath.ts —— B6 分层寻路（design M3.2-M3.3）：一级门户图 Dijkstra 粗规划 + 二级场景内 A*（clearance 塑形）
// 纯函数、确定性（同输入同输出）。路线 = waypoints[]（跨场景段 + 场景内段），配合航点确认协议（arrive/index/偏差校验）。
import type { NavGrid, Portal } from './navgen.ts';
import { snapToWalkable } from './navgen.ts';

export interface Pt { scene: number; x: number; y: number } // 像素坐标
export interface Waypoint extends Pt {}
export interface PlanRouteResult {
  ok: boolean;
  msg?: string;
  waypoints: Waypoint[];      // 含起点后首个待达点 -> ... -> 目标
  crossScene: boolean;
  segment: 'in-scene' | 'cross-scene';
}

// 二叉堆（确定性：索引序破平）
class MinHeap {
  private a: Array<{ f: number; idx: number; key: string }> = [];
  get size() { return this.a.length; }
  push(f: number, idx: number, key: string): void {
    this.a.push({ f, idx, key });
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(i, p)) { this.swap(i, p); i = p; } else break;
    }
  }
  pop(): { f: number; idx: number; key: string } | null {
    const top = this.a[0];
    const last = this.a.pop();
    if (last && this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.a.length && this.less(l, m)) m = l;
        if (r < this.a.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top ?? null;
  }
  private less(i: number, j: number): boolean {
    if (this.a[i].f !== this.a[j].f) return this.a[i].f < this.a[j].f;
    return this.a[i].key < this.a[j].key;
  }
  private swap(i: number, j: number): void { const t = this.a[i]; this.a[i] = this.a[j]; this.a[j] = t; }
}

/** 单格塑形步代价（A* 与 pathCost 共用，保证回放成本比口径一致）：
 *  路格（kind=4）特判：跳过 clearance 项，直接返回 cost（陆路 0.6 / 桥 1）；
 *  其余格：wallHug -> 贴墙（clearance 低得分）；默认 -> 避墙（clearance 高得分）。 */
export function cellShape(nav: NavGrid, i: number, wallHug: boolean, clearMax: number): number {
  const base = nav.cost[i];
  if (nav.kind[i] === 4) return base; // 路格/桥格：塑形项置 0（v2 定稿）
  const c = nav.clearance[i];
  return wallHug ? base + (clearMax - c) * 0.15 : base + c * 0.15;
}

/** 路径总塑形成本（沿 path 逐格 cellShape，对角步 x1.414）：回放成本比容差 / 路吸引度验证用 */
export function pathCost(nav: NavGrid, path: Array<[number, number]>, wallHug = false): number {
  if (path.length < 2) return 0;
  const clearMax = Math.max(1, ...nav.clearance);
  let g = 0;
  for (let k = 1; k < path.length; k++) {
    const [px, py] = path[k - 1];
    const [cx, cy] = path[k];
    const diag = Math.abs(cx - px) === 1 && Math.abs(cy - py) === 1;
    g += cellShape(nav, cy * nav.width + cx, wallHug, clearMax) * (diag ? 1.414 : 1);
  }
  return g;
}

/** 场景内 A*（8 向 + 对角不切角），cost 含 clearance 塑形 */
export function astarClearance(nav: NavGrid, sx: number, sy: number, tx: number, ty: number, opts: { wallHug?: boolean } = {}): Array<[number, number]> | null {
  const w = nav.width, h = nav.height;
  const wallHug = opts.wallHug ?? false;
  const clearMax = Math.max(1, ...nav.clearance);
  const N = w * h;
  const idx = (x: number, y: number) => y * w + x;
  const walk = (i: number) => i >= 0 && i < N && nav.blocked[i] !== 1 && nav.cost[i] > 0;
  const startI = idx(sx, sy), goalI = idx(tx, ty);
  if (!walk(startI) || !walk(goalI)) return null;

  // 塑形代价：wallHug -> 贴墙（clearance 低得分）；默认 -> 避墙（clearance 高得分）
  // 路格（kind=4）特判：跳过 clearance 塑形项（定稿 v2：开阔地 clearance*0.15 可达 3.0+，
  // 会淹没 cost 0.6 vs 1 的 0.4 差；特判后路格步代价恒定 0.6，路成为强吸引通道）。
  // 启发式切比雪夫对 0.6 路格高估 -> wA* 有界次优（界 ≤1.67），回放容差按成本比（nav-replay g 比 <1.1）。
  const shape = (i: number): number => cellShape(nav, i, wallHug, clearMax);
  const hfn = (x: number, y: number): number => Math.max(Math.abs(x - tx), Math.abs(y - ty)); // 切比雪夫一致启发

  const g = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = new MinHeap();
  g[startI] = 0;
  open.push(hfn(sx, sy), startI, `s-${startI}`);

  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
  while (open.size) {
    const { idx: cur } = open.pop()!;
    if (cur === goalI) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w, cy = (cur / w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = idx(nx, ny);
      if (!walk(ni)) continue;
      // 对角切角防护：两正交邻格都须可走
      if (d >= 4) {
        if (!walk(idx(cx + DX[d], cy)) || !walk(idx(cx, cy + DY[d]))) continue;
      }
      const step = shape(ni) * (d >= 4 ? 1.414 : 1);
      const ng = g[cur] + step;
      if (ng < g[ni] - 1e-9) {
        g[ni] = ng;
        came[ni] = cur;
        open.push(ng + hfn(nx, ny), ni, `n-${ni}`);
      }
    }
  }
  if (g[goalI] === Infinity) return null;
  const path: Array<[number, number]> = [];
  let cur = goalI;
  while (cur !== -1) {
    path.push([cur % w, (cur / w) | 0]);
    cur = came[cur];
  }
  path.reverse();
  return path;
}

/** 一级：门户图 Dijkstra（场景级粗规划） */
export function dijkstraScenes(graph: Map<number, Array<{ to: number; cost: number }>>, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const visited = new Set<number>();
  const sceneIds = [...graph.keys()];
  for (;;) {
    let u: number | null = null, best = Infinity;
    for (const s of sceneIds) if (!visited.has(s) && (dist.get(s) ?? Infinity) < best) { best = dist.get(s)!; u = s; }
    if (u === null) return null;
    visited.add(u);
    if (u === to) break;
    for (const e of graph.get(u) || []) {
      const nd = best + e.cost;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); }
    }
  }
  const out = [to];
  let c = to;
  while (c !== from) { c = prev.get(c)!; out.push(c); }
  out.reverse();
  return out;
}

/** 构建对称门户图（Portal[] -> Map<scene, edges>） */
export function portalGraph(portals: Portal[]): Map<number, Array<{ to: number; cost: number }>> {
  const g = new Map<number, Array<{ to: number; cost: number }>>();
  for (const p of portals) {
    const cost = 100; // 跨场景固定成本（门位）
    if (!g.has(p.scene)) g.set(p.scene, []);
    if (!g.has(p.toScene)) g.set(p.toScene, []);
    g.get(p.scene)!.push({ to: p.toScene, cost });
    g.get(p.toScene)!.push({ to: p.scene, cost });
  }
  return g;
}

/** 航点偏差校验：实际位置与期望航点距离 <= 容差 */
export function checkArrive(expected: Pt, actual: Pt, tolPx = 120): boolean {
  if (expected.scene !== actual.scene) return false;
  return Math.max(Math.abs(expected.x - actual.x), Math.abs(expected.y - actual.y)) <= tolPx;
}

/** D3 交互环：目标吸附到可站立格（障碍格目标不再直接不可达）
 *  按目标类型吸附：bare -> 最近可走格；water -> 水边（可走非水 + 邻水）；npc -> NPC 碰撞外一格（最近可走格） */
export function snapInteraction(nav: NavGrid, tx: number, ty: number, kind: 'water' | 'npc' | undefined = undefined, maxR = 8): [number, number] | null {
  const w = nav.width, h = nav.height;
  const idx = (x: number, y: number) => y * w + x;
  const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && nav.blocked[idx(x, y)] !== 1 && nav.cost[idx(x, y)] > 0;
  // 水格判定只看 kind：村庄河道是 blocked=1 && water=1（buildNavGrid 记 kind=2, cost=-1），
  // 若沿用 walk() 前置则每格真水都因不可走而被判成非水，near=water 永远无解。
  const isWater = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && nav.kind[idx(x, y)] === 2;
  const stand = (x: number, y: number) => walk(x, y) && (kind !== 'water' || !isWater(x, y));
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = tx + dx, ny = ty + dy;
      if (!stand(nx, ny)) continue;
      if (kind !== 'water') return [nx, ny];
      // 水目标：站立格须贴水（至少一个邻水格）
      let nearW = false;
      for (let oy = -1; oy <= 1 && !nearW; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        if (isWater(nx + ox, ny + oy)) { nearW = true; break; }
      }
      if (nearW) return [nx, ny];
    }
  }
  return null;
}

/** 路线规划：同场景 A*；跨场景 一级 Dijkstra + 二级 A* 到门户（门位/目标均先吸附可走格） */
export function planRoute(
  from: Pt, to: Pt,
  navOf: (scene: number) => NavGrid | null,
  portals: Portal[],
  opts: { wallHug?: boolean } = {},
): PlanRouteResult {
  const wps: Waypoint[] = [];
  const snapCell = (nav: NavGrid, cx: number, cy: number): [number, number] =>
    snapToWalkable(nav, cx * 100 + 50, cy * 100 + 50, 6) ?? [cx, cy];
  if (from.scene === to.scene) {
    const nav = navOf(from.scene);
    if (!nav) return { ok: false, msg: '无该场景导航数据', waypoints: [], crossScene: false, segment: 'in-scene' };
    const s0 = snapCell(nav, Math.floor(from.x / 100), Math.floor(from.y / 100));
    const g0 = snapCell(nav, Math.floor(to.x / 100), Math.floor(to.y / 100));
    const path = astarClearance(nav, s0[0], s0[1], g0[0], g0[1], opts);
    if (!path) return { ok: false, msg: '目标不可达（被障碍包围）', waypoints: [], crossScene: false, segment: 'in-scene' };
    // 抽稀：每 3 格取一航点（首尾保留；终点取实际路径末格——吸附后不再悬在障碍上）
    const step = 3;
    for (let i = 1; i < path.length; i += step) wps.push({ scene: from.scene, x: path[i][0] * 100 + 50, y: path[i][1] * 100 + 50 });
    const [lx, ly] = path[path.length - 1];
    wps.push({ scene: from.scene, x: lx * 100 + 50, y: ly * 100 + 50 });
    return { ok: true, waypoints: wps, crossScene: false, segment: 'in-scene' };
  }
  // 跨场景：一级粗规划
  const g = portalGraph(portals);
  const scenePath = dijkstraScenes(g, from.scene, to.scene);
  if (!scenePath) return { ok: false, msg: '跨场景无门户通路（passage 源数据缺失）', waypoints: [], crossScene: true, segment: 'cross-scene' };
  for (let i = 0; i < scenePath.length; i++) {
    const sc = scenePath[i];
    const isLast = i === scenePath.length - 1;
    const nav = navOf(sc);
    if (!nav) return { ok: false, msg: `场景${sc} 无导航数据`, waypoints: [], crossScene: true, segment: 'cross-scene' };
    let targetCell: [number, number];
    if (isLast) {
      targetCell = snapCell(nav, Math.floor(to.x / 100), Math.floor(to.y / 100));
    } else {
      const next = scenePath[i + 1];
      const port = portals.find(p => p.scene === sc && p.toScene === next);
      if (!port) return { ok: false, msg: `场景${sc}->${next} 无门户门位`, waypoints: [], crossScene: true, segment: 'cross-scene' };
      targetCell = snapCell(nav, Math.floor(port.x / 100), Math.floor(port.y / 100));
    }
    const startCell: [number, number] = i === 0
      ? snapCell(nav, Math.floor(from.x / 100), Math.floor(from.y / 100))
      : (() => {
        const prevSc = scenePath[i - 1];
        // 进入 sc 的落点 = sc 侧门户位（sc 通往 prevSc 的门），而非 prevSc 侧出口
        const port = portals.find(p => p.scene === sc && p.toScene === prevSc);
        return port ? snapCell(nav, Math.floor(port.x / 100), Math.floor(port.y / 100)) : [Math.floor(nav.width / 2), Math.floor(nav.height / 2)];
      })();
    {
      const path = astarClearance(nav, startCell[0], startCell[1], targetCell[0], targetCell[1], opts);
      if (!path) return { ok: false, msg: `场景${sc} 内不可达`, waypoints: [], crossScene: true, segment: 'cross-scene' };
      for (let k = 1; k < path.length; k += 3) wps.push({ scene: sc, x: path[k][0] * 100 + 50, y: path[k][1] * 100 + 50 });
    }
    if (isLast) wps.push({ scene: to.scene, x: to.x, y: to.y });
  }
  return { ok: true, waypoints: wps, crossScene: true, segment: 'cross-scene' };
}
