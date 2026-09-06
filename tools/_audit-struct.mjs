// _audit-struct.mjs —— 原版/当前地图结构 ASCII + 过渡块翻转规律 + shilu 位置
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
const get = (m, n) => m.layers.find(l => l.name === n).data;
const GRASS = [5, 6, 7, 8], TRANS = [99, 100, 101];
const isGrass = g => GRASS.includes(g & 0x1fffffff);
const isTrans = g => TRANS.includes(g & 0x1fffffff);
const M = loadMap('D:/agent社区/AgentFarm2/_backup/daditu-tmx.json.bak');
const { W, H } = M;
const cd = get(M, 'caodi'), sh = get(M, 'shilu'), fz = get(M, 'fanzi'), mu = get(M, 'mulan'), mu2 = get(M, 'mulan2');
const c2 = get(M, 'caodi2'), cu = get(M, 'caodui'), c1 = get(M, 'caoduo1'), c2l = get(M, 'caoduo2'), nv = get(M, 'nerver');
// --- ASCII 结构图（3x3 降采样）---
const sx = 3, sy = 3;
console.log(`=== 原版 caodi 结构图 (${W}x${H}, 每${sx}x${sy}合并) ===`);
for (let by = 0; by < H; by += sy) {
  let line = '';
  for (let bx = 0; bx < W; bx += sx) {
    let g = 0, t = 0, f = 0, r = 0, w = 0;
    for (let y = by; y < Math.min(by + sy, H); y++) for (let x = bx; x < Math.min(bx + sx, W); x++) {
      const i = y * W + x;
      if (fz[i]) f++; else if (sh[i]) r++; else if (get(M,'shuich')[i]) w++;
      else if (isGrass(cd[i])) g++; else if (isTrans(cd[i])) t++;
    }
    const n = Math.min(sx, W - bx) * Math.min(sy, H - by);
    line += f > 0 ? 'H' : r > n / 3 ? 'R' : w > n / 3 ? '~' : t > n / 4 ? 'T' : g > n / 2 ? '#' : '.';
  }
  console.log(line);
}
// --- 边缘条带草地占比 ---
for (const [nm, fn] of [
  ['上2行', (x, y) => y < 2], ['下2行', (x, y) => y >= H - 2], ['左2列', (x, y) => x < 2], ['右2列', (x, y) => x >= W - 2],
  ['上8行', (x, y) => y < 8], ['下8行', (x, y) => y >= H - 8], ['左8列', (x, y) => x < 8], ['右8列', (x, y) => x >= W - 8],
]) {
  let g = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fn(x, y)) { n++; if (isGrass(cd[y * W + x])) g++; }
  console.log(`原版${nm}: 草地 ${(100 * g / n).toFixed(0)}% (${g}/${n})`);
}
// --- 过渡块翻转规律：caodi 中 gid=100±flip 的格子，统计其四邻草地模式 → flip 组合 ---
const patCount = new Map();
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const g = cd[y * W + x];
  if ((g & 0x1fffffff) !== 100) continue;
  const nbr = [cd[(y - 1) * W + x], cd[(y + 1) * W + x], cd[y * W + x - 1], cd[y * W + x + 1]].map(v => isGrass(v) || isTrans(v) ? 1 : 0).join('');
  const flip = (g >>> 29) & 7; // H=4,V=2,D=1? Tiled: H=0x80000000(bit31), V=0x40000000(bit30), D=0x20000000(bit29)
  const key = `${nbr}->${flip}`;
  patCount.set(key, (patCount.get(key) || 0) + 1);
}
console.log('\n=== 过渡块(100)四邻草地模式 -> flip 计数 ===');
for (const [k, v] of [...patCount.entries()].sort((a, b) => b[1] - a[1])) console.log(`  NESW[${k}] x${v}`);
// --- shilu 位置与走向 ---
console.log('\n=== shilu 位置(相邻shilu判走向) ===');
const shTiles = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sh[y * W + x]) shTiles.push({ x, y, g: sh[y * W + x] });
for (const t of shTiles) {
  const n = t.y > 0 && sh[(t.y - 1) * W + t.x], s = t.y < H - 1 && sh[(t.y + 1) * W + t.x],
    w = t.x > 0 && sh[t.y * W + t.x - 1], e = t.x < W - 1 && sh[t.y * W + t.x + 1];
  const dir = [n, s, w, e].filter(Boolean).length;
  const shape = dir === 1 ? '端点' : n && s && !w && !e ? '竖直' : !n && !s && w && e ? '横直' : '拐角/丁字';
  console.log(`  (${t.x},${t.y}) gid=${t.g} ${shape}`);
}
// --- 原版房屋矩形内/周围草地占比（判断沙地院子）---
const rects = [[20, 15, 10, 9], [48, 20, 10, 10], [0, 36, 9, 10], [19, 36, 7, 9], [63, 38, 9, 9], [63, 0, 8, 8]];
for (const [rx, ry, rw, rh] of rects) {
  const stat = (x0, y0, x1, y1) => { let g = 0, f = 0, n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; n++; if (fz[i]) f++; if (isGrass(cd[i])) g++; } return `${(100 * g / n).toFixed(0)}%草 ${f}房`; };
  console.log(`  房(${rx},${ry})内: ${stat(rx, ry, rx + rw - 1, ry + rh - 1)} | 外扩2: ${stat(rx - 2, ry - 2, rx + rw + 1, ry + rh + 1)} | 外扩5: ${stat(rx - 5, ry - 5, rx + rw + 4, ry + rh + 4)}`);
}
// --- mulan 等装饰与道路/房子的重叠 ---
let muOnRoad = 0, muOnHouse = 0, muNearHouse = 0, muTot = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  if (mu[i] || mu2[i]) {
    muTot++;
    if (sh[i]) muOnRoad++;
    if (fz[i]) muOnHouse++;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && fz[yy * W + xx]) near = true;
    }
    if (near) muNearHouse++;
  }
}
console.log(`\nmulan/mulan2 共${muTot}: 压路${muOnRoad}, 压房${muOnHouse}, 房周2格内${muNearHouse}`);
