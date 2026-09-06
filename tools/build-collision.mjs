// build-collision.mjs —— 从村地图 tmx 生成服务器碰撞网格（data/village-collision.json）
// 碰撞规则：原村区域 fanzi / 全图水面 / 扩展区栅栏(镜像带+外圈+房屋复制) / 地图边界 / 扩展区宅基地核心
// 输出：{ width, height, blocked: [0/1...] }，供服务器 move_to 寻路与客户端小地图
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(__dirname, '..', 'client', 'assets', 'resources', 'import');
const VILLAGE_JSON = join(CLIENT, 'eb', 'eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const SPAWNS_JSON = join(__dirname, '..', 'data', 'spawn-points.json');
const OUT = join(__dirname, '..', 'data', 'village-collision.json');

// 解密 client 资源
const KEY = Buffer.from('qingyoo0316', 'utf8');
function decrypt(buf) {
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return out;
}
const raw = JSON.parse(decrypt(readFileSync(VILLAGE_JSON)).toString('utf8'));
const s = JSON.stringify(raw);
const ni = s.indexOf('"daditu"');
let i = ni + 8; while (s[i] !== '"') i++;
let j = i + 1; while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === '"') break; j++; }
const xml = JSON.parse(s.slice(i, j + 1));
const W = +xml.match(/width="(\d+)"/)[1], H = +xml.match(/height="(\d+)"/)[1];
const ORIG_W = 77, ORIG_H = 61;
const MARGIN = Math.round((W - ORIG_W) / 2);
console.log(`地图 ${W}x${H}（原版 ${ORIG_W}x${ORIG_H}，边距 ${MARGIN}）`);

// 提取各层
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

const blocked = new Array(W * H).fill(0);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = y * W + x;
    // 原村区域房子/水面
    if (inOrig(x, y) && (getT('fanzi', x, y) || getT('shuich', x, y))) blocked[idx] = 1;
    // 全图水面
    if (getT('shuich', x, y)) blocked[idx] = 1;
    // 全图栅栏/树篱（路上悬空的除外：原版广场重叠装饰保持可走）
    if (!onRoad(x, y) && (getT('mulan', x, y) || getT('mulan2', x, y))) blocked[idx] = 1;
  }
}
// 扩展区宅基地房子矩形（spawn-points）
const spawns = JSON.parse(readFileSync(SPAWNS_JSON, 'utf8'));
for (const h of (spawns.houses || [])) {
  const r = h.rect;
  // 素材矩形外圈是透明留白，不应阻断紧邻房屋的道路 → 矩形整体先放行
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x >= 0 && y >= 0 && x < W && y < H) blocked[y * W + x] = 0;
    }
  }
  // 内芯才是房子本体（缩进 1 格）
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
      if (x >= 0 && y >= 0 && x < W && y < H) blocked[y * W + x] = 1;
    }
  }
}
// 边界外一圈也挡（防越界）
for (let x = 0; x < W; x++) { blocked[x] = 1; blocked[(H - 1) * W + x] = 1; }
for (let y = 0; y < H; y++) { blocked[y * W] = 1; blocked[y * W + W - 1] = 1; }

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ width: W, height: H, blocked }));
const cnt = blocked.filter(Boolean).length;
console.log(`碰撞网格：${W}x${H}，障碍格 ${cnt}（${(cnt / blocked.length * 100).toFixed(1)}%）`);
console.log('已写入', OUT);
