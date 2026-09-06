// 解密备份 TMX，列出图层与对象组
import { readFileSync, writeFileSync } from 'node:fs';
const KEY = Buffer.from('qingyoo0316', 'utf8');
function decryptBuf(buf) {
  if (buf.length < KEY.length) return buf;
  let signed = true;
  for (let i = 0; i < KEY.length; i++) if (buf[i] !== KEY[i]) { signed = false; break; }
  if (!signed) return buf;
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return out;
}
const raw = JSON.parse(decryptBuf(readFileSync('_backup/daditu-tmx.json.bak')).toString('utf8'));
const s = JSON.stringify(raw);
const ni = s.indexOf('"daditu"');
let i = ni + 8; while (s[i] !== '"') i++;
let j = i + 1; while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === '"') break; j++; }
const xml = JSON.parse(s.slice(i, j + 1));
writeFileSync('tools/_out-backup-tmx.xml', xml, 'utf8');
console.log('XML len:', xml.length);
const layerRe = /<layer\b[^>]*name="([^"]+)"[^>]*>/g;
const layers = [...xml.matchAll(layerRe)].map(m => m[1]);
console.log('layers:', layers.join(', '));
const objRe = /<objectgroup\b[^>]*name="([^"]+)"[^>]*>/g;
console.log('objectgroups:', [...xml.matchAll(objRe)].map(m => m[1]).join(', ') || '(none)');
const propRe = /<property\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g;
console.log('map props:', [...xml.matchAll(propRe)].map(m => `${m[1]}=${m[2]}`).join(', ') || '(none)');
console.log('map tag:', xml.match(/<map[^>]*>/)[0]);
