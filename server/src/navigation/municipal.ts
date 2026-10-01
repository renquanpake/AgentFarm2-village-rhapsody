// navigation/municipal.ts —— 市政数据层运行时（roads-landmarks 规划书 §4 指引三层的服务端侧）
// data/roads.json + data/landmarks.json 的 mtime 缓存加载；L3 文本指引（observe 区域级 POI + 地标方位）；
// 村景 nav+路网缓存（observe 纯函数用，不碰 ws 运行路径）。
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import type { NavGrid } from './navgen.ts';
import { navGridFromTables } from './navgen.ts';
import { applyRoads, roadOf, type RoadLine } from './roads.ts';

export interface Landmark { id: string; name: string; type: string; x: number; y: number; desc?: string; }
export interface Sign { scene: number; x: number; y: number; lines: string[]; landmark?: string; }

export interface MunicipalDoc {
  landmarks: Map<number, Landmark[]>; // 场景 id -> 地标
  signs: Sign[];
  roads: Map<number, RoadLine[]>;     // 场景 id -> 路段（L2 小地图折线 / kind=4 同源数据）
}

let cache: { dir: string; mtime: number; doc: MunicipalDoc } | null = null;

/** 加载市政数据（mtime 缓存；文件缺失返回空结构，单测/新档安全） */
export function municipalOf(app: App): MunicipalDoc {
  const dir = path.join(app.dataDir, '');
  const lmFile = path.join(app.dataDir, 'landmarks.json');
  const rdFile = path.join(app.dataDir, 'roads.json');
  const mt = Math.max(safeMtime(lmFile), safeMtime(rdFile));
  if (cache && cache.dir === dir && cache.mtime === mt) return cache.doc;
  const landmarks = new Map<number, Landmark[]>();
  let signs: Sign[] = [];
  const roads = new Map<number, RoadLine[]>();
  try {
    const lmDoc = JSON.parse(readFileSync(lmFile, 'utf8')) as Record<string, unknown>;
    for (const [k, v] of Object.entries(lmDoc)) {
      if (k === 'signs') {
        if (Array.isArray(v)) signs = v as Sign[];
        continue;
      }
      if (k === 'note' || !Array.isArray(v)) continue;
      const scene = Number(k);
      if (!Number.isFinite(scene)) continue;
      landmarks.set(scene, (v as Landmark[]).filter(lm => Number.isFinite(lm?.x) && Number.isFinite(lm?.y)));
    }
    const rdDoc = JSON.parse(readFileSync(rdFile, 'utf8')) as Record<string, { roads?: RoadLine[] }>;
    for (const [k, v] of Object.entries(rdDoc)) {
      if (k === 'note') continue;
      const scene = Number(k);
      if (!Number.isFinite(scene) || !v?.roads?.length) continue;
      roads.set(scene, v.roads.filter(r => r && Array.isArray(r.line) && r.line.length > 0));
    }
  } catch { /* 文件缺失/损坏 -> 空市政层（功能降级，不影响主流程） */ }
  const doc: MunicipalDoc = { landmarks, signs, roads };
  cache = { dir, mtime: mt, doc };
  return doc;
}

function safeMtime(file: string): number {
  try { return statSync(file).mtimeMs; } catch { return 0; }
}

let villageNavCache: { tables: App['tables']; mtime: number; nav: NavGrid } | null = null;
/** 村景 nav-grid（运行时 tables + 市政路 kind=4；双缓存：tables 引用 + roads mtime） */
export function villageNavOf(app: App): NavGrid | null {
  const mu = municipalOf(app);
  const roads = mu.roads.get(2) || [];
  const mtime = safeMtime(path.join(app.dataDir, 'roads.json'));
  if (villageNavCache && villageNavCache.tables === app.tables && villageNavCache.mtime === mtime) {
    return villageNavCache.nav;
  }
  const nav = navGridFromTables(app.tables);
  if (roads.length) applyRoads(nav, roads);
  villageNavCache = { tables: app.tables, mtime, nav };
  return nav;
}

export interface MunicipalContext {
  onRoad: string | null;           // 当前所在路名（roadOf 反查）
  nearest: Array<{ id: string; name: string; type: string; dist: number; dir: string; px: number; py: number }>;
}

/** L3 区域级指引（纯函数）：当前路名 + 最近地标（≤maxN，含切比雪夫距离与方位） */
export function municipalContext(nav: NavGrid | null, gx: number, gy: number, landmarks: Landmark[], maxN = 4, radius = 30): MunicipalContext {
  const onRoad = nav ? roadOf(nav, gx, gy) : null;
  const dirOf = (dx: number, dy: number): string => {
    const parts: string[] = [];
    if (dy <= -radius / 3) parts.push('北');
    else if (dy >= radius / 3) parts.push('南');
    if (dx <= -radius / 3) parts.push('西');
    else if (dx >= radius / 3) parts.push('东');
    return parts.length ? parts.join('') : '近旁';
  };
  const nearest = landmarks
    .map(lm => ({ lm, d: Math.max(Math.abs(lm.x - gx), Math.abs(lm.y - gy)) }))
    .filter(v => v.d <= radius && v.d > 0)
    .sort((a, b) => a.d - b.d || a.lm.id.localeCompare(b.lm.id))
    .slice(0, maxN)
    .map(v => ({
      id: v.lm.id, name: v.lm.name, type: v.lm.type,
      dist: v.d,
      dir: dirOf(v.lm.x - gx, v.lm.y - gy),
      px: v.lm.x * 100 + 50, py: v.lm.y * 100 + 50,
    }));
  return { onRoad, nearest };
}
