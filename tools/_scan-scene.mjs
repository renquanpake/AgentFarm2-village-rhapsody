// _scan-scene.mjs —— 扫描解密后的资源，找村庄场景（含 pnlTiledMap / daditu 引用）与碰撞组件
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
const targets = ['pnlTiledMap', 'passageCollider', 'BoxCollider', 'Collider'];
const hits = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (st.size < 40) continue;
    let s;
    try { s = decryptBuf(readFileSync(p)).toString('utf8'); } catch { continue; }
    const found = [];
    for (const t of targets) if (s.includes(t)) found.push(t);
    if (found.length) hits.push({ file: p.replace(ROOT + '\\', ''), size: st.size, found: found.join(',') });
  }
}
walk(ROOT);
hits.sort((a, b) => a.file.localeCompare(b.file));
for (const h of hits) console.log(h.file, '->', h.found, `(${h.size}b)`);
console.log('total:', hits.length);
