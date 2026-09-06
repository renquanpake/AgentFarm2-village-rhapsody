// 原版栅栏 gid 分布（外圈环加密用）
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const KEY = Buffer.from('qingyoo0316', 'utf8');
const dec = (p) => {
  const buf = readFileSync(p);
  const o = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < o.length; i++) o[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return JSON.parse(o.toString('utf8'));
};
const s = JSON.stringify(dec('_backup/daditu-tmx.json.bak'));
let i = s.indexOf('"daditu"') + 8; while (s[i] !== '"') i++;
let j = ++i; while (j < s.length) { if (s[j] === '\\') j += 2; else if (s[j++] === '"') break; }
const xml = JSON.parse(s.slice(i - 1, j));
const layers = {};
for (const m of xml.matchAll(/<layer[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g))
  layers[m[1]] = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer)).map(v => v & 0x0fffffff);
const gids = {};
for (let y = 0; y < 61; y++) for (let x = 0; x < 77; x++) {
  const g = layers.mulan[y * 77 + x] || layers.mulan2[y * 77 + x];
  if (g) gids[g] = (gids[g] || 0) + 1;
}
console.log('原版栅栏 gid 分布:', JSON.stringify(gids));
// 原版边缘 2 圈的栅栏 gid（外圈环同风格）
const edge = {};
for (let y = 0; y < 61; y++) for (let x = 0; x < 77; x++) {
  if (!(x < 2 || y < 2 || x >= 75 || y >= 59)) continue;
  const g = layers.mulan[y * 77 + x] || layers.mulan2[y * 77 + x];
  if (g) edge[g] = (edge[g] || 0) + 1;
}
console.log('原版边缘栅栏 gid:', JSON.stringify(edge));
