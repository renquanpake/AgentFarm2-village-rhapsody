// navigation/roads.ts —— 市政路网数据层（roads-landmarks 规划书 §2.1 v2 定稿）
// 纯函数、无 IO：roads.json 规格 -> nav-grid kind=4/cost/roadIdx；路端点连通、穿水/穿阻挡、双源一致性检查。
// 定稿要点（v2）：路格 cost=0.6、桥格 cost=1，clearance 塑形特判置 0（hpath 侧）；负区段建格时裁剪；
// 客户端 onRoad()（shilu 或裸草地）口径不动，两者语义差异在此注释写明。
import type { NavGrid } from './navgen.ts';

export interface RoadLine {
  id: string;
  name: string;
  width: number;                       // 路宽（格）
  line: Array<[number, number]>;       // 折线（格坐标，可含负区段；建格时裁剪）
  links?: string[];                    // 相交/相接的其他路段 id（交叉口语义）
  bridge?: boolean;                    // 显式桥段：穿水合法（kind=4 cost=1）
}
export interface RoadsDoc { [scene: string]: { roads: RoadLine[] }; }

export const ROAD_COST = 0.6;   // 路格：强吸引通道（< 空地 1）
export const BRIDGE_COST = 1;   // 桥格：比水(2)快、比陆路(0.6)慢

export interface ApplyRoadsResult { roadCells: number; bridgeCells: number; errors: string[]; }

/** Bresenham 整段折线的格序列（去重：相邻段共享端点只留一格；单点折线返回该点） */
function bresenham(line: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const push = (x: number, y: number) => {
    const last = out[out.length - 1];
    if (last && last[0] === x && last[1] === y) return; // 相邻段共享端点去重
    out.push([x, y]);
  };
  for (let s = 0; s < line.length - 1; s++) {
    let [x, y] = line[s];
    const [x1, y1] = line[s + 1];
    const dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y);
    const sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      push(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  push(line[line.length - 1][0], line[line.length - 1][1]);
  return out;
}

/** 单路段扩宽格集合（行主序 idx；半径膨胀：奇宽对称、偶宽向下偏；越界格裁剪丢弃） */
export function roadCellIdxs(w: number, h: number, road: RoadLine): number[] {
  const seq = bresenham(road.line);
  const set = new Set<number>();
  const up = Math.floor((road.width - 1) / 2);
  const down = road.width - 1 - up;
  for (const [cx, cy] of seq) {
    for (let oy = -up; oy <= down; oy++) {
      for (let ox = -up; ox <= down; ox++) {
        const x = cx + ox, y = cy + oy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue; // 负区段裁剪：环建成前不生效
        set.add(y * w + x);
      }
    }
  }
  return [...set];
}

/** 把路网写入 nav-grid（原地）：kind=4、路 0.6 / 桥 1、roadIdx（路格反查首覆盖路段）
 *  返回错误列表（穿阻挡=非法；非桥穿水=需 check-roads 判门的数据问题，仍落格并报错）。 */
export function applyRoads(nav: NavGrid, roads: RoadLine[]): ApplyRoadsResult {
  const w = nav.width, h = nav.height;
  nav.roadIdx = new Array(w * h).fill(-1);
  nav.roadNames = roads.map(r => r.name);
  const covered = new Uint8Array(w * h); // 阻挡格保护：路格永不碰撞
  let roadCells = 0, bridgeCells = 0;
  const errors: string[] = [];
  for (let ri = 0; ri < roads.length; ri++) {
    const r = roads[ri];
    for (const i of roadCellIdxs(w, h, r)) {
      if (covered[i]) continue; // 该格已被先序路段覆盖（交叉口语义：roadOf 取首覆盖）
      covered[i] = 1;
      if (nav.roadIdx[i] === -1) nav.roadIdx[i] = ri;
      const isWater = nav.kind[i] === 2;
      if (nav.blocked[i] === 1 && !isWater) {
        errors.push(`${r.id}(${r.name}) 穿阻挡格 (${i % w},${(i / w) | 0})——路面红线违规`);
        continue; // 阻挡格不落成路（保持不可走），交 check-roads 判门
      }
      nav.kind[i] = 4;
      if (isWater) {
        if (!r.bridge) errors.push(`${r.id}(${r.name}) 穿水格 (${i % w},${(i / w) | 0}) 未标 bridge`);
        nav.cost[i] = BRIDGE_COST;
        bridgeCells++;
      } else {
        nav.cost[i] = ROAD_COST;
      }
      roadCells++;
    }
  }
  return { roadCells, bridgeCells, errors };
}

/** 路段反查（L3 路线摘要 roadOf）：格 -> 路名；无路格返回 null */
export function roadOf(nav: NavGrid, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= nav.width || y >= nav.height) return null;
  const ri = nav.roadIdx?.[y * nav.width + x] ?? -1;
  if (ri < 0) return null;
  return nav.roadNames?.[ri] ?? null;
}

/** 连通档：路端点（折线首/末格）须贴(切比雪夫 r 内) 他路/地标/门户/房屋门/地图边界(3 格带)，悬空路=0 */
export function connectivityCheck(
  w: number, h: number, roads: RoadLine[],
  landmarks: Array<{ x: number; y: number }>, portals: Array<{ x: number; y: number }>, r = 2,
  extraAnchors: Array<{ x: number; y: number }> = [],
): string[] {
  const roadSet = new Set<number>();
  for (const rd of roads) for (const i of roadCellIdxs(w, h, rd)) roadSet.add(i);
  const anchors = new Set<number>();
  for (const lm of [...landmarks, ...portals.map(p => ({ x: p.x / 100, y: p.y / 100 })), ...extraAnchors]) {
    const gx = Math.floor(lm.x), gy = Math.floor(lm.y);
    if (lm.x >= 0 && lm.y >= 0 && gx >= 0 && gy >= 0 && gx < w && gy < h) anchors.add(gy * w + gx);
  }
  const near = (x: number, y: number, selfSet: Set<number>): boolean => {
    if (x < 3 || y < 3 || x > w - 4 || y > h - 4) return true; // 贴地图边界 3 格带 = 出口方向，合法
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const i = ny * w + nx;
      if (!selfSet.has(i) && roadSet.has(i)) return true;
      if (anchors.has(i)) return true;
    }
    return false;
  };
  const bad: string[] = [];
  for (const rd of roads) {
    const self = new Set(roadCellIdxs(w, h, rd)); // 端点不得贴本路段自身格（自连接不算连通）
    for (const [ex, ey] of [rd.line[0], rd.line[rd.line.length - 1]]) {
      if (!near(ex, ey, self)) bad.push(`${rd.id}(${rd.name}) 端点 (${ex},${ey}) 悬空`);
    }
  }
  return bad;
}

/** 相交档（仅对真实碰撞场景启用）：路穿阻挡=非法；非桥穿水=报错。
 *  shiluExempt（村景）：原房层压在石板广场上的房叠格——双源一致性档以 shilu 为准，房叠阻挡豁免。 */
export function crossingCheck(w: number, h: number, blocked: number[], water: number[], roads: RoadLine[], shiluExempt?: number[]): string[] {
  const bad: string[] = [];
  for (const rd of roads) {
    for (const i of roadCellIdxs(w, h, rd)) {
      const x = i % w, y = (i / w) | 0;
      const shiluCell = shiluExempt ? shiluExempt[i] === 1 : false;
      if (blocked[i] === 1 && !water[i] && !shiluCell) bad.push(`${rd.id}(${rd.name}) 穿阻挡 (${x},${y})`);
      else if (water[i] && !rd.bridge) bad.push(`${rd.id}(${rd.name}) 穿水未标桥 (${x},${y})`);
    }
  }
  return bad;
}

/** 双源一致性档（村景）：老区可走路格集合 == shilu 提取掩码∩可走（diff 0）。
 *  被阻挡的 shilu 格（原房叠石板）不可成路，故两侧同按"可走"口径比对。 */
export function dualSourceDiff(w: number, h: number, roads: RoadLine[], shilu: number[], blocked: number[], oldRect: { x0: number; y0: number; x1: number; y1: number }): number[] {
  const inOld = (x: number, y: number) => x >= oldRect.x0 && x <= oldRect.x1 && y >= oldRect.y0 && y <= oldRect.y1;
  const walk = (i: number) => blocked[i] !== 1;
  const roadSet = new Set<number>();
  for (const rd of roads) for (const i of roadCellIdxs(w, h, rd)) {
    const x = i % w, y = (i / w) | 0;
    if (inOld(x, y) && walk(i)) roadSet.add(i);
  }
  const diff: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i / w) | 0;
    if (!inOld(x, y) || !walk(i)) continue;
    const has = shilu[i] === 1, isRoad = roadSet.has(i);
    if (has !== isRoad) diff.push(i);
  }
  return diff;
}
