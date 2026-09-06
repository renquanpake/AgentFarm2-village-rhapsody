// 算水塘边界 + 安全岸边点
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const KEY = Buffer.from('qingyoo0316', 'utf8');
const dec = (p) => {
  const buf = readFileSync(p);
  const o = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < o.length; i++) o[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return JSON.parse(o.toString('utf8'));
};
const s = JSON.stringify(dec('client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json'));
let i = s.indexOf('"daditu"') + 8; while (s[i] !== '"') i++;
let j = ++i; while (j < s.length) { if (s[j] === '\\') j += 2; else if (s[j++] === '"') break; }
const xml = JSON.parse(s.slice(i - 1, j));
const W = +xml.match(/width="(\d+)"/)[1], H = +xml.match(/height="(\d+)"/)[1];
const layers = {};
for (const m of xml.matchAll(/<layer[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g))
  layers[m[1]] = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer)).map(v => v & 0x0fffffff);
const water = layers.shuich;
let minX = 99, maxX = -1, minY = 99, maxY = -1, cnt = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (water[y * W + x]) {
  cnt++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
}
console.log(`水塘 ${cnt}格 x[${minX}..${maxX}] y[${minY}..${maxY}]`);
// 北岸安全点：水塘正北 4 格，检查该格及周围不是水/不是栅栏/不是房子
const by = minY - 4, bx = Math.round((minX + maxX) / 2);
const isFence = layers.mulan[by * W + bx] || layers.mulan2[by * W + bx];
const isWater = water[by * W + bx];
const isSand = layers.caodi[by * W + bx] === 0;
const isFanzi = layers.fanzi[by * W + bx];
console.log(`北岸点 TMX (${bx},${by}) 水=${isWater} 栅栏=${isFence} 沙=${isSand} 房=${isFanzi}`);
const local = [(bx + 0.5) * 100, (H - by) * 100 - 50];
console.log(`本地坐标 (${local[0]}, ${local[1]})`);
// 水塘西岸点
const wx = minX - 4, wy = Math.round((minY + maxY) / 2);
console.log(`西岸点 TMX (${wx},${wy}) 水=${water[wy * W + wx]} 栅栏=${layers.mulan[wy * W + wx] || layers.mulan2[wy * W + wx]} 本地 (${(wx + 0.5) * 100}, ${(H - wy) * 100 - 50})`);
// 原版 shuich gid 对比
const s2 = JSON.stringify(dec('_backup/daditu-tmx.json.bak'));
let i2 = s2.indexOf('"daditu"') + 8; while (s2[i2] !== '"') i2++;
let j2 = ++i2; while (j2 < s2.length) { if (s2[j2] === '\\') j2 += 2; else if (s2[j2++] === '"') break; }
const xml2 = JSON.parse(s2.slice(i2 - 1, j2));
const ow = +xml2.match(/width="(\d+)"/)[1];
const layers2 = {};
for (const m of xml2.matchAll(/<layer[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g))
  layers2[m[1]] = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer)).map(v => v & 0x0fffffff);
const gids2 = {};
for (const v of layers2.shuich) if (v) gids2[v] = (gids2[v] || 0) + 1;
console.log('原版 shuich gids:', JSON.stringify(gids2));
// 当前水塘位置上下层
const c33 = []; for (const ln of ['diji', 'caodi', 'shuich', 'fanzi']) c33.push(ln + '=' + (layers[ln] ? layers[ln][58 * W + 33] : '?'));
console.log('TMX(33,58) 各层:', c33.join(' '));
