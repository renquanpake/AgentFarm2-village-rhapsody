// _check-beauty.mjs —— 扩展地图视觉/结构校验：接缝、路网、房屋、装饰统计
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const KEY = Buffer.from('qingyoo0316', 'utf8');
const dec = (p) => {
  const buf = readFileSync(p);
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return JSON.parse(out.toString('utf8'));
};
function loadMap(p) {
  const s = JSON.stringify(dec(p));
  let i = s.indexOf('"daditu"') + 8; while (s[i] !== '"') i++;
  let j = ++i; while (j < s.length) { if (s[j] === '\\') j += 2; else if (s[j++] === '"') break; }
  const xml = JSON.parse(s.slice(i - 1, j));
  const layers = {};
  for (const m of xml.matchAll(/<layer[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g))
    layers[m[1]] = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer));
  return { W: +xml.match(/width="(\d+)"/)[1], H: +xml.match(/height="(\d+)"/)[1], layers };
}
const M = loadMap('D:/agent社区/AgentFarm2/client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const O = loadMap('D:/agent社区/AgentFarm2/_backup/daditu-tmx.json.bak');
const { W, H } = M;
const L = Math.round((W - O.W) / 2), T = Math.round((H - O.H) / 2), OW = O.W, OH = O.H;
const GX0 = L + 39, GX1 = L + 41, GY0 = T + 49, GY1 = T + 51;
const cd = M.layers.caodi, di = M.layers.diji, fz = M.layers.fanzi, sh = M.layers.shilu;
const GRASS = [5, 6, 7, 8];
const isG = g => GRASS.includes(g & 0x1fffffff);
const isT = g => { const r = g & 0x1fffffff; return r >= 99 && r <= 101; };
const inExp = (x, y) => !(x >= L && x < L + OW && y >= T && y < T + OH);
let fail = 0;
const chk = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) fail++; };

// 1) 原版区域与备份一致（允许"草皮→过渡块"路嘴改动 + 水塘沙岸；其余必须一致）
let origDiff = 0, origMouth = 0, pondShore = 0;
const isPondShore = (x, y) => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (M.layers.shuich[(y + dy) * W + x + dx]) return true;
  return false;
};
for (const lname of ['caodi', 'diji', 'fanzi', 'shilu']) {
  for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
    const a = M.layers[lname][(y + T) * W + (x + L)], b = O.layers[lname][y * OW + x];
    if (a === b) continue;
    if (lname === 'caodi' && isG(b) && isT(a)) { origMouth++; continue; }
    if (lname === 'caodi' && isG(b) && a === 0 && isPondShore(x + L, y + T)) { pondShore++; continue; } // 水塘沙岸
    origDiff++;
  }
}
chk('原版区域仅路嘴/水塘岸改动', origDiff === 0, `${origDiff} 格非豁免差异, ${origMouth} 格路嘴, ${pondShore} 格水塘岸`);

// 2) 接缝硬边：跨缝相邻对（扩展侧, 原版侧）类别组合
const cls = g => isG(g) ? 'G' : isT(g) ? 'T' : (g === 0 ? 'S' : 'O');
const seamPairs = {};
const hard = [];
for (let i = 0; i < OW; i++) {
  const pairs = [[L + i, T - 1, L + i, T, '上'], [L + i, T + OH, L + i, T + OH - 1, '下']];
  for (const [x1, y1, x2, y2, nm] of pairs) {
    const k = `${cls(cd[y1 * W + x1])}${cls(cd[y2 * W + x2])}`;
    seamPairs[k] = (seamPairs[k] || 0) + 1;
    if (k === 'GS' || k === 'SG') hard.push(`${nm}(${x1},${y1})`);
  }
}
for (let i = 0; i < OH; i++) {
  const pairs = [[L - 1, T + i, L, T + i, '左'], [L + OW, T + i, L + OW - 1, T + i, '右']];
  for (const [x1, y1, x2, y2, nm] of pairs) {
    const k = `${cls(cd[y1 * W + x1])}${cls(cd[y2 * W + x2])}`;
    seamPairs[k] = (seamPairs[k] || 0) + 1;
    if (k === 'GS' || k === 'SG') hard.push(`${nm}(${x1},${y1})`);
  }
}
console.log('接缝相邻对分布:', JSON.stringify(seamPairs));
chk('接缝无草/沙硬切', hard.length === 0, `${hard.length} 处: ${hard.slice(0, 8).join(' ')}`);

// 3) 路网连通：从四条主路 BFS 沙格，检查 7 个门口都在连通域内
const spawns = JSON.parse(readFileSync('D:/agent社区/AgentFarm2/data/spawn-points.json', 'utf8'));
const sand = (x, y) => x >= 0 && y >= 0 && x < W && y < H && cd[y * W + x] === 0;
const flood = new Set();
const q = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inExp(x, y) && sand(x, y) && (x === GX0 || x === GX1 || y === GY0 || y === GY1)) { flood.add(y * W + x); q.push([x, y]); }
while (q.length) {
  const [x, y] = q.pop();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (inExp(nx, ny) && sand(nx, ny) && !flood.has(ny * W + nx)) { flood.add(ny * W + nx); q.push([nx, ny]); }
  }
}
const unreached = spawns.houses.filter(h => !flood.has(Math.round(h.door.y / 100) * W + Math.round(h.door.x / 100)));
chk('7 户门口全部连通主路', unreached.length === 0, unreached.map(h => `#${h.id}@(${h.door.x / 100},${h.door.y / 100})`).join(' '));
const edgeOk = [0, 1, 2].every(i => sand(GX0 + i, 0) && sand(GX0 + i, H - 1)) && [0, 1, 2].every(i => sand(0, GY0 + i) && sand(W - 1, GY0 + i));
chk('四条主路贯通地图边缘', edgeOk);

// 4) 房屋完整性：每户 fanzi 覆盖率 ≥50%（素材矩形本身非全满），矩形外扩展区无 fanzi
const houseBad = [], outsideFanzi = [];
for (const h of spawns.houses) {
  const r = h.rect;
  let f = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (fz[y * W + x]) f++;
  const cov = f / (r.w * r.h);
  if (cov < 0.5) houseBad.push(`#${h.id} ${(cov * 100).toFixed(0)}%`);
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!inExp(x, y) || !fz[y * W + x]) continue;
  if (!spawns.houses.some(h => x >= h.rect.x && x < h.rect.x + h.rect.w && y >= h.rect.y && y < h.rect.y + h.rect.h)) outsideFanzi.push(`${x},${y}`);
}
chk('房屋矩形 fanzi 覆盖 ≥50%', houseBad.length === 0, houseBad.join(' '));
chk('扩展区无矩形外 fanzi', outsideFanzi.length === 0, `${outsideFanzi.length} 格`);

// 5) 统计：扩展区地面构成 / 装饰 / 石板 / 水面 / 栅栏
let s = 0, g = 0, t = 0, o = 0, deco = 0, water = 0, fence = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!inExp(x, y)) continue;
  const v = cd[y * W + x];
  if (v === 0) s++; else if (isG(v)) g++; else if (isT(v)) t++; else o++;
  for (const ln of ['mulan', 'mulan2']) if (M.layers[ln][y * W + x]) fence++;
  for (const ln of ['caoduo1', 'caoduo2', 'caodui', 'caodi2']) if (M.layers[ln][y * W + x]) deco++;
  if (M.layers.shuich && M.layers.shuich[y * W + x]) water++;
}
const tot = s + g + t + o;
console.log(`扩展区 ${tot} 格: 沙 ${(s / tot * 100).toFixed(0)}% 草 ${(g / tot * 100).toFixed(0)}% 过渡 ${(t / tot * 100).toFixed(0)}% 其他 ${o}`);
chk('扩展区无水面', water === 0, `${water} 格`);
chk('扩展区无未知地面gid', o === 0, `${o} 格`);
let pad = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inExp(x, y) && sh[y * W + x]) pad++;
chk('门前石板台阶 20-32 格(2x2+裁剪)', pad >= 20 && pad <= 32, `${pad} 格`);
chk('扩展区栅栏(含外圈环) 500-1300', fence >= 500 && fence <= 1300, `${fence} 格`);
chk('田野装饰(草垛/草丛) 40-320', deco >= 40 && deco <= 320, `${deco} 格`);
console.log(fail === 0 ? '\n全部通过 ✓' : `\n${fail} 项失败 ✗`);
process.exit(fail ? 1 : 0);
