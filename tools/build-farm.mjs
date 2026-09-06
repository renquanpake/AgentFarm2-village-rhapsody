// build-farm.mjs —— 从最终 tmx + plant json 生成 data/village-farm.json
// （服务器水网格/农田网格的唯一真源：water 取自 shuich 层，与客户端地图完全一致）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(__dirname, '..', 'client', 'assets', 'resources', 'import');
const VILLAGE_JSON = join(CLIENT, 'eb', 'eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const PLANT_JSON = join(CLIENT, '2c', '2cf76085-68a7-4e68-9e2d-e98eff639571.25ea3.json');
const OUT = join(__dirname, '..', 'data', 'village-farm.json');
const ORIG_W = 77, ORIG_H = 61;

const KEY = Buffer.from('qingyoo0316', 'utf8');
function decrypt(buf) {
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return out;
}
function readAsset(p) { return JSON.parse(decrypt(readFileSync(p)).toString('utf8')); }

const raw = readAsset(VILLAGE_JSON);
const s = JSON.stringify(raw);
const ni = s.indexOf('"daditu"');
let i = ni + 8; while (s[i] !== '"') i++;
let j = i + 1; while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === '"') break; j++; }
const xml = JSON.parse(s.slice(i, j + 1));
const W = +xml.match(/width="(\d+)"/)[1], H = +xml.match(/height="(\d+)"/)[1];
const LEFT = Math.round((W - ORIG_W) / 2), TOP = Math.round((H - ORIG_H) / 2);
console.log(`地图 ${W}x${H} LEFT=${LEFT} TOP=${TOP}`);

const layerRe = /<layer\b[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g;
const layers = {};
for (const m of xml.matchAll(layerRe)) {
  const b64 = m[2].replace(/\s/g, '');
  layers[m[1]] = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(b64, 'base64')).buffer)).map(v => (v & 0x0fffffff) ? 1 : 0);
}
const water = layers.shuich || new Array(W * H).fill(0);
const wcnt = water.filter(Boolean).length;
console.log(`水面(shuich) ${wcnt} 格`);

// plant json（生成器已扩展）：plantSoils / noneSoils
const plantDeep = readAsset(PLANT_JSON);
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
if (plantTarget.mapWidth !== W || plantTarget.mapHeight !== H) throw new Error(`plant 尺寸 ${plantTarget.mapWidth}x${plantTarget.mapHeight} 与地图不一致`);
console.log(`plantSoils ${plantTarget.plantSoils.filter(Boolean).length} 格`);

writeFileSync(OUT, JSON.stringify({
  LEFT, TOP,
  waterW: W, waterH: H, water,
  soilW: W, soilH: H,
  plantSoils: plantTarget.plantSoils,
}));
console.log('已写入', OUT);
