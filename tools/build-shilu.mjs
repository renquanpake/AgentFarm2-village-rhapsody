// build-shilu.mjs —— 从村地图 tmx 提取石板路（shilu）层掩码 → data/village-shilu.json
// 与 build-collision.mjs 同源（同一加密资源、同一解法）；市政规划书 roads-landmarks §2.1：
//   村景老区路数据 = shilu 层提取（服务端 kind=4 双源一致性档的参照源）
// 输出：{ width, height, shilu: [0/1...] }（行主序；1 = shilu 层该格有石板 tile）
// 用法：node tools/build-shilu.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(__dirname, '..', 'client', 'assets', 'resources', 'import');
const VILLAGE_JSON = join(CLIENT, 'eb', 'eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const OUT = join(__dirname, '..', 'data', 'village-shilu.json');

// 解密 client 资源（与 build-collision 相同约定）
const KEY = Buffer.from('qingyoo0316', 'utf8');
function decrypt(buf) {
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return out;
}
const raw = JSON.parse(decrypt(readFileSync(VILLAGE_JSON)).toString('utf8'));
const s = JSON.stringify(raw);
const ni = s.indexOf('"daditu"');
if (ni < 0) throw new Error('daditu asset not found');
let i = ni + 8;
while (s[i] !== '"') i++;
let j = i + 1;
while (j < s.length) {
  if (s[j] === '\\') { j += 2; continue; }
  if (s[j] === '"') break;
  j++;
}
const xml = JSON.parse(s.slice(i, j + 1));
const W = +xml.match(/width="(\d+)"/)[1], H = +xml.match(/height="(\d+)"/)[1];

// 提取 shilu 层（base64+zlib；gid 非 0 = 有石板）
const layerRe = /<layer\b[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g;
let shilu = null;
for (const m of xml.matchAll(layerRe)) {
  if (m[1] !== 'shilu') continue;
  const b64 = m[2].replace(/\s/g, '');
  const arr = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(b64, 'base64')).buffer));
  shilu = arr.map(v => (v & 0x0fffffff) ? 1 : 0);
  break;
}
if (!shilu) throw new Error('shilu 层缺失（村地图无石板层？）');
if (shilu.length !== W * H) throw new Error(`shilu 层长度 ${shilu.length} != ${W}x${H}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ width: W, height: H, shilu }));
const cnt = shilu.filter(Boolean).length;
console.log(`shilu 提取：${W}x${H}，石板格 ${cnt}（${(cnt / shilu.length * 100).toFixed(2)}%）-> ${OUT}`);
