// 找引用 eb97a692（村图 tmx）的场景文件，并打印其中 BoxCollider 相关段落结构
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

const ROOT = join(process.cwd(), 'client', 'assets', 'resources', 'import');
const TARGET_UUID = 'eb97a692';
const targets = [TARGET_UUID];
const hits = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (st.size < 40) continue;
    let s;
    try { s = decryptBuf(readFileSync(p)).toString('utf8'); } catch { continue; }
    if (s.includes(TARGET_UUID)) hits.push({ file: p.replace(ROOT + '\\', ''), size: st.size });
  }
}
walk(ROOT);
for (const h of hits) console.log(h.file, `(${h.size}b)`);
