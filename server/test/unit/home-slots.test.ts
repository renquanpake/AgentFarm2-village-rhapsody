// test/unit/home-slots.test.ts —— 阶段一 B4：场景 1 槽位化（房子私有）
// 事故背景：R1 要求「多个玩家各有家」，但场景 1 只有原版单人 29x29 网格，
// 第 2+ 名玩家与第 1 名共用同一片家门口 —— 房子没有私有可言。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadHomeSlots, slotOfPlayer, inSlotRect, homeSlotViolation, homeSpawnPx,
} from '../../src/world/spawn-slots.ts';

const DATA = path.resolve(new URL('../../../data', import.meta.url).pathname);
const doc = loadHomeSlots(DATA);

describe('场景 1 槽位数据', () => {
  it('槽位表存在且至少 4 槽', () => {
    expect(doc).not.toBeNull();
    expect(doc!.slots.length).toBeGreaterThanOrEqual(4);
    expect(doc!.scene).toBe(1);
  });

  it('单槽源 data/home-collision.json 已生成（29x29 源）', () => {
    const hc = JSON.parse(fs.readFileSync(path.join(DATA, 'home-collision.json'), 'utf8'));
    expect(hc.width).toBe(29);
    expect(hc.height).toBe(29);
    expect(hc.blocked.length).toBe(29 * 29);
    expect(hc.source).toContain('zhujuejia.json');
  });

  it('合并导航：宽 29、高 = 8 槽 x 30，槽间整列阻挡（跨槽不可走）', () => {
    const nav = JSON.parse(fs.readFileSync(path.join(DATA, 'nav/nav-zhujuejia-slots.json'), 'utf8'));
    expect(nav.width).toBe(29);
    expect(nav.height).toBe(doc!.slots.length * (nav.slotHeight + 1));
    const W = nav.width, H = nav.slotHeight;
    for (let i = 1; i < doc!.slots.length; i++) {
      const gapY = i * (H + 1) - 1;                 // 槽间那一行
      for (let x = 0; x < W; x++) expect(nav.blocked[gapY * W + x]).toBe(1);
    }
  });

  it('每槽出生点可走且落在本槽矩形内', () => {
    const nav = JSON.parse(fs.readFileSync(path.join(DATA, 'nav/nav-zhujuejia-slots.json'), 'utf8'));
    const W = nav.width;
    for (const s of doc!.slots) {
      const idx = (s.rect.y + s.spawnCell.y) * W + s.spawnCell.x;
      expect(nav.blocked[idx]).toBe(0);
      expect(inSlotRect(doc!, s.slot, s.spawnCell.x, s.rect.y + s.spawnCell.y)).toBe(true);
      expect(s.spawnPx.x).toBe(s.spawnCell.x * 100 + 50);
    }
  });

  it('槽位互不重叠', () => {
    const seen = new Set<string>();
    for (const s of doc!.slots) {
      const key = `${s.rect.x},${s.rect.y},${s.rect.w},${s.rect.h}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('归属校验（服务端隔离）', () => {
  it('玩家序号 -> 槽位一一对应', () => {
    const a = slotOfPlayer(doc!, 1)!;
    const b = slotOfPlayer(doc!, 2)!;
    expect(a.slot).not.toBe(b.slot);
    expect(a.slot).toBe(0);
    expect(b.slot).toBe(1);
  });

  it('序号超出槽位数时回绕到最后一槽（不崩）', () => {
    const over = slotOfPlayer(doc!, doc!.slots.length + 5)!;
    expect(over.slot).toBe(doc!.slots.length - 1);
  });

  it('自家槽内放行', () => {
    const s = slotOfPlayer(doc!, 3)!;
    const gx = s.spawnCell.x, gy = s.rect.y + s.spawnCell.y;
    expect(homeSlotViolation(doc!, 3, gx, gy)).toBeNull();
  });

  it('进别人家被拒，且文案点名槽位', () => {
    const mine = slotOfPlayer(doc!, 1)!;
    const other = slotOfPlayer(doc!, 2)!;
    const msg = homeSlotViolation(doc!, 1, other.spawnCell.x, other.rect.y + other.spawnCell.y);
    expect(msg).toBeTruthy();
    expect(msg).toContain('别人的家门口');
    expect(msg).toContain(`槽 ${mine.slot + 1}`);
  });

  it('槽外坐标被拒（不是任何人的家）', () => {
    const msg = homeSlotViolation(doc!, 1, 14, 999);
    expect(msg).toContain('不在任何家门口槽内');
  });

  it('无槽位表时一律放行（单人老档不阻塞）', () => {
    expect(homeSlotViolation(null, 1, 999, 999)).toBeNull();
    expect(homeSpawnPx(null, 1)).toBeNull();
  });

  it('像素换算：spawnPx 与格坐标一致', () => {
    const s = slotOfPlayer(doc!, 2)!;
    const px = homeSpawnPx(doc!, 2)!;
    expect(px.x).toBe(s.spawnPx.x);
    expect(Math.floor(px.y / 100)).toBe(s.rect.y + s.spawnCell.y);
  });
});