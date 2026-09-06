// _inspect-map.mjs —— 检查当前生成地图：栅栏/门路冲突、shuich 与水网格一致性、nerver 层
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const KEY = Buffer.from('qingyoo0316', 'utf8');
function decryptBuf(buf) {
  if (buf.length < KEY.length) return buf;
  let signed = true;
  for (let i = 0; i < KEY.length; i++) if (buf[i] !== KEY[i]) { signed = false; break; }
  if (!signed) return buf;
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return out;
}
function getTmx(p) {
  const raw = JSON.parse(decryptBuf(readFileSync(p)).toString('utf8'));
  const s = JSON.stringify(raw);
  const ni = s.indexOf('"daditu"');
  let i = ni + 8; while (s[i] !== '"') i++;
  let j = i + 1; while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === '"') break; j++; }
  return JSON.parse(s.slice(i, j + 1));
}
const xml = getTmx('client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const W = +xml.match(/width="(\d+)"/)[1], H = +xml.match(/height="(\d+)"/)[1];
console.log(`当前地图 ${W}x${H}`);
const layerRe = /<layer\b[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g;
const layers = {};
for (const m of xml.matchAll(layerRe)) {
  const b64 = m[2].replace(/\s/g, '');
  const arr = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(b64, 'base64')).buffer));
  // 去翻转位，取低 28 位 gid
  layers[m[1]] = arr.map(v => v & 0x0fffffff);
}
const cnt = (name) => layers[name] ? layers[name].filter(Boolean).length : -1;
console.log('层统计:', Object.keys(layers).map(l => `${l}=${cnt(l)}`).join(' '));
// 栅栏格与沙/石路重叠？
let fenceOnRoad = 0, fenceNearRoad = 0, totalFence = 0;
const fenceLayers = ['mulan', 'mulan2'];
const sandOrShilu = (x, y) => y >= 0 && y < H && x >= 0 && x < W && (layers.caodi[y * W + x] === 0 || layers.shilu[y * W + x] !== 0);
for (const fn of fenceLayers) {
  const L = layers[fn]; if (!L) continue;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!L[y * W + x]) continue;
    totalFence++;
    if (sandOrShilu(x, y)) fenceOnRoad++;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) { if (sandOrShilu(x + dx, y + dy)) { fenceNearRoad++; dx = 9; break; } }
    }
  }
}
console.log(`栅栏总数=${totalFence} 在沙/石路上=${fenceOnRoad} 邻沙/石路=${fenceNearRoad}`);
// 栅栏在门路(主路 gate 列/行)上？
const inGate = (x, y) => (x >= 39 && x <= 41) || (y >= 49 && y <= 51);
let fenceInGate = 0;
for (const fn of fenceLayers) {
  const L = layers[fn]; if (!L) continue;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (L[y * W + x] && inGate(x, y)) { fenceInGate++; }
}
console.log('栅栏在门路轴线上:', fenceInGate);
// shuich vs farm json
const farm = JSON.parse(readFileSync('data/village-farm.json', 'utf8'));
const sw = layers.shuich.filter(Boolean).length;
console.log(`shuich 格=${sw}  farm.water 格=${farm.water.filter(Boolean).length}`);
// 镜像带栅栏（贴缝 2 格带）
let mirrorFence = 0;
const inMirror = (x, y) => (x >= 12 && x < 14) || (x >= 91 && x < 93) || (y >= 12 && y < 14) || (y >= 75 && y < 77);
for (const fn of fenceLayers) {
  const L = layers[fn]; if (!L) continue;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (L[y * W + x] && inMirror(x, y)) mirrorFence++;
}
console.log('镜像带栅栏:', mirrorFence);
// nerver 层内容
if (layers.nerver) {
  const nv = layers.nerver;
  const gids = {};
  for (const v of nv) if (v) gids[v] = (gids[v] || 0) + 1;
  console.log('nerver 层 gid:', JSON.stringify(gids));
}
