// _scan-path.mjs —— 扫描 client 资源：哪个文件引用了 dadituPath / dadituMapPlant（客户端碰撞/寻路数据）
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
const targets = ['dadituPath', 'dadituMapPlant', 'hebianPath', 'path_json', 'little_map'];
const hits = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!/\.(json|bin|txt)$/.test(f)) continue;
    let s;
    try { s = decryptBuf(readFileSync(p)).toString('utf8'); } catch { continue; }
    for (const t of targets) {
      if (s.includes(t)) { hits.push({ file: p.replace(ROOT + '\\', ''), size: st.size, target: t }); break; }
    }
  }
}
walk(ROOT);
for (const h of hits) console.log(h.file, '->', h.target, `(${h.size}b)`);
console.log('total hits:', hits.length);
