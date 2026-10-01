// tools/expand-village-ring.mjs —— P3 +28 环（二轮扩展）：133x117 -> 189x173
// 设计：world-expansion design.md §2（189x173，每环 28 格）
// 原理：读当前 Cocos 村景资产（133x117，P0 已扩）为源，整体平移 +28 到中心，外环 28 格按 design 填充：
//   西环：果园（可放置 decor plant 类）+ 果农宅（新增宅基地 house id 9）
//   南环：新河湾（shuich 水系接东河）+ 钓点 2 处（4 jitishuitian 门户联动）
//   东环：新建筑街（3 建筑块 + 广场空地）+ 集市外摊区
//   北环：树林（mulan 树丛）+ 气象台小塔（1 小建筑块）
// 产物：重写村景 TMX 资产（加密）+ 同步 plant json + 重写 spawn-points.json（旧 7 户 +28，新增 id 9）
// 前置：相机/边界 spike 已确认——原版 updateCameraPos 钳制 sceneSize=tiledMap.getMapSize()x tileSize，
//       随资产尺寸自动扩展，本工具零相机代码改动。
// 注意：此工具改写 client/assets 加密资产 + 重写 spawn-points；跑后须重跑 build-collision/build-farm
//       并把全部村景数据（roads/landmarks/decor/buildings/portals 村景侧）+28 偏移（见 shift-village-data.mjs）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CLIENT = join(ROOT, 'client', 'assets', 'resources', 'import');
const VILLAGE_JSON = join(CLIENT, 'eb', 'eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const PLANT_JSON = join(CLIENT, '2c', '2cf76085-68a7-4e68-9e2d-e98eff639571.25ea3.json');
const SPAWN_OUT = join(ROOT, 'data', 'spawn-points.json');

// ---------- 资源加解密（client 副本里的资源带 qingyoo0316 签名 + 循环 XOR） ----------
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
function readAsset(p) { return JSON.parse(decryptBuf(readFileSync(p)).toString('utf8')); }
function writeAsset(p, obj) { writeFileSync(p, encryptBuf(Buffer.from(JSON.stringify(obj), 'utf8'))); }

// ---------- 解析当前 TMX ----------
const raw = readAsset(VILLAGE_JSON);
const rawStr = JSON.stringify(raw);
const nameIdx = rawStr.indexOf('"daditu"');
if (nameIdx < 0) throw new Error('daditu asset not found');
let valStart = -1, valEnd = -1;
{
  let i = nameIdx + '"daditu"'.length;
  while (i < rawStr.length && rawStr[i] !== '"') i++;
  valStart = i; i++;
  while (i < rawStr.length) { const c = rawStr[i]; if (c === '\\') { i += 2; continue; } if (c === '"') { valEnd = i; break; } i++; }
}
if (valStart < 0 || valEnd < 0) throw new Error('tmx value not found');
const tmxXml = JSON.parse(rawStr.slice(valStart, valEnd + 1));

function parseAttrs(tag) { const a = {}; for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) a[m[1]] = m[2]; return a; }
function decodeLayerData(body) { return Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(body.replace(/\s/g, ''), 'base64')).buffer)); }
function encodeLayerData(arr) { const buf = Buffer.alloc(arr.length * 4); for (let i = 0; i < arr.length; i++) buf.writeUInt32LE(arr[i], i * 4); return zlib.deflateSync(buf).toString('base64'); }

const mapTag = tmxXml.match(/<map[^>]*>/)[0];
const ma = parseAttrs(mapTag);
const W = +ma.width, H = +ma.height, TW = +ma.tilewidth, TH = +ma.tileheight;
if (W !== 133 || H !== 117) throw new Error(`期望 133x117 源，实际 ${W}x${H}（先跑 P0 扩展或回滚）`);
console.log(`源 TMX ${W}x${H} -> 目标 189x173`);

const layerRe = /<layer\b[^>]*>[\s\S]*?<\/layer>/g;
const layers = [];
for (const lt of tmxXml.match(layerRe) || []) {
  const la = parseAttrs(lt.match(/<layer[^>]*>/)[0]);
  const dataTag = lt.match(/<data[^>]*>([\s\S]*?)<\/data>/);
  if (!dataTag) continue;
  const arr = decodeLayerData(dataTag[1]);
  if (arr.length !== W * H) throw new Error(`layer ${la.name} len ${arr.length} != ${W * H}`);
  layers.push({ name: la.name, data: arr });
}
console.log('layers:', layers.map(l => l.name).join(','));

// ---------- 平移 +28 到中心 ----------
const SH = 28;
const W2 = W + SH * 2, H2 = H + SH * 2; // 189 x 173
const NEW = W2 * H2;
const newLayers = [];
for (const L of layers) {
  const nd = new Array(NEW).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) nd[(y + SH) * W2 + (x + SH)] = L.data[y * W + x];
  newLayers.push({ name: L.name, data: nd });
}
const get = (n) => newLayers.find(l => l.name === n).data;
const putTile = (n, x, y, gid) => { if (x >= 0 && y >= 0 && x < W2 && y >= 0 && y < H2 && gid) get(n)[y * W2 + x] = gid; };
const getTile = (n, x, y) => (x < 0 || y < 0 || x >= W2 || y >= H2) ? 0 : get(n)[y * W2 + x];
const inRing = (x, y) => x < SH || y < SH || x >= SH + W || y >= SH + H;

// ---------- 环填充：沙底 + 草皮（值噪声，与 P0 同风格） ----------
const SAND_GIDS = [1, 2, 3, 4];
const GRASS_GIDS = [5, 6, 7, 8];
let seed = 20261001;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function hash2(x, y) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function grassGid(x, y) {
  const C = 13, B = C - 1;
  const gx = Math.floor(x / C), gy = Math.floor(y / C);
  const fx = Math.min(1, (x % C) / B), fy = Math.min(1, (y % C) / B);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (hash2(gx, gy) * (1 - sx) + hash2(gx + 1, gy) * sx) * (1 - sy) + (hash2(gx, gy + 1) * (1 - sx) + hash2(gx + 1, gy + 1) * sx) * sy;
  const t = 885 + 869 + 839 + 825; const r = v * t; let g;
  if (r < 885) g = 5; else if (r < 885 + 869) g = 6; else if (r < 885 + 869 + 839) g = 7; else g = 8;
  if (hash2(x, y) < 0.3) g += hash2(x + 7, y + 3) < 0.5 ? -1 : 1;
  if (g < 5) g = 5; if (g > 8) g = 8;
  return g;
}
const SAND_WEIGHTS = SAND_GIDS.map(g => get('diji').filter(v => v === g).length);
function randSand() { const t = SAND_WEIGHTS.reduce((a, b) => a + b, 0) || 1; let r = rnd() * t; for (let i = 0; i < SAND_GIDS.length; i++) { r -= SAND_WEIGHTS[i] || 0; if (r <= 0) return SAND_GIDS[i]; } return SAND_GIDS[0]; }
for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
  if (!inRing(x, y)) continue;
  putTile('diji', x, y, randSand());
  putTile('caodi', x, y, grassGid(x, y));
}
console.log('环 沙底/草皮 完成');

// 外圈栅栏环（保留 P0 既有：原图外圈 2 格 mulan 仍在 SH 偏移后的原位，不动）
const FENCE_LAYERS = ['mulan', 'mulan2'];
const carve = (x, y) => { if (!inRing(x, y)) return; get('caodi')[y * W2 + x] = 0; for (const f of FENCE_LAYERS) if (get(f)) get(f)[y * W2 + x] = 0; };

// ---------- 房型块复制源（133 空间坐标：P0 已落位的 7 户位置） ----------
const HOUSE_SRC = {
  guonong: { type: 'guonongjia(果农家)', srcRect: { x: 108, y: 54, w: 8, h: 8 } }, // 家石伯房型 8x8
  gym: { type: 'gymhouse(健身房)', srcRect: { x: 32, y: 15, w: 10, h: 9 } },      // 树根家 10x9
  forge: { type: 'forgehouse(铁匠铺)', srcRect: { x: 69, y: 15, w: 10, h: 10 } }, // 小卖部 10x10 @133空间
  stall: { type: 'stallhouse(集市外摊)', srcRect: { x: 32, y: 91, w: 9, h: 10 } }, // 木匠家 9x10
  tower: { type: 'towerhouse(气象台小塔)', srcRect: { x: 107, y: 26, w: 9, h: 9 } }, // 屠夫家 9x9 @133空间
};
const COPY_LAYERS = new Set(['fanzi', 'mulan', 'mulan2', 'mulan3', 'mulan4', 'caoduo1', 'caoduo2', 'caodui']);
function copyHouse(key, dstX, dstY, band = 'S') {
  const h = HOUSE_SRC[key];
  for (const L of layers) {
    if (!COPY_LAYERS.has(L.name)) continue;
    for (let dy = 0; dy < h.srcRect.h; dy++) for (let dx = 0; dx < h.srcRect.w; dx++) {
      const g = L.data[(h.srcRect.y + dy) * W + (h.srcRect.x + dx)];
      if (g) putTile(L.name, dstX + dx, dstY + dy, g);
    }
  }
  // 门前石板垫（2 格宽 1 格深，朝向 band：S=宅南 / E=宅东）
  const midX = dstX + Math.floor(h.srcRect.w / 2);
  const midY = dstY + Math.floor(h.srcRect.h / 2);
  const pad = band === 'E'
    ? Array.from({ length: h.srcRect.h }, (_, i) => [dstX + h.srcRect.w + 1, dstY + i])
    : [[midX - 1, dstY + h.srcRect.h + 1], [midX, dstY + h.srcRect.h + 1]];
  for (const [px, py] of pad) if (inRing(px, py)) { carve(px, py); putTile('shilu', px, py, 847); }
  console.log(`已复制 ${h.type} -> (${dstX},${dstY}) band=${band}`);
}

// ---------- 环上建筑/水/路布局（新 189 空间；SH=28 为 133 内容偏移） ----------
// P0 四门缺口（133 空间 +28 -> 189 空间）：W x28..55 @ y105..107 / E x133..160 @ y105..107 / N x95..97 @ y28..55 / S x95..97 @ y117..144
// P0 外圈栅栏环（189 坐标）：x28-29 / x159-160 / y28-29 / y143-144（缺口行/列已开）
// 西环：果农宅（id 9）门朝东 + 果园 + 门路接 P0 W 缺口
copyHouse('guonong', 4, 100, 'E'); // x4-11 y100-107；门垫 x12 @ y100..107
{
  for (let y = 88; y < 96; y++) for (let x = 4; x < 18; x++) if (inRing(x, y)) carve(x, y); // 果园 x4-17 y88-95（宅北）
  for (let x = 13; x <= 27; x++) for (let y = 105; y <= 107; y++) if (inRing(x, y)) carve(x, y); // 门路 -> P0 W 缺口
}
console.log('西环 果农宅+果园 完成');

// ---------- 南环：新河湾 3 条水道（东端开口）+ 接驳路（x94-96 直贯 P0 S 缺口列） ----------
{
  const waterGid = 660; // shuich 层 firstgid
  for (const wy of [151, 159, 167]) for (let x = 32; x <= 185; x++) if (inRing(x, wy)) { putTile('shuich', x, wy, waterGid); carve(x, wy); }
  for (let y = 145; y <= 150; y++) for (let x = 94; x <= 96; x++) if (inRing(x, y)) carve(x, y); // 接驳 -> P0 S 缺口（x95-97 @ y144）
}
console.log('南环 河湾 3 水道 完成');

// ---------- 东环：新建筑街（3 建筑块 + 广场空地）+ 集市外摊 ----------
copyHouse('gym', 172, 96, 'W');    // x172-181 y96-104；门垫 x171 @ y96..104
copyHouse('forge', 172, 118, 'W'); // x172-181 y118-127；门垫 x171 @ y118..127
copyHouse('stall', 174, 60, 'W');  // x174-182 y60-69；门垫 x173 @ y60..69
{
  for (let y = 60; y <= 140; y++) for (let x = 161; x <= 163; x++) if (inRing(x, y)) carve(x, y); // 街路 x161-163（跨 y105-107 接 P0 E 缺口）
  for (let y = 98; y <= 100; y++) for (let x = 164; x <= 170; x++) if (inRing(x, y)) carve(x, y); // gym 横路
  for (let y = 120; y <= 122; y++) for (let x = 164; x <= 170; x++) if (inRing(x, y)) carve(x, y); // forge 横路
  for (let y = 62; y <= 64; y++) for (let x = 164; x <= 172; x++) if (inRing(x, y)) carve(x, y); // stall 横路
}
console.log('东环 建筑街+广场 完成');

// ---------- 北环：树林 + 气象台小塔（塔门路 x94-96 直贯 P0 N 缺口列） ----------
copyHouse('tower', 91, 3, 'S'); // x91-99 y3-11；门垫 y12 @ x94-96
{
  for (let y = 12; y <= 27; y++) for (let x = 94; x <= 96; x++) if (inRing(x, y)) carve(x, y); // 门路 -> P0 N 缺口（x95-97 @ y28）
  for (let y = 2; y <= 25; y++) for (let x = 32; x <= 156; x++) {
    if (!inRing(x, y) || x >= 93 && x <= 97) continue; // 塔门路留空
    if (hash2(x, y) < 0.16) { putTile('mulan', x, y, 102); if (hash2(x + 3, y + 1) < 0.5) putTile('mulan2', x, y, 103); }
  }
}
console.log('北环 树林+气象台小塔 完成');

// ---------- P3 外圈栅栏环（189 边）：4 门缺口对齐环道路（W y105-107 / E y105-107 / N x94-96 / S x94-96） ----------
{
  const inP3Gate = (x, y) =>
    (y >= 105 && y <= 107 && x <= 30) || (y >= 105 && y <= 107 && x >= W2 - 31) ||
    (x >= 93 && x <= 97 && y <= 30) || (x >= 93 && x <= 97 && y >= H2 - 31);
  for (let i = 0; i < W2; i++) for (const y of [0, 1, H2 - 2, H2 - 1]) if (!inP3Gate(i, y)) putTile('mulan', i, y, 102);
  for (let j = 0; j < H2; j++) for (const x of [0, 1, W2 - 2, W2 - 1]) if (!inP3Gate(x, j)) putTile('mulan', x, j, 102);
  console.log('P3 外圈栅栏环 完成');
}

// ---------- 写回 tmxXmlStr ----------
function buildXml() {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\r\n<map version="1.8" tiledversion="1.8.4" orientation="orthogonal" renderorder="right-down" width="${W2}" height="${H2}" tilewidth="${TW}" tileheight="${TH}" infinite="0" nextlayerid="18" nextobjectid="1">\r\n`;
  xml += tmxXml.match(/<map[^>]*>([\s\S]*?)<layer/)[1];
  const origOrder = []; for (const lt of tmxXml.match(layerRe) || []) origOrder.push(parseAttrs(lt.match(/<layer[^>]*>/)[0]).name);
  let layerId = 1;
  for (const name of origOrder) {
    const L = newLayers.find(l => l.name === name); if (!L) continue;
    xml += ` <layer id="${layerId}" name="${name}" width="${W2}" height="${H2}">\r\n  <data encoding="base64" compression="zlib">\r\n${encodeLayerData(L.data)}\r\n  </data>\r\n </layer>\r\n`;
    layerId++;
  }
  xml += '</map>';
  return xml;
}
const newXml = buildXml();
const newRawStr = rawStr.slice(0, valStart + 1) + JSON.stringify(newXml).slice(1, -1) + rawStr.slice(valEnd);
writeFileSync(VILLAGE_JSON, encryptBuf(Buffer.from(newRawStr, 'utf8')));
console.log('已写回地图 json(加密):', VILLAGE_JSON);

// ---------- 同步 plant json（平移 +28 + 新环可种地） ----------
const plantDeep = readAsset(PLANT_JSON);
let plantTarget = null;
function findPlant(n) {
  if (Array.isArray(n)) { n.forEach(findPlant); return; }
  if (n && typeof n === 'object') { if (typeof n.mapWidth === 'number' && Array.isArray(n.plantSoils)) { plantTarget = n; return; } for (const v of Object.values(n)) findPlant(v); }
}
findPlant(plantDeep);
if (!plantTarget) throw new Error('plant target not found');
const pw = plantTarget.mapWidth, ph = plantTarget.mapHeight;
console.log(`plant ${pw}x${ph} -> ${W2}x${H2}`);
const expandArr = (arr) => { const nd = new Array(W2 * H2).fill(0); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) nd[(y + SH) * W2 + (x + SH)] = arr[y * pw + x] || 0; return nd; };
const newSoils = expandArr(plantTarget.plantSoils);
const newNone = expandArr(plantTarget.noneSoils || []);
// 新环可种地：西环果园（x4-17 y88-95）+ 东环建筑块外圈 2 格田 + 北环小塔外圈
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
if (plantTarget.noneSoils) plantTarget.noneSoils = newNone;
writeAsset(PLANT_JSON, plantDeep);
console.log('已写回 plant json(加密):', PLANT_JSON);

// ---------- 重写 spawn-points.json（旧 7 户 +28，新增 id 9 果农宅） ----------
const spawnIn = JSON.parse(readFileSync(SPAWN_OUT, 'utf8'));
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
mkdirSync(dirname(SPAWN_OUT), { recursive: true });
writeFileSync(SPAWN_OUT, JSON.stringify({ scene: 2, houses: shifted, trees: spawnIn.trees || [] }, null, 1), 'utf8');
console.log('出生点表:', SPAWN_OUT, `共 ${shifted.length} 户`);
console.log('P3 +28 环扩展完成。后续：node tools/build-collision.mjs && node tools/build-farm.mjs && node tools/shift-village-data.mjs && node tools/gen-nav.mjs');
