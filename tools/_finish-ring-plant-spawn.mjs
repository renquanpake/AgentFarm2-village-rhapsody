#!/usr/bin/env node
// tools/_finish-ring-plant-spawn.mjs —— P3 一次性补丁：TMX 已烘 189x173 但首轮工具在 plant 查找处中断
// 补做 ① plant json 133->189 平移 + 新环可种地 ② spawn-points.json 旧 7 户 +28 + 新增 id 9
// 跑完即可删除；expand-village-ring.mjs 已修复（findPlant），重烘须先 git 回滚资产再整体重跑。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CLIENT = join(ROOT, 'client', 'assets', 'resources', 'import');
const PLANT_JSON = join(CLIENT, '2c', '2cf76085-68a7-4e68-9e2d-e98eff639571.25ea3.json');
const SPAWN_OUT = join(ROOT, 'data', 'spawn-points.json');
const KEY = Buffer.from('qingyoo0316', 'utf8');
const SIGN = Buffer.from('qingyoo0316', 'utf8');
function decryptBuf(buf) {
  if (buf.length < SIGN.length) return buf;
  for (let i = 0; i < SIGN.length; i++) if (buf[i] !== SIGN[i]) return buf;
  const out = Buffer.allocUnsafe(buf.length - SIGN.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[SIGN.length + i] ^ KEY[i % KEY.length];
  return out;
}
function encryptBuf(buf) {
  const out = Buffer.allocUnsafe(SIGN.length + buf.length);
  SIGN.copy(out, 0);
  for (let i = 0; i < buf.length; i++) out[SIGN.length + i] = buf[i] ^ KEY[i % KEY.length];
  return out;
}
const SH = 28, W2 = 189, H2 = 173;

// ---------- ① plant json ----------
const plantDeep = JSON.parse(decryptBuf(readFileSync(PLANT_JSON)).toString('utf8'));
let plantTarget = null;
(function find(n) {
  if (Array.isArray(n)) return n.forEach(find);
  if (n && typeof n === 'object') { if (typeof n.mapWidth === 'number' && Array.isArray(n.plantSoils)) { plantTarget = n; return; } for (const v of Object.values(n)) find(v); }
})(plantDeep);
if (!plantTarget) throw new Error('plant target not found');
const pw = plantTarget.mapWidth, ph = plantTarget.mapHeight;
if (pw !== 133 || ph !== 117) throw new Error(`plant 已是 ${pw}x${ph}，重复执行（回滚资产后重跑工具）`);
console.log(`plant ${pw}x${ph} -> ${W2}x${H2}`);
const expandArr = (arr) => { const nd = new Array(W2 * H2).fill(0); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) nd[(y + SH) * W2 + (x + SH)] = arr[y * pw + x] || 0; return nd; };
const newSoils = expandArr(plantTarget.plantSoils);
const newNone = plantTarget.noneSoils ? expandArr(plantTarget.noneSoils) : null;
const markSoil = (x, y) => { if (x >= 0 && y >= 0 && x < W2 && y < H2) newSoils[y * W2 + x] = 1; };
for (let y = 88; y < 96; y++) for (let x = 4; x < 18; x++) markSoil(x, y); // 西环果园
for (const [bx, by, bw, bh] of [[172, 96, 10, 9], [172, 118, 10, 10], [174, 60, 9, 10], [91, 3, 9, 9]]) {
  for (let dy = 0; dy < bh + 4; dy++) for (let dx = 0; dx < bw + 4; dx++) {
    const x = bx - 2 + dx, y = by - 2 + dy;
    const inB = dx >= 2 && dx < 2 + bw && dy >= 2 && dy < 2 + bh;
    if (!inB) markSoil(x, y);
  }
}
plantTarget.mapWidth = W2; plantTarget.mapHeight = H2;
plantTarget.plantSoils = newSoils;
if (newNone) plantTarget.noneSoils = newNone;
writeFileSync(PLANT_JSON, encryptBuf(Buffer.from(JSON.stringify(plantDeep), 'utf8')));
console.log('plant json 已写回（加密）');

// ---------- ② spawn-points.json ----------
const spawnIn = JSON.parse(readFileSync(SPAWN_OUT, 'utf8'));
if ((spawnIn.houses || []).some(h => h.id === 9)) throw new Error('spawn-points 已含 id 9，重复执行');
const shifted = (spawnIn.houses || []).map(h => ({
  ...h,
  rect: { ...h.rect, x: h.rect.x + SH, y: h.rect.y + SH },
  door: { x: h.door.x + SH * 100, y: h.door.y + SH * 100 },
  treeRing: h.treeRing ? { ...h.treeRing, x: h.treeRing.x + SH, y: h.treeRing.y + SH } : undefined,
}));
shifted.push({
  id: 9, type: 'guonongjia(果农家)',
  rect: { x: 4, y: 100, w: 8, h: 8 },
  door: { x: 1200, y: 10400 },
  treeRing: { x: 3, y: 99, w: 10, h: 10 },
});
writeFileSync(SPAWN_OUT, JSON.stringify({ scene: 2, houses: shifted, trees: spawnIn.trees || [] }, null, 1), 'utf8');
console.log(`spawn-points 重写：${shifted.length} 户（旧 7 户 +28，新增 id 9 果农家 (4,100)）`);
