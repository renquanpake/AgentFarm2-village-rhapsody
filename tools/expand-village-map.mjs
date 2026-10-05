// expand-village-map.mjs —— 村地图(daditu)四向扩展，为 2~8 号玩家放置宅基地
// 原理：村地图 tmx 内嵌在 import json 的 tmxXmlStr（明文），层 data 为 base64+zlib。
// 步骤：
//   1. 解析 tmxXmlStr XML
//   2. 四向扩展 width/height（上 top/下 bottom/左 left/右 right 格）
//   3. 每层 data 平移+扩展（新增区按层类型填充：地面草/树/装饰）
//   4. 从原地图复制 7 种房型块（fanzi 等层矩形）粘贴到扩展区
//   5. 铺门前石板路
//   6. 写回 import json（tmxXmlStr）+ 同步扩展 plant json（plantSoils）
//   7. 输出 data/spawn-points.json（出生点表）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { TRANS_GIDS, GRASS_GIDS, EDGE_FLIP, fringeGid } from './lib/grass-fringe.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(__dirname, '..', 'client', 'assets', 'resources', 'import');
const VILLAGE_JSON = join(CLIENT, 'eb', 'eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const PLANT_JSON = join(CLIENT, '2c', '2cf76085-68a7-4e68-9e2d-e98eff639571.25ea3.json');
// ponytail: 每次从原版备份重建，避免在已经污染的扩展地图上重复叠贴。
const VILLAGE_SOURCE = join(__dirname, '..', '_backup', 'daditu-tmx.json.bak');
const PLANT_SOURCE = join(__dirname, '..', '_backup', 'daditu-plant.json.bak');
const SPAWN_OUT = join(__dirname, '..', 'data', 'spawn-points.json');

// ---------- 资源加解密（client 副本里的资源带 qingyoo0316 签名 + 循环 XOR） ----------
const KEY = Buffer.from('qingyoo0316', 'utf8');
const SIGN = Buffer.from('qingyoo0316', 'utf8');
function decryptBuf(buf) {
  if (buf.length < SIGN.length) return buf;
  for (let i = 0; i < SIGN.length; i++) if (buf[i] !== SIGN[i]) return buf; // 明文
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

// ---------- 扩展参数 ----------
const TOP = 28, BOTTOM = 28, LEFT = 28, RIGHT = 28; // 各端扩展格数（原 14 → 翻倍 28）
const MSHIFT = 14; // 宅基地相对外缘保持旧构图：随边距外移 14 格

// 7 户宅基地布局（房型、位置）。位置 = 扩展后的格坐标
// 房型矩形：从原地图复制（原坐标 → 新坐标偏移量在代码里处理）
const HOUSES = [
  // 北端（y 0-27 新区，房子门朝南=朝地图中心）
  { id: 2, type: 'shugenjia(树根家)', srcRect: { x: 20, y: 15, w: 10, h: 9 }, dst: { x: 18 + MSHIFT, y: 1 + MSHIFT } },
  { id: 3, type: 'xiaomaibu(小卖部)', srcRect: { x: 48, y: 20, w: 10, h: 10 }, dst: { x: 55 + MSHIFT, y: 1 + MSHIFT } },
  // 南端（y 89-116 新区）
  { id: 4, type: 'mujiangfangzi(木匠家)', srcRect: { x: 0, y: 36, w: 9, h: 10 }, dst: { x: 18 + MSHIFT, y: 77 + MSHIFT } },
  { id: 5, type: 'laotaiaifz(老太太家)', srcRect: { x: 19, y: 36, w: 7, h: 9 }, dst: { x: 55 + MSHIFT, y: 78 + MSHIFT } },
  // 东端（x 105-132 新区）
  { id: 6, type: 'tufufzi(屠夫家)', srcRect: { x: 63, y: 38, w: 9, h: 9 }, dst: { x: 93 + MSHIFT, y: 12 + MSHIFT } },
  { id: 7, type: 'shibojias(家石伯家)', srcRect: { x: 63, y: 0, w: 8, h: 8 }, dst: { x: 94 + MSHIFT, y: 40 + MSHIFT } },
  // 西端（x 0-27 新区）
  { id: 8, type: 'shibojias(家石伯家)', srcRect: { x: 63, y: 0, w: 8, h: 8 }, dst: { x: 2 + MSHIFT, y: 24 + MSHIFT } },
];

// ---------- XML / tile 工具 ----------
function parseAttrs(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}
function decodeLayerData(body) {
  const b64 = body.replace(/\s/g, '');
  return Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(b64, 'base64')).buffer));
}
function encodeLayerData(arr) {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) buf.writeUInt32LE(arr[i], i * 4);
  return zlib.deflateSync(buf).toString('base64');
}

// ---------- 主流程 ----------
const raw = readAsset(VILLAGE_SOURCE);
// 找到 tmxXmlStr 字段（json 里是字符串，含转义 XML）
// raw 结构: [1, [textureIds...], 0, [["cc.TiledMapAsset",["_name","tmxXmlStr",...],0,3,12]], [[0,0,1,2,3,4,4]], [[0,"daditu","<xml...>", textureNames?, ...]], ...]
// 数据数组结构: [..., [0,"daditu","<xml...>", ...], ...] —— tmx XML 是 "daditu" 名后的第一个字符串值
const rawStr = JSON.stringify(raw);
const nameIdx = rawStr.indexOf('"daditu"');
if (nameIdx < 0) throw new Error('daditu asset not found');
let valStart = -1, valEnd = -1;
{
  let i = nameIdx + '"daditu"'.length;
  while (i < rawStr.length && rawStr[i] !== '"') i++; // 值开头的引号
  valStart = i;
  i++;
  while (i < rawStr.length) {
    const c = rawStr[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') { valEnd = i; break; }
    i++;
  }
}
if (valStart < 0 || valEnd < 0) throw new Error('tmx value not found');
const tmxXml = JSON.parse(rawStr.slice(valStart, valEnd + 1)); // 反转义
console.log('tmxXmlStr length:', tmxXml.length);

// 解析 XML
const mapTag = tmxXml.match(/<map[^>]*>/)[0];
const m = parseAttrs(mapTag);
const W = +m.width, H = +m.height, TW = +m.tilewidth, TH = +m.tileheight;
const W2 = W + LEFT + RIGHT, H2 = H + TOP + BOTTOM;
console.log(`地图 ${W}x${H} -> ${W2}x${H2}`);

// 提取所有 layer（name -> data 数组）
const layerRe = /<layer\b[^>]*>[\s\S]*?<\/layer>/g;
const layers = []; // {name, data: Uint32Array, props}
for (const lt of tmxXml.match(layerRe) || []) {
  const la = parseAttrs(lt.match(/<layer[^>]*>/)[0]);
  const dataTag = lt.match(/<data[^>]*>([\s\S]*?)<\/data>/);
  if (!dataTag) continue;
  const da = parseAttrs(lt.match(/<data[^>]*>/)[0]);
  if (da.encoding !== 'base64') throw new Error('unexpected encoding ' + da.encoding);
  const arr = decodeLayerData(dataTag[1]);
  if (arr.length !== W * H) throw new Error(`layer ${la.name} len ${arr.length} != ${W * H}`);
  layers.push({ name: la.name, data: arr, opacity: la.opacity });
}
console.log('layers:', layers.map(l => l.name).join(','));

// ★ 原版视觉语言（来自 _audit 数据）：
//   diji 层 100% 是沙地 gid1-4；草地 gid5-8 全部铺在 caodi 层，草地/沙地交界用
//   gid100+翻转位 的过渡块（翻转规律：沙在东→H|D(5)、南→H(4)、北→V|D(3)、西→无(0)）；
//   全图只有村中一处石板广场（shilu 847-903），"路"= 裸露沙地。
const SAND_GIDS = [1, 2, 3, 4];
const ROAD_GIDS = Array.from({ length: 903 - 847 + 1 }, (_, i) => 847 + i); // 847-903 石板路
// 草地 gid 分布（从 diji/caodi 层统计原地图权重）
const diji = layers.find(l => l.name === 'diji').data;
const caodiLayer = layers.find(l => l.name === 'caodi');
const caodi = caodiLayer ? caodiLayer.data : diji;
const sandW = SAND_GIDS.map(g => diji.filter(v => v === g).length).reduce((a, b) => a + b, 0);
const grassW = GRASS_GIDS.map(g => caodi.filter(v => v === g).length).reduce((a, b) => a + b, 0);
console.log('沙地权重:', sandW, '草地权重:', grassW);
// 固定种子随机（每次从备份重建，保证可复现）
let seed = 20260818;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function randSand() {
  const w = SAND_GIDS.map(g => diji.filter(v => v === g).length);
  const t = w.reduce((a, b) => a + b, 0);
  let r = rnd() * t;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return SAND_GIDS[i]; }
  return SAND_GIDS[0];
}
function randGrass() {
  const w = GRASS_GIDS.map(g => caodi.filter(v => v === g).length);
  const t = w.reduce((a, b) => a + b, 0);
  let r = rnd() * (t || 1);
  for (let i = 0; i < w.length; i++) { r -= (w[i] || 1); if (r <= 0) return GRASS_GIDS[i]; }
  return GRASS_GIDS[0];
}

// ---------- 扩展每层 ----------
// 新 data：先全 0，然后把原图平移到 (LEFT, TOP)
const NEW = W2 * H2;
const newLayers = [];
for (const L of layers) {
  const nd = new Array(NEW).fill(0);
  for (let y = 0; y < H; y++) {
    const srcRow = y * W;
    const dstRow = (y + TOP) * W2 + LEFT;
    for (let x = 0; x < W; x++) nd[dstRow + x] = L.data[srcRow + x];
  }
  newLayers.push({ name: L.name, data: nd });
}
const get = (name) => newLayers.find(l => l.name === name).data;
const putTile = (name, x, y, gid) => { if (x >= 0 && y >= 0 && x < W2 && y < H2 && gid) get(name)[y * W2 + x] = gid; };
const getTile = (name, x, y) => get(name)[y * W2 + x];

// ---------- 填充扩展区（原版风格：沙底 + 草皮，再刻出沙路） ----------
const inExp = (x, y) => x >= 0 && y >= 0 && x < W2 && y < H2 && !(x >= LEFT && x < LEFT + W && y >= TOP && y < TOP + H);
const inOrigCell = (x, y) => x >= LEFT && x < LEFT + W && y >= TOP && y < TOP + H;
const FENCE_LAYERS = ['mulan', 'mulan2'];
// 刻沙 = 清掉草皮露出沙底；路上的栅栏/树篱一并清除（防止"栅栏横在路中间"）
const carve = (x, y) => {
  if (!inExp(x, y)) return;
  get('caodi')[y * W2 + x] = 0;
  for (const f of FENCE_LAYERS) { const L = get(f); if (L) L[y * W2 + x] = 0; }
};
// 1) 沙底 + 草皮：原版草皮是"大块同色区"风格（同 gid 连续 16+ 格），用值噪声生成有机色块
function hash2(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function grassGid(x, y) {
  const C = 13, B = C - 1;
  const gx = Math.floor(x / C), gy = Math.floor(y / C);
  const fx = Math.min(1, (x % C) / B), fy = Math.min(1, (y % C) / B);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (hash2(gx, gy) * (1 - sx) + hash2(gx + 1, gy) * sx) * (1 - sy)
          + (hash2(gx, gy + 1) * (1 - sx) + hash2(gx + 1, gy + 1) * sx) * sy;
  const t = 885 + 869 + 839 + 825;
  const r = v * t;
  let g;
  if (r < 885) g = 5;
  else if (r < 885 + 869) g = 6;
  else if (r < 885 + 869 + 839) g = 7;
  else g = 8;
  // 块内混色：30% 概率取相邻 gid（原版观感：大色块 + 少量细节变化）
  if (hash2(x, y) < 0.3) g += hash2(x + 7, y + 3) < 0.5 ? -1 : 1;
  if (g < 5) g = 5; if (g > 8) g = 8;
  return g;
}
for (let y = 0; y < H2; y++) {
  for (let x = 0; x < W2; x++) {
    if (!inExp(x, y)) continue;
    putTile('diji', x, y, randSand());
    putTile('caodi', x, y, grassGid(x, y));
  }
}
// 1.5) 接缝镜像：原版外圈 2 行/列（caodi + 装饰层）镜像到扩展区贴缝处，保证接缝色调连续
// 坐标纪律（SPEC-VISUAL-001 §2.1，2026-10-05 修正）：原版 (W,H) 被平移到扩展网格的
// (LEFT, TOP)，故源列 sx / 行 sy 落到扩展坐标时必须补上该偏移。
// 修正前四条带的 dx/dy 全部漏补偏移，导致镜像带整体错位 28 格——原版最左侧的悬崖边、
// 断层水块、碎木桩被以错误原点投射到外圈沙地，即 lot_2 的碎瓦残影/悬空水井。
// 现在四条带一律以 LEFT/TOP 对齐（north/south 带补 dx=LEFT，west/east 带补 dy=TOP）。
const MIRROR_LAYERS = ['caodi', 'mulan', 'mulan2', 'caoduo1', 'caoduo2', 'caodui', 'caodi2'];
const EDGE_MIRROR = [
  { sx: 0, sy: 0, dx: LEFT, dy: TOP - 2, w: W, h: 2 },
  { sx: 0, sy: H - 2, dx: LEFT, dy: TOP + H, w: W, h: 2 },
  { sx: 0, sy: 0, dx: LEFT - 2, dy: TOP, w: 2, h: H },
  { sx: W - 2, sy: 0, dx: LEFT + W, dy: TOP, w: 2, h: H },
];
for (const e of EDGE_MIRROR) {
  for (let dy = 0; dy < e.h; dy++) {
    for (let dx = 0; dx < e.w; dx++) {
      const tx = e.dx + dx, ty = e.dy + dy;
      if (!inExp(tx, ty)) continue;
      const srcIdx = (e.sy + dy) * W + (e.sx + dx);
      for (const ln of MIRROR_LAYERS) {
        const L = layers.find(l => l.name === ln);
        if (!L) continue;
        const g = L.data[srcIdx];
        if (ln === 'caodi') get('caodi')[ty * W2 + tx] = g; // 含 0（沙）
        else if (g) putTile(ln, tx, ty, g);
      }
    }
  }
}
console.log('沙底/草皮(值噪声)/接缝镜像 完成');
// 2) 每户门位（门永远朝村庄方向；出生点/石板/支路共用同一门位）
const DOORS = HOUSES.map(h => {
  const r = { x: h.dst.x, y: h.dst.y, w: h.srcRect.w, h: h.srcRect.h };
  const midX = r.x + Math.floor(r.w / 2), midY = r.y + Math.floor(r.h / 2);
  if (midX >= LEFT + W) return { id: h.id, x: r.x - 2, y: midY, band: 'E' };
  if (midX < LEFT) return { id: h.id, x: r.x + r.w + 2, y: midY, band: 'W' };
  if (midY < TOP) return { id: h.id, x: midX, y: r.y + r.h + 1, band: 'N' };
  return { id: h.id, x: midX, y: r.y - 1, band: 'S' };
});
// 3) 四条主路：轴线与原版村中石板广场对齐（竖 x39-41 接广场竖带，横 y49-51 接广场横带；
//    原版广场随整体平移到 (LEFT,TOP)，故轴线 = LEFT+39..41 / TOP+49..51）
const GX0 = LEFT + 39, GX1 = LEFT + 41, GY0 = TOP + 49, GY1 = TOP + 51;
const GATES = [
  { x0: GX0, x1: GX1, y0: 0, y1: TOP - 1, band: 'N' },
  { x0: GX0, x1: GX1, y0: TOP + H, y1: H2 - 1, band: 'S' },
  { y0: GY0, y1: GY1, x0: 0, x1: LEFT - 1, band: 'W' },
  { y0: GY0, y1: GY1, x0: LEFT + W, x1: W2 - 1, band: 'E' },
];
for (const g of GATES) for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) carve(x, y);
// 3.5) 外圈栅栏环：连续围栏（原版栅栏 gid 102/103 交替），只留 4 个门路缺口。
//     连续环 = 可见的边界（消灭"草地尽头空气墙"观感），也避免稀疏木桩的"零碎"感。
const inGateCell = (x, y) => GATES.some(g => x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1);
const FENCE_RING = [102, 103];
for (let i = 0; i < W2; i++) {
  for (const y of [0, 1, H2 - 2, H2 - 1]) {
    if (!inGateCell(i, y)) putTile('mulan', i, y, FENCE_RING[(i + y) & 1]);
  }
}
for (let j = 0; j < H2; j++) {
  for (const x of [0, 1, W2 - 2, W2 - 1]) {
    if (!inGateCell(x, j)) putTile('mulan', x, j, FENCE_RING[(x + j) & 1]);
  }
}
let ringCnt = 0;
for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
  if ((x < 2 || y < 2 || x >= W2 - 2 || y >= H2 - 2) && getTile('mulan', x, y)) ringCnt++;
}
console.log('外圈栅栏环:', ringCnt, '格');
// 4) 支路：门 → 本带主路（3 格宽，与主路一致；避开贴缝长走廊）
for (const d of DOORS) {
  if (d.band === 'N' || d.band === 'S') {
    const xA = Math.min(d.x + 1, GX1 + 1), xB = Math.max(d.x - 1, GX0 - 1);
    for (let x = xA; x <= xB; x++) for (let y = d.y - 1; y <= d.y + 1; y++) carve(x, y);
  } else {
    const yA = Math.min(d.y + 1, GY1 + 1), yB = Math.max(d.y - 1, GY0 - 1);
    for (let y = yA; y <= yB; y++) for (let x = d.x - 1; x <= d.x + 1; x++) carve(x, y);
  }
}
console.log('主路/支路已铺设:', DOORS.map(d => `#${d.id}@(${d.x},${d.y})`).join(' '));
// 4.5) 支路与主路交汇处扩 3x3 沙地（路口小广场，增强扩展区规划感）
for (const d of DOORS) {
  const g = GATES.find(gg => gg.band === d.band);
  if (!g) continue;
  const px = (d.band === 'N' || d.band === 'S') ? g.x0 - 1 : d.x;
  const py = (d.band === 'N' || d.band === 'S') ? d.y : g.y0 - 1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = px + dx, y = py + dy;
      if (!inExp(x, y)) continue;
      if (HOUSES.some(h => x >= h.dst.x && x < h.dst.x + h.srcRect.w && y >= h.dst.y && y < h.dst.y + h.srcRect.h)) continue;
      carve(x, y);
    }
  }
}
// 5) 门前石板台阶（2x2 门垫，gid 847-848/850-851 与原版广场竖带同款，下垫沙底）
for (const d of DOORS) {
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const x = d.x + dx, y = d.y + dy;
      if (!inExp(x, y)) continue;
      if (HOUSES.some(h => x >= h.dst.x && x < h.dst.x + h.srcRect.w && y >= h.dst.y && y < h.dst.y + h.srcRect.h)) continue;
      carve(x, y);
      putTile('shilu', x, y, 847 + dy * 3 + dx);
    }
  }
}
// 6) 道路边缘碎化（dither）：沙/草边界 55% 互渗 → 自然侵蚀边缘，替代成排的 byuand 过渡块
//    沙变草需 ≥2 个草邻居（只碎边缘，保护道路连通）；草变沙需贴沙。
const isSandTile = (x, y) => x >= 0 && y >= 0 && x < W2 && y < H2 && getTile('caodi', x, y) === 0;
const isGrassTile = (x, y) => x >= 0 && y >= 0 && x < W2 && y < H2 && GRASS_GIDS.includes(getTile('caodi', x, y));
const hasShilu = (x, y) => x >= 0 && y >= 0 && x < W2 && y < H2 && getTile('shilu', x, y) !== 0;
const nearShilu = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (hasShilu(x + dx, y + dy)) return true; return false; };
const nearMapEdge = (x, y) => x <= 2 || y <= 2 || x >= W2 - 3 || y >= H2 - 3;
const inGate = (x, y) => GATES.some(g => x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1);
const touchOrig = (x, y) => [1, -1, 0, 0].some((dx, i) => inOrigCell(x + dx, y + [0, 0, 1, -1][i]));
for (let y = 0; y < H2; y++) {
  for (let x = 0; x < W2; x++) {
    if (!inExp(x, y) || touchOrig(x, y) || hasShilu(x, y)) continue;
    const g = getTile('caodi', x, y);
    let nSand = 0, nGrass = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (isSandTile(x + dx, y + dy)) nSand++;
      if (isGrassTile(x + dx, y + dy)) nGrass++;
    }
    if (g === 0 && nGrass >= 2 && !nearMapEdge(x, y) && rnd() < 0.55) get('caodi')[y * W2 + x] = grassGid(x, y); // 沙边碎化（地图边缘格保留，门路出口必须贯通）
    else if (g === 0 && nGrass <= 1 && inGate(x, y) && !nearShilu(x, y) && !nearMapEdge(x, y) && rnd() < 0.12) get('caodi')[y * W2 + x] = grassGid(x, y); // 主路内部混草（土路质感）
    else if (g > 0 && nSand >= 1 && rnd() < 0.5) get('caodi')[y * W2 + x] = 0;             // 草边露沙
  }
}
// 6.5) 道路边缘过渡块（原版路缘风格）：与"路身沙格"相邻的草格按 70% 概率换成过渡块（gid 100+翻转），
//      点状不成排 → 既有原版的柔和渐变观感，又不会形成"亮线"。
//      翻转规律（原版，与口嘴一致）：沙在草 N→3、S→4、W→0、E→5 —— 见 lib/grass-fringe.mjs
const sandBody = (x, y) => { // 沙格 ≥2 个沙邻居 = 路身（过滤 dither 单粒沙）
  let n = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isSandTile(x + dx, y + dy)) n++;
  return n >= 2;
};
for (let y = 0; y < H2; y++) {
  for (let x = 0; x < W2; x++) {
    if (!inExp(x, y) || !GRASS_GIDS.includes(getTile('caodi', x, y))) continue;
    const inMB = (x, y) => (x >= LEFT - 2 && x < LEFT) || (x >= LEFT + W && x < LEFT + W + 2) ||
                           (y >= TOP - 2 && y < TOP) || (y >= TOP + H && y < TOP + H + 2);
    if (touchOrig(x, y) || inMB(x, y) || nearMapEdge(x, y)) continue; // 接缝/边缘交给口嘴与环带
    // 草格的沙邻居（必须是路身）
    let d = null;
    if (sandBody(x, y - 1)) d = 'N';      // 沙在北
    else if (sandBody(x, y + 1)) d = 'S'; // 沙在南
    else if (sandBody(x + 1, y)) d = 'E'; // 沙在东
    else if (sandBody(x - 1, y)) d = 'W'; // 沙在西
    if (!d || rnd() >= 0.7) continue;
    get('caodi')[y * W2 + x] = fringeGid(d);
  }
}

// 6.6) 水塘沙岸：水格 4 邻的草格 → 沙（水塘轮廓清晰可见，不再"埋在草地看不出"）
{
  let shore = 0;
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      if (getTile('shuich', x, y)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (getTile('shuich', x + dx, y + dy) && GRASS_GIDS.includes(getTile('caodi', x, y))) {
          get('caodi')[y * W2 + x] = 0;
          shore++;
          break;
        }
      }
    }
  }
  console.log('水塘沙岸:', shore, '格');
}

const FLIP = EDGE_FLIP; // 沙在 N→V|D, S→H, W→无, E→H|D（共享同一张翻转表，消除副本）
const inMirrorBand = (x, y) => (x >= LEFT - 2 && x < LEFT) || (x >= LEFT + W && x < LEFT + W + 2) ||
                               (y >= TOP - 2 && y < TOP) || (y >= TOP + H && y < TOP + H + 2);
for (let y = 0; y < H2; y++) {
  for (let x = 0; x < W2; x++) {
    if (!inExp(x, y) || getTile('caodi', x, y) !== 0) continue;
    if (!inGate(x, y) && !inMirrorBand(x, y)) continue;
    for (const [dx, dy, d] of [[0, -1, 'S'], [0, 1, 'N'], [-1, 0, 'E'], [1, 0, 'W']]) {
      const ox = x + dx, oy = y + dy;
      if (!inOrigCell(ox, oy)) continue;
      const g = getTile('caodi', ox, oy);
      if (GRASS_GIDS.includes(g)) get('caodi')[oy * W2 + ox] = fringeGid(d);
    }
  }
}
// 7.5) 反向路嘴：扩展区草格贴原版沙格时，草格换成过渡块（原版边缘沙斑，量极小）
for (let y = 0; y < H2; y++) {
  for (let x = 0; x < W2; x++) {
    if (!inExp(x, y)) continue;
    const g = getTile('caodi', x, y);
    if (!GRASS_GIDS.includes(g)) continue;
    for (const [dx, dy, d] of [[0, -1, 'N'], [0, 1, 'S'], [-1, 0, 'W'], [1, 0, 'E']]) {
      const ox = x + dx, oy = y + dy;
      if (!inOrigCell(ox, oy)) continue;
      if (getTile('caodi', ox, oy) === 0) { get('caodi')[y * W2 + x] = fringeGid(d); break; }
    }
  }
}
// 8.5) 田野草垛：原版草垛是完整素材单位（2x3: gid 340-345 三行两列；3x2: gid 346-347 两行三列），
//      单格撒会"半截悬空"。按原版排列成组撒到扩展区田野（离路/房/贴缝/外圈 ≥2 格，间隔 ≥5 格）
const HAY_2x3 = [[340, 341], [342, 343], [344, 345]]; // y 向下：三行两列
const HAY_3x2 = [346, 347];                            // y 向下：两行三列
const grassCell = (x, y) => x >= 0 && y >= 0 && x < W2 && y < H2 && GRASS_GIDS.includes(getTile('caodi', x, y));
const placedHay = [];
function placeHayUnit(rows, x, y) {
  for (let dy = 0; dy < rows.length; dy++) {
    for (let dx = 0; dx < rows[dy].length; dx++) {
      putTile('caodui', x + dx, y + dy, rows[dy][dx]);
    }
  }
  placedHay.push({ x, y, w: rows[0].length, h: rows.length });
}
let hayCount = 0;
const HAY_TRIES = 60;
const hayNearBad = (x, y, w, h) => {
  for (let dy = -2; dy < h + 2; dy++) {
    for (let dx = -2; dx < w + 2; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!grassCell(tx, ty)) return true;             // 地面必须连续是草
      if (tx <= 2 || ty <= 2 || tx >= W2 - 3 || ty >= H2 - 3) return true; // 外圈栅栏带
      if (inMirrorBand(tx, ty)) return true;           // 贴缝带
      if (HOUSES.some(hs => tx >= hs.dst.x - 2 && tx < hs.dst.x + hs.srcRect.w + 2 && ty >= hs.dst.y - 2 && ty < hs.dst.y + hs.srcRect.h + 2)) return true; // 房子周围
    }
  }
  for (const p of placedHay) {
    if (Math.abs(p.x - x) < 5 && Math.abs(p.y - y) < 5) return true; // 组间间距
  }
  return false;
};
for (const [w, h, rows] of [
  [2, 3, HAY_2x3], [2, 3, HAY_2x3], [2, 3, HAY_2x3], [2, 3, HAY_2x3],
  [2, 3, HAY_2x3], [2, 3, HAY_2x3], [2, 3, HAY_2x3], [2, 3, HAY_2x3],
  [2, 3, HAY_2x3], [2, 3, HAY_2x3],
  [3, 2, [HAY_3x2, HAY_3x2]], [3, 2, [HAY_3x2, HAY_3x2]],
  [3, 2, [HAY_3x2, HAY_3x2]], [3, 2, [HAY_3x2, HAY_3x2]],
]) {
  let placed = false;
  for (let t = 0; t < HAY_TRIES && !placed; t++) {
    const x = Math.floor(rnd() * (W2 - w - 6)) + 3;
    const y = Math.floor(rnd() * (H2 - h - 6)) + 3;
    if (hayNearBad(x, y, w, h)) continue;
    placeHayUnit(rows, x, y);
    placed = true;
    hayCount++;
    break;
  }
}
console.log('田野草垛组:', hayCount, '处');
// 8.55) 扩展区装饰层：花丛(caoduo1/caoduo2)、小草堆(caodui)、灌木 —— 打破大面积草地的单调感
//   原版装饰素材 gid: caoduo1 花丛 200-210, caoduo2 灌木 220-230, caodui 小草堆 340-347
//   策略：在空旷草地（离路/房/栅栏≥3格）随机撒点，密度约 1/15 格
const DECO_GIDS = {
  caoduo1: [200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210],
  caoduo2: [220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230],
};
let decoCount = 0;
for (let y = 0; y < H2; y++) {
  for (let x = 0; x < W2; x++) {
    if (!inExp(x, y)) continue;
    if (!grassCell(x, y)) continue;
    // 离路/房/栅栏/外圈/接缝≥3格
    let tooClose = false;
    for (let dy = -3; dy <= 3 && !tooClose; dy++) {
      for (let dx = -3; dx <= 3 && !tooClose; dx++) {
        const tx = x + dx, ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= W2 || ty >= H2) { tooClose = true; break; }
        if (hasShilu(tx, ty)) tooClose = true;
        if (fenceG(tx, ty)) tooClose = true;
        if (HOUSES.some(h => tx >= h.dst.x - 2 && tx < h.dst.x + h.srcRect.w + 2 && ty >= h.dst.y - 2 && ty < h.dst.y + h.srcRect.h + 2)) tooClose = true;
      }
    }
    if (tooClose) continue;
    // 撒点概率
    const h = hash2(x + 100, y + 100);
    if (h > 0.07) continue; // 约 7% 的空旷草地放装饰
    // 选择装饰类型
    const layerName = h < 0.035 ? 'caoduo1' : 'caoduo2';
    const gids = DECO_GIDS[layerName];
    const gid = gids[Math.floor(h * 1000) % gids.length];
    putTile(layerName, x, y, gid);
    decoCount++;
  }
}
console.log('扩展区装饰:', decoCount, '格');
// 8.6) 清理孤立栅栏：扩展区中 4 邻无任何栅栏的单格栅栏移除（"零碎栅栏"观感来源；成串的保留）
{
  const fenceG = (x, y) => x >= 0 && y >= 0 && x < W2 && y < H2 && (getTile('mulan', x, y) || getTile('mulan2', x, y));
  let removed = 0;
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      if (!inExp(x, y) || !fenceG(x, y)) continue;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => fenceG(x + dx, y + dy)).length;
      if (nb === 0) {
        for (const f of FENCE_LAYERS) { const L = get(f); if (L) L[y * W2 + x] = 0; }
        removed++;
      }
    }
  }
  console.log('孤立栅栏清理:', removed, '格');
}

// ---------- 复制房型块（所有层同一矩形，排除水面/特殊层） ----------
const COPY_LAYERS = new Set(['fanzi', 'mulan', 'mulan2', 'mulan3', 'mulan4', 'caoduo1', 'caoduo2', 'caodui']);
for (const h of HOUSES) {
  const { x: sx, y: sy, w, h: sh } = h.srcRect;
  for (const L of layers) {
    if (!COPY_LAYERS.has(L.name)) continue;
    for (let dy = 0; dy < sh; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const g = L.data[(sy + dy) * W + (sx + dx)];
        if (g) putTile(L.name, h.dst.x + dx, h.dst.y + dy, g);
      }
    }
  }
  console.log(`已复制 ${h.type} -> (${h.dst.x},${h.dst.y})`);
}

// ---------- 写回 tmxXmlStr ----------
function buildXml() {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\r\n<map version="1.8" tiledversion="1.8.4" orientation="orthogonal" renderorder="right-down" width="${W2}" height="${H2}" tilewidth="${TW}" tileheight="${TH}" infinite="0" nextlayerid="18" nextobjectid="1">\r\n`;
  // tileset 部分原样保留
  const tsPart = tmxXml.match(/<map[^>]*>([\s\S]*?)<layer/)[1];
  xml += tsPart;
  // 层：按原顺序重建
  const origLayerOrder = [];
  for (const lt of tmxXml.match(layerRe) || []) {
    const la = parseAttrs(lt.match(/<layer[^>]*>/)[0]);
    origLayerOrder.push(la.name);
  }
  let layerId = 1;
  for (const name of origLayerOrder) {
    const L = newLayers.find(l => l.name === name);
    if (!L) continue;
    const b64 = encodeLayerData(L.data);
    xml += ` <layer id="${layerId}" name="${name}" width="${W2}" height="${H2}">\r\n`;
    xml += `  <data encoding="base64" compression="zlib">\r\n${b64}\r\n  </data>\r\n </layer>\r\n`;
    layerId++;
  }
  xml += '</map>';
  return xml;
}
const newXml = buildXml();

// 写回 import json：把 tmx 值替换（保留两端引号，只替换引号间内容）
const newRawStr = rawStr.slice(0, valStart + 1) + JSON.stringify(newXml).slice(1, -1) + rawStr.slice(valEnd);
writeFileSync(VILLAGE_JSON, encryptBuf(Buffer.from(newRawStr, 'utf8')));
console.log('已写回地图 json(加密):', VILLAGE_JSON);

// ---------- 扩展 plant json ----------
const plantDeep = readAsset(PLANT_SOURCE);
let plantTarget = null;
const findPlantTarget = (node) => {
  if (Array.isArray(node)) { for (const n of node) findPlantTarget(n); return; }
  if (node && typeof node === 'object') {
    if (typeof node.mapWidth === 'number' && Array.isArray(node.plantSoils)) { plantTarget = node; return; }
    for (const v of Object.values(node)) findPlantTarget(v);
  }
};
findPlantTarget(plantDeep);
if (!plantTarget) throw new Error('plant target not found');
const pw = plantTarget.mapWidth, ph = plantTarget.mapHeight;
console.log(`plant ${pw}x${ph} -> ${W2}x${H2}`);
const expandArr = (arr) => {
  const nd = new Array(W2 * H2).fill(0);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) nd[(y + TOP) * W2 + (x + LEFT)] = arr[y * pw + x] || 0;
  }
  return nd;
};
const newSoils = expandArr(plantTarget.plantSoils);
const newNoneSoils = expandArr(plantTarget.noneSoils);
// 宅基地内可种地（房子外圈 2 格田）
for (const h of HOUSES) {
  for (let dy = 0; dy < h.srcRect.h + 4; dy++) {
    for (let dx = 0; dx < h.srcRect.w + 4; dx++) {
      const x = h.dst.x - 2 + dx, y = h.dst.y - 2 + dy;
      if (x < 0 || y < 0 || x >= W2 || y >= H2) continue;
      const inHouse = dx >= 2 && dx < 2 + h.srcRect.w && dy >= 2 && dy < 2 + h.srcRect.h;
      if (!inHouse) newSoils[y * W2 + x] = 1;
    }
  }
}
plantTarget.mapWidth = W2; plantTarget.mapHeight = H2;
plantTarget.plantSoils = newSoils; plantTarget.noneSoils = newNoneSoils;
writeAsset(PLANT_JSON, plantDeep);
console.log('已写回 plant json(加密):', PLANT_JSON);

// ---------- 出生点表 ----------
const spawns = { scene: 2, houses: [], trees: [] }; // 扩展区无树（村 tileset 无树，shuic 是水面）
for (const d of DOORS) {
  const h = HOUSES.find(x => x.id === d.id);
  spawns.houses.push({
    id: h.id,
    type: h.type,
    rect: { x: h.dst.x, y: h.dst.y, w: h.srcRect.w, h: h.srcRect.h },
    door: { x: d.x * 100, y: d.y * 100 },
    treeRing: { x: h.dst.x - 1, y: h.dst.y - 1, w: h.srcRect.w + 2, h: h.srcRect.h + 2 },
  });
  console.log(`宅基地#${h.id} ${h.type} door=(${d.x},${d.y})`);
}
mkdirSync(dirname(SPAWN_OUT), { recursive: true });
writeFileSync(SPAWN_OUT, JSON.stringify(spawns, null, 1), 'utf8');
console.log('出生点表:', SPAWN_OUT);
console.log('完成');
