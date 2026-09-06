// _swap-map.mjs —— 临时把客户端地图资源换成原版备份 tmx（orig|restore）
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const VILLAGE_JSON = join(__dirname, '..', 'client', 'assets', 'resources', 'import', 'eb', 'eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const VILLAGE_SOURCE = join(__dirname, '..', '_backup', 'daditu-tmx.json.bak');
const TMP = join(__dirname, '..', '_village_ext.bin');
const KEY = Buffer.from('qingyoo0316', 'utf8');
const SIGN = Buffer.from('qingyoo0316', 'utf8');
function decryptBuf(buf) {
  if (buf.length < SIGN.length) return buf;
  for (let i = 0; i < SIGN.length; i++) if (buf[i] !== SIGN[i]) return buf;
  const out = Buffer.allocUnsafe(buf.length - SIGN.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[SIGN.length + i] ^ KEY[i % KEY.length];
  return out;
}
function encryptBuf(buf) {
  const out = Buffer.allocUnsafe(SIGN.length + buf.length);
  SIGN.copy(out, 0);
  for (let i = 0; i < buf.length; i++) out[SIGN.length + i] = buf[i] ^ KEY[i % KEY.length];
  return out;
}
// 递归替换所有以 <?xml 开头的字符串（即 tmxXmlStr）
function replaceTmx(node, newXml) {
  if (typeof node === 'string') return node.startsWith('<?xml') ? newXml : node;
  if (Array.isArray(node)) return node.map(v => replaceTmx(v, newXml));
  if (node && typeof node === 'object') { const o = {}; for (const k of Object.keys(node)) o[k] = replaceTmx(node[k], newXml); return o; }
  return node;
}
const mode = process.argv[2];
if (mode === 'orig') {
  copyFileSync(VILLAGE_JSON, TMP);
  const cur = JSON.parse(decryptBuf(readFileSync(VILLAGE_JSON)).toString('utf8'));
  const bak = JSON.parse(decryptBuf(readFileSync(VILLAGE_SOURCE)).toString('utf8'));
  let origTmx = null;
  (function find(n) { if (origTmx) return; if (typeof n === 'string') { if (n.startsWith('<?xml')) origTmx = n; return; } if (Array.isArray(n)) { for (const v of n) find(v); return; } if (n && typeof n === 'object') { for (const k of Object.keys(n)) find(n[k]); } })(bak);
  if (!origTmx) { console.error('backup tmx not found'); process.exit(1); }
  writeFileSync(VILLAGE_JSON, encryptBuf(Buffer.from(JSON.stringify(replaceTmx(cur, origTmx)), 'utf8')));
  console.log('swapped to ORIGINAL map (ext saved to _village_ext.bin)');
} else if (existsSync(TMP)) {
  copyFileSync(TMP, VILLAGE_JSON);
  console.log('restored extended map');
} else {
  console.error('no backup file _village_ext.bin');
  process.exit(1);
}
