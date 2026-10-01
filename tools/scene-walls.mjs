// tools/scene-walls.mjs —— 场景碰撞/水层提取单一源（roads-landmarks 自审观察项①去重）
// check-roads.mjs 与 build-scene-collisions.mjs 共用：口径 = collide 层 + never 层 + 全满遮罩防护 + shui 水层
// 村景（scene 2）碰撞/水层走 data/village-*.json（build-collision/build-farmgrid 产出），不在此模块。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** 村景老区 rect（原版 77x61 居中；P0 133 空间 +28=56 偏移，P3 189 空间再 +28=112 偏移）：双源一致性档比对范围 */
export const VILLAGE_OLD_RECT = { x0: 56, y0: 56, x1: 132, y1: 116 };

/**
 * P1c 语义层回退：collide 层为空时从场景语义层提取阻挡/水（层名精确匹配，拼音）。
 * 保守口径——已知实心物体才标阻挡（房子/坑/坏桥/裂壑/屏障/边界），
 * 歧义地形（如 suodao xiatukuda 44% 密集带、migon shiqian 满幅）保持可走；水层 = 含 "shui" 正则 + 温泉。
 * 每层自带全满遮罩防护（100% 非零视为渲染遮罩，如 migon collide / yiyuanshinei qiangbi）。
 * 已验证口径（门户可达性 BFS）：shanding 山层 shan 不入表——原版该场景 collide 全空、山体即可走，
 * 两个门户 (20,1)/(38,10) 都在山体 8 格带内，标山阻挡即断门户；水层 shanshui 照常保留（路带 bridge）。
 */
const SOLID_LAYER_NAMES = new Set(['fanzi', 'dik', 'huaiqiao', 'lieheng', 'barrir', 'bianyuan']);
const WATER_LAYER_NAMES = new Set(['wenquan']);

function layerNonZeroCount(data, n) { let c = 0; for (let i = 0; i < n; i++) c += data[i] ? 1 : 0; return c; }

/** 从 Tiled 场景 JSON 提取 { blocked, water }（行主序 0/1，w*h 长度）；口径与 build-scene-collisions 一致 */
export function extractSceneWalls(map, w, h) {
  const layers = Array.isArray(map.layers) ? map.layers : [];
  const n = w * h;
  // collide 层（隐藏碰撞层）；缺省回退：任一不可见且含非零数据的 tilelayer
  let collide = layers.find(l => l.name === 'collide');
  if (!collide) collide = layers.find(l => l.type === 'tilelayer' && l.visible === false && l.data && l.data.some(v => v));
  const blocked = new Array(n).fill(0);
  if (collide?.data) for (let i = 0; i < n; i++) if (collide.data[i]) blocked[i] = 1;
  // 退化防护（D6）：collide 层全满（100% 非零，如 migon 迷宫）视为渲染遮罩而非碰撞 -> 空网格
  if (blocked.filter(v => v === 1).length === n) blocked.fill(0);
  // never 层（绝对不可走，如危险区）并入 blocked
  const never = layers.find(l => /never/i.test(l.name || '') && l.data);
  if (never) for (let i = 0; i < n; i++) if (never.data[i]) blocked[i] = 1;
  // P1c 语义回退：collide/never 全空时，从实心语义层提取阻挡（每层全满遮罩防护）
  if (!blocked.some(v => v === 1)) {
    for (const l of layers) {
      if (l.type !== 'tilelayer' || !l.data || !SOLID_LAYER_NAMES.has(l.name)) continue;
      if (layerNonZeroCount(l.data, n) === n) continue;
      for (let i = 0; i < n; i++) if (l.data[i]) blocked[i] = 1;
    }
  }
  // 水层：名字含 "shui"（shuic/shuijingssss/shuitian/shanshui...）+ 温泉语义层
  const water = new Array(n).fill(0);
  for (const l of layers) {
    if (l.type !== 'tilelayer' || !l.data) continue;
    const isWater = /shui/.test(l.name || '') || WATER_LAYER_NAMES.has(l.name);
    if (!isWater) continue;
    if (layerNonZeroCount(l.data, n) === n) continue; // 全满遮罩防护
    for (let i = 0; i < n; i++) if (l.data[i]) water[i] = 1;
  }
  return { blocked, water };
}

/** 读取 maps/<slug>.json 并提取 { w, h, blocked, water }；无文件/缺维度返回 null */
export function loadSceneWalls(root, slug) {
  const p = join(root, 'server', 'public', 'client', 'maps', `${slug}.json`);
  if (!existsSync(p)) return null;
  const map = JSON.parse(readFileSync(p, 'utf8'));
  const w = Number(map.width), h = Number(map.height);
  if (!w || !h) return null;
  const { blocked, water } = extractSceneWalls(map, w, h);
  return { w, h, blocked, water };
}
