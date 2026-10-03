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

/** 建筑实体完整性（口径与 building-collision.test 锁一致）：
 *  - 实心楼：rect 全格 blocked，豁免仅限门格切比雪夫 1 邻域（入口）
 *  - 环岛厅（kind=stage）：顶部 core 3 行（x+1..x+3）必须实心，实心率 >= minSolid（缺省 0.3）
 *  - 门格本身可走（入口不砌死）；越界格视为违规 */
export interface BuildingSolidity {
  kind?: string;
  door?: [number, number] | null;
  minSolid?: number;
}
export function buildingRectViolations(
  w: number, h: number, blocked: number[], r: AuditRect, s: BuildingSolidity = {},
): string[] {
  const out: string[] = [];
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h) ? blocked[y * w + x] : 1;
  if (s.door) {
    const [dx, dy] = s.door;
    if (at(dx, dy) === 1) out.push(`${r.name}: 门格(${dx},${dy})被砌死，入口不可进出`);
  }
  const isStage = s.kind === 'stage';
  let solid = 0, total = 0;
  // 入口豁免集：door 格 3x3 → 沿 rect 外沿（边界行/列）经开放格 8-邻接连通扩张；内部掏洞永不豁免
  const onEdge = (x: number, y: number) => x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
  const exemptSet = new Set<string>();
  const ex = (x: number, y: number) => exemptSet.has(x + ',' + y);
  if (s.door) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = s.door[0] + dx, y = s.door[1] + dy;
      if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h && at(x, y) !== 1) { exemptSet.add(x + ',' + y); }
    }
    for (;;) {
      let grew = false;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        if (ex(x, y) || !onEdge(x, y) || at(x, y) === 1) continue;
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (ex(x + dx, y + dy)) { hit = true; break; }
        }
        if (hit) { exemptSet.add(x + ',' + y); grew = true; }
      }
      if (!grew) break;
    }
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const b = at(x, y); total++;
      if (b === 1) solid++;
      if (!isStage && b !== 1 && !ex(x, y)) out.push(`${r.name}: (${x},${y}) 声明为实体但未登记阻挡`);
      if (isStage && y < r.y + 3 && x >= r.x + 1 && x < r.x + 4 && b !== 1) out.push(`${r.name}: (${x},${y}) 环岛厅房身核心不得掏空`);
    }
  }
  if (isStage) {
    const min = s.minSolid ?? 0.3;
    if (solid / total < min) out.push(`${r.name}: 环岛厅实心率 ${(solid / total).toFixed(2)} < ${min}`);
  }
  return out;
}
