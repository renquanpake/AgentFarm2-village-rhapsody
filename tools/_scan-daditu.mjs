// 全 client/assets 扫描 "daditu" 字符串引用
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

const ROOT = join(process.cwd(), 'client', 'assets');
const hits = [];
function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const f of entries) {
    const p = join(dir, f);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p); continue; }
    if (st.size < 40 || st.size > 5 * 1024 * 1024) continue;
    let s;
    try { s = decryptBuf(readFileSync(p)).toString('utf8'); } catch { continue; }
    if (s.includes('daditu')) hits.push({ file: p.replace(ROOT + '\\', ''), size: st.size });
  }
}
walk(ROOT);
for (const h of hits) console.log(h.file, `(${h.size}b)`);
console.log('total:', hits.length);
