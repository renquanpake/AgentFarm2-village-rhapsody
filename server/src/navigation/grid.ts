// navigation/grid.ts —— 碰撞网格 + BFS 寻路（1 格 = 100px；世界坐标 105x89 起步，M3 升级 HPA*）
import type { Tables } from '../world/tables.ts';

/** 该世界格是否被障碍占据（越界视为障碍） */
export function blockedAt(tables: Tables, gx: number, gy: number): boolean {
  if (gx < 0 || gy < 0 || gx >= tables.gridW || gy >= tables.gridH) return true;
  return !!(tables.collision && tables.collision.blocked[gy * tables.gridW + gx] === 1);
}

/** 目标/起点可能在障碍上：先吸附到最近可达格（方形环扩展） */
export function nearestReachable(tables: Tables, gx: number, gy: number, maxR = 8): [number, number] | null {
  if (!blockedAt(tables, gx, gy)) return [gx, gy];
  let found: [number, number] | null = null;
  outer:
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = gx + dx, ny = gy + dy;
        if (!blockedAt(tables, nx, ny)) { found = [nx, ny]; break outer; }
      }
    }
  }
  return found;
}

/** BFS 直达寻路（双端队列 head 指针 O(1) 出队）；返回格子路径（含起点）或 null */
export function bfsPath(tables: Tables, sx: number, sy: number, tx: number, ty: number): Array<[number, number]> | null {
  const T = nearestReachable(tables, tx, ty);
  if (!T) return null;
  const [adx, ady] = [T[0], T[1]];
  const S = nearestReachable(tables, sx, sy);
  if (!S) return null;
  const [ssx, ssy] = [S[0], S[1]];
  if (ssx === adx && ssy === ady) return [[ssx, ssy]];
  const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const prev = new Map<string, [number, number] | null>();
  const q: Array<[number, number]> = [[ssx, ssy]];
  let head = 0;
  prev.set(ssx + ',' + ssy, null);
  while (head < q.length) {
    const [cx, cy] = q[head++];
    if (cx === adx && cy === ady) break;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy, k = nx + ',' + ny;
      if (blockedAt(tables, nx, ny) || prev.has(k)) continue;
      prev.set(k, [cx, cy]);
      q.push([nx, ny]);
    }
  }
  if (!prev.has(adx + ',' + ady)) return null;
  const path: Array<[number, number]> = [];
  let cur: [number, number] | null = [adx, ady];
  while (cur) { path.push(cur); cur = prev.get(cur[0] + ',' + cur[1]) ?? null; }
  path.reverse();
  return path;
}

/** 目标坐标容错：agent 可能传格子坐标（如 33,15）或像素坐标（如 3350,1550）
 *  规则：x<MW 且 y<MH -> 视为格子坐标，转像素；否则视为像素 */
export function normXY(tables: Tables, x: unknown, y: unknown): { x: number; y: number } {
  let nx = Number(x), ny = Number(y);
  const MW = tables.farm ? tables.farm.soilW + 28 : 133;
  const MH = tables.farm ? tables.farm.soilH + 28 : 117;
  if (Number.isFinite(nx) && Number.isFinite(ny) && nx < MW && ny < MH) {
    nx = nx * 100 + 50;
    ny = ny * 100 + 50;
  }
  return { x: nx, y: ny };
}

/** 宅基地房子/树篱矩形碰撞（agent 单步 move 用；只有村扩展场景） */
export function blockedHouse(tables: Tables, scene: number, x: number, y: number): boolean {
  const SPAWNS = tables.spawns;
  if (!SPAWNS || scene !== (SPAWNS.scene || 2)) return false;
  const PW = 60, PH = 45;
  for (const h of SPAWNS.houses) {
    const r = h.rect;
    const b = { x: (r.x + r.w / 2) * 100, y: (r.y + r.h / 2) * 100, w: r.w * 100, h: r.h * 100 };
    if (x + PW > b.x - b.w / 2 && x - PW < b.x + b.w / 2 && y + PH > b.y - b.h / 2 && y - PH < b.y + b.h / 2) return true;
  }
  return false;
}
