// 查原版水塘周围地面（沙/草）——原版水塘 x0-10,y24-36（原版坐标）
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const KEY = Buffer.from('qingyoo0316', 'utf8');
const dec = (p) => {
  const buf = readFileSync(p);
  const o = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < o.length; i++) o[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return JSON.parse(o.toString('utf8'));
};
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
const O = loadMap('_backup/daditu-tmx.json.bak');
const { W, H } = O;
const cd = O.layers.caodi, sw = O.layers.shuich;
// 水塘范围（原版）
let minX = 99, maxX = -1, minY = 99, maxY = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sw[y * W + x]) {
  if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
}
console.log(`原版水塘 x[${minX}..${maxX}] y[${minY}..${maxY}]`);
// 水塘周围 2 圈的地面类型分布
const sandCnt = {}, grassCnt = {};
for (let y = minY - 2; y <= maxY + 2; y++) {
  for (let x = minX - 2; x <= maxX + 2; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    if (sw[y * W + x]) continue; // 水本身
    const g = cd[y * W + x];
    const key = `${x},${y}`;
    if (g === 0) sandCnt[key] = true; else if ([5, 6, 7, 8].includes(g)) grassCnt[key] = true;
  }
}
console.log(`水塘外围沙格=${Object.keys(sandCnt).length} 草格=${Object.keys(grassCnt).length}`);
// 打印水塘周围地图（原版）：S=沙 . =草 ~ =水
for (let y = minY - 2; y <= maxY + 2; y++) {
  let line = '';
  for (let x = minX - 2; x <= maxX + 2; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) { line += 'X'; continue; }
    if (sw[y * W + x]) line += '~';
    else if (cd[y * W + x] === 0) line += 'S';
    else line += '.';
  }
  console.log(line);
}
