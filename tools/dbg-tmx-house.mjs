// dbg-tmx-house.mjs —— 检查扩展 tmx 里树根家区域的各层贴图
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const KEY = Buffer.from('qingyoo0316', 'utf8');
function decrypt(buf) {
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return out;
}
const raw = JSON.parse(decrypt(readFileSync('D:/agent社区/AgentFarm2/client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json')).toString('utf8'));
const s = JSON.stringify(raw);
const ni = s.indexOf('"daditu"');
let i = ni + 8; while (s[i] !== '"') i++;
let j = i + 1; while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === '"') break; j++; }
const xml = JSON.parse(s.slice(i, j + 1));
const W = +xml.match(/width="(\d+)"/)[1], H = +xml.match(/height="(\d+)"/)[1];
console.log('map:', W, 'x', H);
const layerRe = /<layer\b[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g;
const layers = {};
for (const m of xml.matchAll(layerRe)) {
  const arr = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer));
  layers[m[1]] = arr;
}
function countLayer(name, x0, y0, w, h) {
  const L = layers[name] || [];
  let n = 0; const samples = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const v = L[y * W + x];
    if (v) { n++; if (samples.length < 5) samples.push(x + ',' + y + ':' + v); }
  }
  return { n, samples };
}
console.log('=== 树根家 #2 (18,1,10,9) ===');
for (const L of ['fanzi', 'caodi', 'diji', 'caoduo1', 'caoduo2', 'caodui', 'shilu', 'mulan2', 'mulan']) {
  const r = countLayer(L, 18, 1, 10, 9);
  console.log(L + ':', r.n, JSON.stringify(r.samples));
}
console.log('=== 原版树根家对照 (20,15,10,9) ===');
for (const L of ['fanzi', 'caodi', 'diji']) {
  const r = countLayer(L, 20, 15, 10, 9);
  console.log(L + ':', r.n, JSON.stringify(r.samples));
}
