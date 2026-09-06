import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const KEY = Buffer.from('qingyoo0316', 'utf8');
const dec = (p) => {
  const buf = readFileSync(p);
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return JSON.parse(out.toString('utf8'));
};
const s = JSON.stringify(dec('D:/agent社区/AgentFarm2/client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json'));
const ni = s.indexOf('"daditu"');
let i = ni + 8; while (s[i] !== '"') i++;
let j = i + 1; while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === '"') break; j++; }
const xml = JSON.parse(s.slice(i, j + 1));
console.log('map:', xml.match(/width="(\d+)"/)[1], 'x', xml.match(/height="(\d+)"/)[1]);
const W = +xml.match(/width="(\d+)"/)[1], H = +xml.match(/height="(\d+)"/)[1];
console.log('expect data len:', W * H);
let ok = true, n = 0;
for (const m of xml.matchAll(/name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g)) {
  const b64 = m[2].replace(/\s/g, '');
  const raw = zlib.inflateSync(Buffer.from(b64, 'base64'));
  const good = raw.length === W * H * 4;
  console.log(m[1], good ? 'OK' : 'BAD len=' + raw.length);
  if (!good) ok = false;
  n++;
}
console.log('layers:', n, 'all ok:', ok);
// plant
const p = JSON.stringify(dec('D:/agent社区/AgentFarm2/client/assets/resources/import/2c/2cf76085-68a7-4e68-9e2d-e98eff639571.25ea3.json'));
const pi = p.indexOf('"mapWidth"');
console.log('plant ctx:', p.slice(pi, pi + 100));
