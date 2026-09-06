// build-farmgrid.mjs —— 从村地图加密资源提取"水网格 + 可种土网格" → data/village-farm.json
// 服务器用：fish 判定水边 / plant 判定可种格（村地图 77x61 原版可种土，扩展 14 格后世界坐标映射）
// 输入：
//   client/assets/resources/import/eb/eb97a692...json   —— 村地图 tmx（105x89，含 shuich 水面层）
//   client/assets/resources/import/2c/2cf76085...json   —— dadituMapPlant（77x61 plantSoils 网格）
// 输出：
//   { waterW, waterH, water:[0/1], soilW, soilH, plantSoils:[0/1], LEFT, TOP }
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(__dirname, '..', 'client', 'assets', 'resources', 'import');
const VILLAGE_JSON = join(CLIENT, 'eb', 'eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const PLANT_JSON = join(CLIENT, '2c', '2cf76085-68a7-4e68-9e2d-e98eff639571.25ea3.json');
const OUT = join(__dirname, '..', 'data', 'village-farm.json');
const LEFT = 14, TOP = 14; // 扩展边距（与 expand-village-map.mjs 一致）

const KEY = Buffer.from('qingyoo0316', 'utf8');
function decrypt(buf) {
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return out;
}

// ---- 1. 水面网格（从 tmx shuich 层） ----
const raw = JSON.parse(decrypt(readFileSync(VILLAGE_JSON)).toString('utf8'));
const s = JSON.stringify(raw);
const ni = s.indexOf('"daditu"');
let i = ni + 8; while (s[i] !== '"') i++;
let j = i + 1; while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === '"') break; j++; }
const xml = JSON.parse(s.slice(i, j + 1));
const W = +xml.match(/width="(\d+)"/)[1], H = +xml.match(/height="(\d+)"/)[1];
const layerRe = /<layer\b[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g;
const layers = {};
for (const m of xml.matchAll(layerRe)) {
  const b64 = m[2].replace(/\s/g, '');
  const arr = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(b64, 'base64')).buffer));
  layers[m[1]] = arr;
}
console.log('tmx 图层:', Object.keys(layers).join(', '));
const water = new Array(W * H).fill(0);
if (layers.shuich) for (let idx = 0; idx < W * H; idx++) if (layers.shuich[idx]) water[idx] = 1;

// ---- 2. 可种土网格（dadituMapPlant.plantSoils，77x61） ----
const praw = JSON.parse(decrypt(readFileSync(PLANT_JSON)).toString('utf8'));
const pc = praw[5]?.[0]?.[2];
if (!pc || !pc.plantSoils) throw new Error('无法解析 dadituMapPlant.plantSoils');
const SW = +pc.mapWidth, SH = +pc.mapHeight;
const plantSoils = pc.plantSoils.map(v => (v ? 1 : 0));
console.log(`可种土网格 ${SW}x${SH}，可种格 ${plantSoils.filter(Boolean).length}`);

// ---- 3. 输出 ----
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ waterW: W, waterH: H, water, soilW: SW, soilH: SH, plantSoils, LEFT, TOP }));
const wc = water.filter(Boolean).length;
console.log(`水面网格 ${W}x${H}，水格 ${wc}；已写入 ${OUT}`);

// ---- 4. 自检：列几个候选坐标（水边可达格 / 农田可种格） ----
function waterAt(wx, wy) { if (wx < 0 || wy < 0 || wx >= W || wy >= H) return false; return water[wy * W + wx] === 1; }
function soilAt(sx, sy) { if (sx < 0 || sy < 0 || sx >= SW || sy >= SH) return false; return plantSoils[sy * SW + sx] === 1; }
// 农田 plot (13-15,15-16) 在世界扩展网格上的可种性
for (const [gx, gy] of [[13, 15], [14, 15], [15, 15], [13, 16], [14, 16], [15, 16]]) {
  console.log(`农田格 world(${gx},${gy}) soil=${soilAt(gx - LEFT, gy - TOP)}`);
}
// 水边可达候选（水格旁 4 邻域非水格，输出前 6 个）
const shore = [];
for (let gy = 1; gy < H - 1 && shore.length < 6; gy++) {
  for (let gx = 1; gx < W - 1; gx++) {
    if (waterAt(gx, gy)) continue;
    const nb = waterAt(gx + 1, gy) || waterAt(gx - 1, gy) || waterAt(gx, gy + 1) || waterAt(gx, gy - 1);
    if (nb) { shore.push({ gx, gy, px: gx * 100 + 50, py: gy * 100 + 50 }); }
  }
}
console.log('水边可达候选（前 6）:', JSON.stringify(shore.slice(0, 6)));
