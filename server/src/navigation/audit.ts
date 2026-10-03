// navigation/audit.ts —— 障碍数据完整性审计纯函数内核（批1a；消费方 tools/nav-audit.mjs 与门禁）
// 可走口径与 navgen.snapToWalkable 一致：in-bounds && blocked!==1 && cost>0。
import { snapToWalkable, type NavGrid, type Portal } from './navgen.ts';

export interface AuditRect { name: string; x: number; y: number; w: number; h: number; }

export function rectMisses(w: number, h: number, blocked: number[], r: AuditRect): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dy = 0; dy < r.h; dy++) {
    for (let dx = 0; dx < r.w; dx++) {
      const x = r.x + dx, y = r.y + dy;
      const inside = x >= 0 && y >= 0 && x < w && y < h;
      if (!inside || !blocked[y * w + x]) out.push([x, y]);
    }
  }
  return out;
}

export function unattributedCells(
  w: number, h: number, blocked: number[],
  attrib: Array<{ name: string; mask: number[] }>,
): { perSource: Record<string, number>; unattributed: Array<[number, number]> } {
  const perSource: Record<string, number> = {};
  const unattributed: Array<[number, number]> = [];
  for (const a of attrib) perSource[a.name] = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (blocked[i] !== 1) continue;
      let covered = false;
      for (const a of attrib) {
        if (a.mask[i] === 1) { perSource[a.name]++; covered = true; }
      }
      if (!covered) unattributed.push([x, y]);
    }
  }
  return { perSource, unattributed };
}

/** 门户全部可落脚 + 场景对双向成在；返回违规行（空=通过） */
export function portalsBidirectional(portals: Portal[], navOf: (scene: number) => NavGrid | null, maxSnap = 8): string[] {
  const out: string[] = [];
  const pairs = new Set<string>();
  for (const p of portals) {
    pairs.add(p.scene + '->' + p.toScene);
    const nav = navOf(p.scene);
    if (!nav) { out.push(`场景 ${p.scene}->${p.toScene} 门户(${p.x},${p.y}) 所在场景无导航数据`); continue; }
    if (!snapToWalkable(nav, p.x, p.y, maxSnap)) out.push(`场景 ${p.scene}->${p.toScene} 门户(${p.x},${p.y}) 落阻挡格且 ${maxSnap} 格内吸附不到可走格`);
  }
  for (const key of pairs) {
    const [a, b] = key.split('->');
    if (!pairs.has(b + '->' + a)) out.push(`场景对 ${key} 缺反向门户`);
  }
  return out;
}

const DIRS8: Array<[number, number]> = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function walkable(nav: NavGrid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= nav.width || y >= nav.height) return false;
  const i = y * nav.width + x;
  return nav.blocked[i] !== 1 && nav.cost[i] > 0;
}

/** 本格与 8 邻全不可走（chop/plant/water/till 目标格死胡同预检） */
export function isolatedCell(nav: NavGrid, gx: number, gy: number): boolean {
  if (walkable(nav, gx, gy)) return false;
  for (const [dx, dy] of DIRS8) if (walkable(nav, gx + dx, gy + dy)) return false;
  return true;
}

/** 最近可站立格（方形环 8 邻扩展；格入格出） */
export function nearestStand(nav: NavGrid, gx: number, gy: number, maxR = 8): [number, number] | null {
  for (let r = 0; r <= maxR; r++) {
    if (r === 0) { if (walkable(nav, gx, gy)) return [gx, gy]; continue; }
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (walkable(nav, gx + dx, gy + dy)) return [gx + dx, gy + dy];
    }
  }
  return null;
}
