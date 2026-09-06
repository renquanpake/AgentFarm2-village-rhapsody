// _sample-grass.mjs —— 从截图采样草地相邻格颜色，确认 gid 色差与"棋盘格"成因
// 截图 center @ 3900,8600：相机中心在玩家位置，1 格=100 世界单位；屏幕 1440x900
// 估算：视野宽度 ≈ 设计分辨率 1920*zoom？用相对采样：在画面中央偏下区域取一排像素
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// 用纯 node 解析 PNG 太麻烦——直接用 PowerShell 方式不行；改从地图数据统计 gid 分布
// 从 tmx 统计草地 gid 5-8 的相邻分布：相邻格 gid 不同的比例（"棋盘格"指标）
import zlib from 'node:zlib';
const K = Buffer.from('qingyoo0316', 'utf8');
function dec(p) {
  const b = readFileSync(p);
  const o = Buffer.allocUnsafe(b.length - K.length);
  for (let i = 0; i < o.length; i++) o[i] = b[K.length + i] ^ K[i % K.length];
  return JSON.parse(o.toString('utf8'));
}
function loadMap(p) {
  const s = JSON.stringify(dec(p));
  let i = s.indexOf('"daditu"') + 8; while (s[i] !== '"') i++;
  let j = ++i; while (j < s.length) { if (s[j] === '\\') j += 2; else if (s[j++] === '"') break; }
  const xml = JSON.parse(s.slice(i - 1, j));
  const layers = {};
  for (const m of xml.matchAll(/<layer[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g))
    layers[m[1]] = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer)).map(v => v & 0x0fffffff);
  return { W: +xml.match(/width="(\d+)"/)[1], H: +xml.match(/height="(\d+)"/)[1], layers };
}
const M = loadMap('client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const { W, H } = M;
const cd = M.layers.caodi;
const GRASS = [5, 6, 7, 8];
// 统计扩展区草地内：水平相邻 gid 变化率（棋盘格感指标）
let pairs = 0, diff = 0;
for (let y = 28; y < H - 28; y++) {
  for (let x = 28; x < W - 28; x++) {
    const g = cd[y * W + x];
    if (!GRASS.includes(g)) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const gn = cd[(y + dy) * W + x + dx];
      if (!GRASS.includes(gn)) continue;
      pairs++;
      if (gn !== g) diff++;
    }
  }
}
console.log(`扩展区草地相邻格 gid 变化率: ${(diff / pairs * 100).toFixed(1)}% (${diff}/${pairs})`);
// 原版对比
const O = loadMap('_backup/daditu-tmx.json.bak');
const cdO = O.layers.caodi;
let pairsO = 0, diffO = 0;
for (let y = 0; y < O.H; y++) {
  for (let x = 0; x < O.W; x++) {
    const g = cdO[y * O.W + x];
    if (!GRASS.includes(g)) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const gn = cdO[(y + dy) * O.W + x + dx];
      if (!GRASS.includes(gn)) continue;
      pairsO++;
      if (gn !== g) diffO++;
    }
  }
}
console.log(`原版草地相邻格 gid 变化率: ${(diffO / pairsO * 100).toFixed(1)}% (${diffO}/${pairsO})`);
