// navigation/reloc.ts —— 目标格动作预检与 move 失败文案装配（批1c Task1；纯函数无 IO）
// 可走口径与 audit.ts 一致：blocked!==1 && cost>0。
import type { NavGrid } from './navgen.ts';

export type CellKind = 'open' | 'block' | 'water' | 'tree' | 'out';

export function cellKindOf(nav: NavGrid, gx: number, gy: number): CellKind {
  if (gx < 0 || gy < 0 || gx >= nav.width || gy >= nav.height) return 'out';
  const i = gy * nav.width + gx;
  const k = nav.kind?.[i] ?? 0;
  if (nav.blocked[i] === 1) return k === 2 ? 'water' : 'block';
  if (k === 3) return 'tree';
  if (nav.cost?.[i] !== undefined && nav.cost[i] <= 0) return k === 2 ? 'water' : 'block';
  return 'open';
}

/** 8 邻可站立格（r=0 时仅自身，若自身可站；r 逐环升序） */
export function stdRingOf(nav: NavGrid, gx: number, gy: number, maxR = 4): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const walk = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < nav.width && y < nav.height &&
    nav.blocked[y * nav.width + x] !== 1 && (nav.cost?.[y * nav.width + x] ?? 1) > 0;
  for (let r = 0; r <= maxR; r++) {
    if (r === 0) { if (walk(gx, gy)) out.push([gx, gy]); continue; }
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (walk(gx + dx, gy + dy)) out.push([gx + dx, gy + dy]);
    }
  }
  return out;
}

/** 可站立格中距 from 切比雪夫最近者；同距按 (x,y) 升序取首 */
export function bestStandCell(nav: NavGrid, gx: number, gy: number, from: [number, number], maxR = 8): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const [x, y] of stdRingOf(nav, gx, gy, maxR)) {
    if (x === from[0] && y === from[1]) continue; // 当前位置本身不是「建议站立格」
    const d = Math.max(Math.abs(x - from[0]), Math.abs(y - from[1]));
    if (d < bestD) { best = [x, y]; bestD = d; }
  }
  return best;
}

const KIND_CN: Record<CellKind, string> = { open: '', block: '建筑/障碍', water: '水面', tree: '树丛', out: '越界(场景边界)' };

export function targetUnreachableMsg(cell: [number, number], kind: CellKind, alt: [number, number] | null): string {
  const [cx, cy] = cell;
  let s = `(目标格 ${cx},${cy})`;
  if (kind === 'out') s += ' 位于场景边界外（越界），请换场景内坐标';
  else if (kind !== 'open') s += ` 为${KIND_CN[kind]}，不可站立`;
  else s += ' 不可到达';
  if (alt) s += `；建议 move_to ${alt[0] * 100 + 50},${alt[1] * 100 + 50}`;
  return s + '。';
}

/** move_to 失败：双端点名 + 目标格 kind */
export function moveFailMsg(s: [number, number], goal: [number, number], navA: NavGrid, navB: NavGrid | null): string {
  const kind = cellKindOf(navB ?? navA, goal[0], goal[1]);
  return `移动失败：从 ${s[0]},${s[1]} 到 ${goal[0]},${goal[1]}（${navB ? `跨场景` : ''}目标格${KIND_CN[kind] ? KIND_CN[kind] + '阻挡，' : ''}不可达）${targetUnreachableMsg(goal, kind, bestStandCell(navA, goal[0], goal[1], s)).slice(1)}`;
}

export interface ActionPrecheckResult { ok: boolean; reason?: 'far' | 'target-blocked' | 'no-stand'; msg?: string }

/** 目标格动作（浇/种/收/plant/矿/fish）前置校验：先距离、再目标格可站、再邻接可站环 */
export function actionPrecheck(nav: NavGrid, goal: [number, number], pos: [number, number]): ActionPrecheckResult {
  const [gx, gy] = goal;
  const [px, py] = pos;
  if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) {
    return { ok: false, reason: 'far', msg: '离目标太远（需要站在目标格相邻格）' };
  }
  if (cellKindOf(nav, gx, gy) !== 'open') {
    const kind = cellKindOf(nav, gx, gy);
    return { ok: false, reason: 'target-blocked', msg: `目标格 ${gx},${gy} 为${KIND_CN[kind]}不可站立：${targetUnreachableMsg([gx, gy], kind, bestStandCell(nav, gx, gy, pos)).slice(1)}` };
  }
  if (stdRingOf(nav, gx, gy, 1).filter((c) => c[0] !== gx || c[1] !== gy).length === 0) {
    return { ok: false, reason: 'no-stand', msg: `目标格 ${gx},${gy} 四周无相邻可站立格（孤岛），请 change 换目标格` };
  }
  return { ok: true };
}
