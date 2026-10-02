#!/usr/bin/env node
// tools/_tmp-render-ring.mjs —— 临时：渲染村图(189x173)碰撞+水面+建筑rect/门位，人工核对建筑落位
import { writeFileSync } from 'node:fs';
import { encodePng } from './render-png.mjs';

const col = JSON.parse((await import('node:fs')).readFileSync('data/village-collision.json', 'utf8'));
const farm = JSON.parse((await import('node:fs')).readFileSync('data/village-farm.json', 'utf8'));
const bld = JSON.parse((await import('node:fs')).readFileSync('data/buildings.json', 'utf8'));
const W = col.width, H = col.height;
const S = 5; // 放大倍数
const w = W * S, h = H * S;
const px = Buffer.alloc(w * h * 3);

const set = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b;
};
const rect = (x0, y0, x1, y1, r, g, b) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, r, g, b);
};
const frame = (x0, y0, x1, y1, r, g, b) => {
  for (let x = x0; x <= x1; x++) { set(x, y0, r, g, b); set(x, y1, r, g, b); }
  for (let y = y0; y <= y1; y++) { set(x0, y, r, g, b); set(x1, y, r, g, b); }
};

// 底图：阻挡深灰 / 水蓝 / 空地绿
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const water = farm.water[i] === 1;
  const blk = col.blocked[i] === 1;
  const c = water ? [40, 90, 190] : blk ? [70, 70, 78] : [110, 145, 95];
  rect(x * S, y * S, x * S + S - 1, y * S + S - 1, c[0], c[1], c[2]);
}
// 网格每 10 格
for (let gx = 0; gx <= W; gx += 10) for (let y = 0; y < h; y++) set(gx * S, y, 255, 255, 255);
for (let gy = 0; gy <= H; gy += 10) for (let x = 0; x < w; x++) set(x, gy * S, 255, 255, 255);

// 建筑 rect 黄框 + 门位红点
const only = process.argv[2] || '';
for (const e of bld.buildings) {
  if (only && e.name !== only) continue;
  if (!e.rect || e.scene !== 2) continue;
  const r = e.rect;
  frame(r.x * S, r.y * S, (r.x + r.w) * S - 1, (r.y + r.h) * S - 1, 255, 220, 0);
  rect(r.x * S + 2, r.y * S + 2, (r.x + r.w) * S - 3, (r.y + r.h) * S - 3, 255, 220, 0);
  rect(r.x * S + 3, r.y * S + 3, (r.x + r.w) * S - 4, (r.y + r.h) * S - 4, 110, 145, 95);
  if (e.poi) {
    rect(e.poi.x * S, e.poi.y * S, e.poi.x * S + S - 1, e.poi.y * S + S - 1, 255, 0, 0);
    frame(e.poi.x * S - 2, e.poi.y * S - 2, e.poi.x * S + S + 1, e.poi.y * S + S + 1, 255, 0, 0);
  }
}
const out = process.argv[3] || '/tmp/village-map.png';
writeFileSync(out, encodePng(px, w, h));
console.log(`wrote ${out} (${w}x${h}, scale ${S})`);