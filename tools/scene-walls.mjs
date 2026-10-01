// tools/scene-walls.mjs —— 场景碰撞/水层提取单一源（roads-landmarks 自审观察项①去重）
// check-roads.mjs 与 build-scene-collisions.mjs 共用：口径 = collide 层 + never 层 + 全满遮罩防护 + shui 水层
// 村景（scene 2）碰撞/水层走 data/village-*.json（build-collision/build-farmgrid 产出），不在此模块。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** 村景老区 rect（原版 77x61 居中 +28）：双源一致性档比对范围（自审观察项②常量） */
export const VILLAGE_OLD_RECT = { x0: 28, y0: 28, x1: 104, y1: 88 };

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
  // 水层：名字含 "shui"（shuic/shuijingssss/shuitian...）
  const water = new Array(n).fill(0);
  for (const l of layers) {
    if (l.type !== 'tilelayer' || !l.data || !/shui/.test(l.name || '')) continue;
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
