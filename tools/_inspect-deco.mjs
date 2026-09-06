// _inspect-deco.mjs —— 原版装饰层布局：nerver(草垛) / caoduo1/2 / caodi2 / mucai 的位置与成组模式
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
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
function loadMap(p) {
  const raw = JSON.parse(decryptBuf(readFileSync(p)).toString('utf8'));
  const s = JSON.stringify(raw);
  const ni = s.indexOf('"daditu"');
  let i = ni + 8; while (s[i] !== '"') i++;
  let j = i + 1; while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === '"') break; j++; }
  const xml = JSON.parse(s.slice(i, j + 1));
  const layers = {};
  for (const m of xml.matchAll(/<layer\b[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g))
    layers[m[1]] = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer)).map(v => v & 0x0fffffff);
  return { W: +xml.match(/width="(\d+)"/)[1], H: +xml.match(/height="(\d+)"/)[1], layers };
}
const M = loadMap('_backup/daditu-tmx.json.bak');
console.log(`原版 ${M.W}x${M.H}`);
for (const ln of ['nerver', 'caoduo1', 'caoduo2', 'caodi2', 'mucai', 'dchide', 'tanzi', 'tanzi2', 'tanzi3', 'caodui']) {
  const L = M.layers[ln];
  if (!L) { console.log(`\n[${ln}] (无此层)`); continue; }
  const cells = [];
  for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) if (L[y * M.W + x]) cells.push([x, y, L[y * M.W + x]]);
  console.log(`\n[${ln}] ${cells.length} 格:`);
  // 按 gid 分组
  const byGid = {};
  for (const [x, y, g] of cells) (byGid[g] = byGid[g] || []).push([x, y]);
  for (const [g, ps] of Object.entries(byGid)) {
    // 判断成组：同一 gid 的格子是否相邻成块
    const set = new Set(ps.map(([x, y]) => y * M.W + x));
    let groups = 0, singles = 0;
    for (const [x, y] of ps) {
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => set.has((y + dy) * M.W + x + dx)).length;
      if (n === 0) singles++; else if (n > 0 && !(x > 0 && set.has(y * M.W + x - 1))) groups++;
    }
    console.log(`  gid=${g} x${ps.length} 单格=${singles} 组=${groups} 位置示例: ${ps.slice(0, 6).map(([x, y]) => `${x},${y}`).join(' ')}`);
  }
}
