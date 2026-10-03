// village-layers.mjs —— 村地图 tmx 解密与图层解析（build-collision.mjs 与 nav-audit.mjs 共用单一源）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const KEY = Buffer.from('qingyoo0316', 'utf8');
function decrypt(buf) {
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < buf.length - KEY.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return out;
}

export function loadVillageLayers(rootDir) {
  const VILLAGE_JSON = join(rootDir, 'client', 'assets', 'resources', 'import', 'eb', 'eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
  const raw = JSON.parse(decrypt(readFileSync(VILLAGE_JSON)).toString('utf8'));
  const s = JSON.stringify(raw);
  const ni = s.indexOf('"daditu"');
  let i = ni + 8; while (s[i] !== '"') i++;
  let j = i + 1; while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === '"') break; j++; }
  const xml = JSON.parse(s.slice(i, j + 1));
  const W = +xml.match(/width="(\d+)"/)[1], H = +xml.match(/height="(\d+)"/)[1];
  const ORIG_W = 77, ORIG_H = 61;
  const MARGIN = Math.round((W - ORIG_W) / 2);
  const layerRe = /<layer\b[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g;
  const layers = {};
  for (const m of xml.matchAll(layerRe)) {
    const b64 = m[2].replace(/\s/g, '');
    const arr = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(b64, 'base64')).buffer));
    layers[m[1]] = arr.map(v => v & 0x0fffffff);
  }
  const getT = (n, x, y) => (layers[n] ? layers[n][y * W + x] : 0);
  // 沙/石 = 路（栅栏悬于路上不挡：原版广场重叠装饰保持可走）
  const onRoad = (x, y) => getT('caodi', x, y) === 0 || getT('shilu', x, y) !== 0;
  const inOrig = (x, y) => x >= MARGIN && x < MARGIN + ORIG_W && y >= MARGIN && y < MARGIN + ORIG_H;
  return { W, H, ORIG_W, ORIG_H, MARGIN, layers, getT, onRoad, inOrig };
}
