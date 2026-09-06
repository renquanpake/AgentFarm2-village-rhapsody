// dbg-tmx-compare.mjs —— 对比备份原版 tmx 与扩展后 tmx 的树根家区域贴图
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const KEY = Buffer.from('qingyoo0316', 'utf8');
function decrypt(buf) {
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return out;
}
function loadTmx(path, isBak) {
  const buf = readFileSync(path);
  const raw = JSON.parse(decrypt(buf).toString('utf8'));
  const s = JSON.stringify(raw);
  const ni = s.indexOf('"daditu"');
  let i = ni + 8; while (s[i] !== '"') i++;
  let j = i + 1; while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === '"') break; j++; }
  const xml = JSON.parse(s.slice(i, j + 1));
  const W = +xml.match(/width="(\d+)"/)[1], H = +xml.match(/height="(\d+)"/)[1];
  const layers = {};
  for (const m of xml.matchAll(/<layer\b[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g)) {
    const arr = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer));
    layers[m[1]] = arr;
  }
  console.log('tilesets:');
  for (const m of xml.matchAll(/<tileset[^>]*>/g)) console.log('  ', m[0].slice(0, 110));
  return { W, H, layers };
}
const orig = loadTmx('D:/agent社区/AgentFarm2/_backup/daditu-tmx.json.bak', true);
const ext = loadTmx('D:/agent社区/AgentFarm2/client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json', false);
console.log('\norig:', orig.W, 'x', orig.H, 'layers:', Object.keys(orig.layers).join(','));
console.log('ext :', ext.W, 'x', ext.H);
function region(L, x0, y0, w, h, W) {
  const out = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const v = L[y * W + x];
    if (v) out.push(x + ',' + y + '=' + v);
  }
  return out;
}
console.log('\n原版 (20,15,10,9) fanzi 非零:', region(orig.layers.fanzi, 20, 15, 10, 9, orig.W).slice(0, 10), 'count=', region(orig.layers.fanzi, 20, 15, 10, 9, orig.W).length);
console.log('原版 (20,15,10,9) caodi 非零:', region(orig.layers.caodi, 20, 15, 10, 9, orig.W).slice(0, 10), 'count=', region(orig.layers.caodi, 20, 15, 10, 9, orig.W).length);
console.log('\n扩展 (18,1,10,9) fanzi 非零:', region(ext.layers.fanzi, 18, 1, 10, 9, ext.W).slice(0, 10), 'count=', region(ext.layers.fanzi, 18, 1, 10, 9, ext.W).length);
console.log('扩展 (18,1,10,9) caodi 非零:', region(ext.layers.caodi, 18, 1, 10, 9, ext.W).slice(0, 10), 'count=', region(ext.layers.caodi, 18, 1, 10, 9, ext.W).length);
