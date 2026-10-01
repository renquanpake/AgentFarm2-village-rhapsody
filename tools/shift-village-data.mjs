#!/usr/bin/env node
// tools/shift-village-data.mjs —— P3 +28 环坐标偏移（幂等：各文件带 p3_shifted 标记）
// expand-village-ring 把村景 TMX/plant 从 133x117 扩到 189x173（旧内容 +28 居中）后，
// 全部 133 空间的村景数据需 +28（像素 +2800）：roads/landmarks/decor/buildings/portals(村景侧)。
// village-shilu.json 与 village-collision/farm 走工具重生成（build-shilu/build-collision/build-farm），不在此列。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const D = join(ROOT, 'data');
const SH = 28;
const read = (p) => JSON.parse(readFileSync(join(D, p), 'utf8'));
const write = (p, o) => writeFileSync(join(D, p), JSON.stringify(o, null, 1) + '\n', 'utf8');

// 1) roads.json 村景（scene "2"）：折线格点 +28
{
  const f = 'roads.json';
  const r = read(f);
  if (!r.p3_shifted) {
    for (const rd of r['2'].roads) {
      rd.line = rd.line.map(([x, y]) => [x + SH, y + SH]);
    }
    r.p3_shifted = true;
    write(f, r);
    console.log(`[shift] ${f} 村景 ${r['2'].roads.length} 段折线 +28`);
  } else console.log(`[shift] ${f} 已跳过（p3_shifted）`);
}

// 2) landmarks.json 村景（"2" 数组 + signs scene=2）：x/y +28
{
  const f = 'landmarks.json';
  const lm = read(f);
  if (!lm.p3_shifted) {
    for (const e of lm['2']) { e.x += SH; e.y += SH; }
    for (const s of lm.signs || []) if (s.scene === 2) { s.x += SH; s.y += SH; }
    lm.p3_shifted = true;
    write(f, lm);
    console.log(`[shift] ${f} 村景 ${lm['2'].length} 地标 + ${lm.signs.filter(s => s.scene === 2).length} 路牌 +28`);
  } else console.log(`[shift] ${f} 已跳过（p3_shifted）`);
}

// 3) municipal-decor.json（"2" 数组）：x/y +28
{
  const f = 'municipal-decor.json';
  const dc = read(f);
  if (!dc.p3_shifted) {
    for (const it of dc['2']) { it.x += SH; it.y += SH; }
    dc.p3_shifted = true;
    write(f, dc);
    console.log(`[shift] ${f} 村景 ${dc['2'].length} 件装饰 +28`);
  } else console.log(`[shift] ${f} 已跳过（p3_shifted）`);
}

// 4) buildings.json：村景建筑 +28（B 覆盖件定稿到环上最终坐标，pending 解除）
{
  const f = 'buildings.json';
  const b = read(f);
  if (!b.p3_shifted) {
    const FINAL = {
      'observatory': { rect: { x: 91, y: 3, w: 9, h: 9 }, door: { x: 9500, y: 1200 }, poi: { x: 95, y: 12 }, sign: { x: 95, y: 12 }, pending: false },
      'gym': { rect: { x: 172, y: 96, w: 10, h: 9 }, door: { x: 17100, y: 10000 }, poi: { x: 171, y: 100 }, sign: { x: 171, y: 100 }, pending: false },
      'forge': { rect: { x: 172, y: 118, w: 10, h: 10 }, door: { x: 17100, y: 12300 }, poi: { x: 171, y: 123 }, sign: { x: 171, y: 123 }, pending: false },
    };
    for (const bd of b.buildings) {
      if (bd.scene !== 2) continue; // 银行/邮局在内部场景 102/109，不动
      if (FINAL[bd.id]) Object.assign(bd, FINAL[bd.id]);
      else {
        if (bd.rect) { bd.rect.x += SH; bd.rect.y += SH; }
        if (bd.door) { bd.door.x += SH * 100; bd.door.y += SH * 100; }
        if (bd.poi) { bd.poi.x += SH; bd.poi.y += SH; }
        if (bd.sign) { bd.sign.x += SH; bd.sign.y += SH; }
      }
    }
    b.p3_shifted = true;
    write(f, b);
    console.log(`[shift] ${f} 村景 ${b.buildings.filter(x => x.scene === 2).length} 建筑 +28（B 覆盖件定稿环上坐标）`);
  } else console.log(`[shift] ${f} 已跳过（p3_shifted）`);
}

// 5) portals.json 村景侧（scene===2 条目的 px 坐标 +2800；toScene===2 的条目坐标属源场景，不动）
{
  const f = 'nav/portals.json';
  const p = read(f);
  if (!p.p3_shifted) {
    let n = 0;
    for (const list of Object.values(p)) if (Array.isArray(list)) for (const e of list) if (e.scene === 2) { e.x += SH * 100; e.y += SH * 100; n++; }
    p.p3_shifted = true;
    write(f, p);
    console.log(`[shift] ${f} 村景侧 ${n} 条门户 +2800`);
  } else console.log(`[shift] ${f} 已跳过（p3_shifted）`);
}

console.log('[shift] 完成。后续：build-shilu -> build-collision -> build-farm -> build-scene-collisions -> gen-nav --check -> check-roads -> nav-replay 重录基线');
