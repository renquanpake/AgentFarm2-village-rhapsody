// _audit-viz.mjs —— 地图视觉审计：gid 直方图 / 单色连续块 / 接缝硬边（对比原版）
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const KEY = Buffer.from('qingyoo0316');
const dec = p => { const b = readFileSync(p), o = Buffer.allocUnsafe(b.length - KEY.length); for (let i = 0; i < o.length; i++) o[i] = b[i + KEY.length] ^ KEY[i % KEY.length]; return JSON.parse(o.toString()); };
function loadMap(p) {
  const s = JSON.stringify(dec(p));
  let i = s.indexOf('"daditu"') + 8; while (s[i] !== '"') i++;
  let j = ++i; while (j < s.length) { if (s[j] === '\\') j += 2; else if (s[j++] === '"') break; }
  const xml = JSON.parse(s.slice(i - 1, j));
  const layers = [];
  for (const m of xml.matchAll(/<layer[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g))
    layers.push({ name: m[1], data: Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer)) });
  return { W: +xml.match(/width="(\d+)"/)[1], H: +xml.match(/height="(\d+)"/)[1], layers };
}
const top = (a, n = 8) => {
  const c = new Map(); for (const v of a) if (v) c.set(v, (c.get(v) || 0) + 1);
  return [...c.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([g, n]) => `${g}x${n}`).join(' ');
};
const SAND = [1, 2, 3, 4], GRASS = [5, 6, 7, 8], TRANS = [99, 100, 101], ROAD = Array.from({ length: 57 }, (_, i) => 847 + i);
const cls = g => SAND.includes(g) ? 'S' : GRASS.includes(g) ? 'G' : TRANS.includes(g) ? 'T' : ROAD.includes(g) ? 'R' : (g ? 'O' : '.');
const ORIG = loadMap('D:/agent社区/AgentFarm2/_backup/daditu-tmx.json.bak');
const CUR = loadMap('D:/agent社区/AgentFarm2/client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
console.log('原版', ORIG.W, 'x', ORIG.H, '层序:', ORIG.layers.map(l => l.name).join(','));
console.log('当前', CUR.W, 'x', CUR.H, '层序:', CUR.layers.map(l => l.name).join(','));
console.log('\n=== 原版各层 gid 分布 ===');
for (const l of ORIG.layers) console.log(' ', l.name.padEnd(8), top(l.data));
console.log('\n=== 当前各层 gid 分布(全体) ===');
for (const l of CUR.layers) console.log(' ', l.name.padEnd(8), top(l.data));
// 原版外圈(四周4格)地面构成 —— 扩展区应模仿
const { W: OW, H: OH } = ORIG, od = ORIG.layers.find(l => l.name === 'diji').data;
const ring = [];
for (let y = 0; y < OH; y++) for (const x of [0, 1, 2, 3, OW - 4, OW - 3, OW - 2, OW - 1]) ring.push(od[y * OW + x]);
for (let x = 0; x < OW; x++) for (const y of [0, 1, 2, 3, OH - 4, OH - 3, OH - 2, OH - 1]) ring.push(od[y * OW + x]);
const rc = {}; for (const v of ring) rc[cls(v)] = (rc[cls(v)] || 0) + 1;
console.log('\n原版外圈地面构成:', JSON.stringify(rc), '总', ring.length);
// 原版 shilu 在边界的分布：哪些边有路通向地图边缘
const sd = ORIG.layers.find(l => l.name === 'shilu').data;
const edgeRoads = { top: 0, bottom: 0, left: 0, right: 0 };
for (let x = 0; x < OW; x++) { if (sd[x]) edgeRoads.top++; if (sd[(OH - 1) * OW + x]) edgeRoads.bottom++; }
for (let y = 0; y < OH; y++) { if (sd[y * OW]) edgeRoads.left++; if (sd[y * OW + OW - 1]) edgeRoads.right++; }
console.log('原版 shilu 贴边格数(上/下/左/右):', JSON.stringify(edgeRoads));
// 当前图：扩展区(去掉原图区域)地面类别占比 + 单色最长连续
const { W: CW, H: CH } = CUR, cd = CUR.layers.find(l => l.name === 'diji').data;
const L = 14, T = 14, OW2 = 77, OH2 = 61;
const area = { S: 0, G: 0, T: 0, R: 0, O: 0, dot: 0 };
let maxRun = 0, run = 0, prev = -1;
for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
  const inOrig = x >= L && x < L + OW2 && y >= T && y < T + OH2;
  if (inOrig) continue;
  const g = cd[y * CW + x], c = cls(g); area[c] = (area[c] || 0) + 1;
  if (g === prev) { run++; if (run > maxRun) maxRun = run; } else run = 1;
  prev = g;
}
console.log('\n当前扩展区地面构成:', JSON.stringify(area), '最大同gid连续:', maxRun);
// 接缝硬边：四条缝两侧1格带的类别
const seam = (strip) => {
  const c = {}; for (const g of strip) { const k = cls(g); c[k] = (c[k] || 0) + 1; }
  return JSON.stringify(c);
};
for (const [name, exp, org] of [
  ['上缝', CUR.layers[0].data.slice(0, CW * 1), od.slice(0, OW)], // 简化：只统计整行
]) {}
// 直接统计四条缝：扩展侧(缝外1格) vs 原版侧(缝内1格)的 diji 类别
const curD = cd;
function stripCur(x0, y0, dx, dy, n) { const a = []; for (let i = 0; i < n; i++) a.push(curD[(y0 + dy * i) * CW + (x0 + dx * i)]); return a; }
function stripOrg(x0, y0, dx, dy, n) { const a = []; for (let i = 0; i < n; i++) a.push(od[(y0 + dy * i) * OW + (x0 + dx * i)]); return a; }
const seams = {
  '上缝: 扩展侧/原版侧': [stripCur(L, T - 1, 1, 0, OW2), stripCur(L, T, 1, 0, OW2)],
  '下缝: 扩展侧/原版侧': [stripCur(L, T + OH2, 1, 0, OW2), stripCur(L, T + OH2 - 1, 1, 0, OW2)],
  '左缝: 扩展侧/原版侧': [stripCur(L - 1, T, 0, 1, OH2), stripCur(L, T, 0, 1, OH2)],
  '右缝: 扩展侧/原版侧': [stripCur(L + OW2, T, 0, 1, OH2), stripCur(L + OW2 - 1, T, 0, 1, OH2)],
};
console.log('\n=== 四条缝两侧 diji 类别(扩展侧 -> 原版侧) ===');
for (const [k, [a, b]] of Object.entries(seams)) console.log(k.padEnd(20), seam(a), '->', seam(b));
// 原版四周地面具体 gid 频次（扩展模仿用）
const ringTop = {}; for (const x of [0, 1, 2, 3]) for (let y = 0; y < OH; y++) { const v = od[y * OW + x]; if (v) ringTop[v] = (ringTop[v] || 0) + 1; }
console.log('\n原版左缘列(0-3) diji gid:', top(Object.values(ringTop) ? od.filter((_, i) => i % OW < 4) : [], 10));
console.log('原版diji gid 全体top12:', top(od, 12));
console.log('\n原版 shilu top12:', top(sd, 12));
console.log('原版 mulan top12:', top(ORIG.layers.find(l => l.name === 'mulan').data, 12));
console.log('原版 caoduo1 top12:', top(ORIG.layers.find(l => l.name === 'caoduo1').data, 12));
console.log('原版 caoduo2 top12:', top(ORIG.layers.find(l => l.name === 'caoduo2').data, 12));
console.log('原版 caodui top12:', top(ORIG.layers.find(l => l.name === 'caodui').data, 12));
console.log('原版 fanzi top12:', top(ORIG.layers.find(l => l.name === 'fanzi').data, 12));
