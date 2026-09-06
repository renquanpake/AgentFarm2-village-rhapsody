// maps.ts —— 地图元数据与碰撞（从 client/public/maps 的转换 JSON 读取；运行时只读缓存）
import fs from 'node:fs';
import path from 'node:path';
import { MAPS_DIR } from './config.ts';

// 资源判定（启发式，依据图集内容视觉确认 + VR 命名，U4 可调）
const ORE = /shilu|tanzi|shandoo|kuangshi|shanbj|bjshjan|skua|shuijing|lieheng|sdondong|diashi|shentis/;
const TREE = /byuand|sku/;          // byuand=树桩，sku=森林植被
const WATER = /shuic|haishui|shuitian|swen|shuiying/;

const metaCache = new Map<string, any>();
const collideCache = new Map<string, Uint8Array>();
const tileInfoCache = new Map<string, { tilesets: any[]; layers: { data: number[] }[]; width: number }>();

function tileInfo(mapName: string) {
  let info = tileInfoCache.get(mapName);
  if (info) return info;
  const p = path.join(MAPS_DIR, mapName + '.json');
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  info = {
    tilesets: j.tilesets || [],
    layers: (j.layers || []).filter((l: any) => l.type === 'tilelayer' && l.name !== 'collide'),
    width: j.width
  };
  tileInfoCache.set(mapName, info);
  return info;
}

/** 该格最上层的 tileset 名（含 gid） */
export function tileTilesetAt(mapName: string, c: number, r: number): { name: string; gid: number } | null {
  const info = tileInfo(mapName);
  if (!info || c < 0 || r < 0) return null;
  for (let li = info.layers.length - 1; li >= 0; li--) { // 视觉最上层优先
    const data = info.layers[li].data;
    const gid = data[r * info.width + c];
    if (gid > 0) {
      const t = info.tilesets.find((x: any) => gid >= x.firstgid && gid < x.firstgid + (x.tilecount || 1));
      if (t) return { name: t.name, gid };
    }
  }
  return null;
}

/** 资源判定：返回 'ore' | 'tree' | 'water' | null */
export function resourceAt(mapName: string, c: number, r: number): { kind: 'ore' | 'tree' | 'water'; ts: string } | null {
  const info = tileInfo(mapName);
  if (!info) return null;
  for (const layer of info.layers) { // 所有层中资源 tileset 命中即判（资源优先于表面层）
    const gid = layer.data[r * info.width + c];
    if (gid > 0) {
      const t = info.tilesets.find((x: any) => gid >= x.firstgid && gid < x.firstgid + (x.tilecount || 1));
      if (t) {
        if (ORE.test(t.name)) return { kind: 'ore', ts: t.name };
        if (TREE.test(t.name)) return { kind: 'tree', ts: t.name };
        if (WATER.test(t.name)) return { kind: 'water', ts: t.name };
      }
    }
  }
  return null;
}

export function mapMeta(mapName: string): { width: number; height: number; tilewidth: number; tileheight: number } | null {
  if (metaCache.has(mapName)) return metaCache.get(mapName)!;
  const p = path.join(MAPS_DIR, mapName + '.json');
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const meta = { width: j.width, height: j.height, tilewidth: j.tilewidth, tileheight: j.tileheight };
  metaCache.set(mapName, meta);
  return meta;
}

/** 每格可通行判定（缓存）。无 collide 层（整图纹理地图）→ 全部可走 */
export function collideOf(mapName: string): Uint8Array | null {
  if (collideCache.has(mapName)) return collideCache.get(mapName)!;
  const p = path.join(MAPS_DIR, mapName + '.json');
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const l = (j.layers || []).find((x: any) => x.name === 'collide');
  const arr = l ? Uint8Array.from(l.data) : new Uint8Array(j.width * j.height); // 整图地图全可走
  collideCache.set(mapName, arr);
  return arr;
}

export function isWalkable(mapName: string, c: number, r: number): boolean {
  const meta = mapMeta(mapName);
  if (!meta) return false;
  if (c < 0 || r < 0 || c >= meta.width || r >= meta.height) return false;
  const col = collideOf(mapName);
  return !col[r * meta.width + c];
}