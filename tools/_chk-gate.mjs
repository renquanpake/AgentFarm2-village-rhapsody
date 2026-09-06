// 检查门路边缘格地面类型
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const K = Buffer.from('qingyoo0316', 'utf8');
function dec(p) {
  const b = readFileSync(p);
  const o = Buffer.allocUnsafe(b.length - K.length);
  for (let i = 0; i < o.length; i++) o[i] = b[K.length + i] ^ K[i % K.length];
  return JSON.parse(o.toString('utf8'));
}
const s = JSON.stringify(dec('client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json'));
let i = s.indexOf('"daditu"') + 8; while (s[i] !== '"') i++;
let j = ++i; while (j < s.length) { if (s[j] === '\\') j += 2; else if (s[j++] === '"') break; }
const xml = JSON.parse(s.slice(i - 1, j));
const layers = {};
for (const m of xml.matchAll(/<layer[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g))
  layers[m[1]] = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer)).map(v => v & 0x0fffffff);
const W = +xml.match(/width="(\d+)"/)[1], H = +xml.match(/height="(\d+)"/)[1];
const cells = [[67, 0], [68, 0], [69, 0], [67, 116], [68, 116], [69, 116], [0, 77], [0, 78], [0, 79], [132, 77], [132, 78], [132, 79]];
for (const [x, y] of cells) {
  const g = layers.caodi[y * W + x];
  console.log(`${x},${y} caodi=${g} ${g === 0 ? '沙' : '草'}`);
}
