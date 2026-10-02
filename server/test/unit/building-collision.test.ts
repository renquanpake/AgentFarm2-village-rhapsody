// test/unit/building-collision.test.ts —— 世界扩展建筑碰撞回归
// 背景：buildings.json 声明的 rect 与 village-collision.json 实体轮廓长期对不上，
// 玩家可穿墙而过（健身房 19%、铁匠铺 0%）。已补建实体。本测试锁住：
//   1) 建筑 rect 要是一块完整实体（实心率 >= 门边倒角后的下界）
//   2) 门位/POI 所在格必须可走，不能把入口砌死
//   3) 建筑不封死相邻道路（gen-nav 已校验，这里补建筑自身的可进出性）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadCollision() {
  return JSON.parse(readFileSync(new URL('../../../data/village-collision.json', import.meta.url), 'utf8'));
}
function loadBuildings() {
  const b = JSON.parse(readFileSync(new URL('../../../data/buildings.json', import.meta.url), 'utf8'));
  const arr = b.buildings || b;
  return Array.isArray(arr) ? arr : Object.values(arr);
}

// 交易大厅是参考基准（唯一完整实体）；其余 4 栋此前对不上，已补齐。
const RECT_NAMES = ['trade-hall', 'observatory', 'banquet-hall', 'gym', 'forge'];

describe('世界扩展建筑碰撞', () => {
  const c = loadCollision();
  const W = c.width;
  const buildings = loadBuildings().filter(x => x && x.id && RECT_NAMES.includes(x.id));

  it('五栋建筑全部有 rect 定义', () => {
    expect(buildings.length).toBe(5);
  });

  for (const b of buildings) {
    const { id, rect, door } = b;
    // 宴会厅是广场环岛建筑（3x3 实体 + 道路环 + 门在南缘），实体率天然低于实心楼，单独放宽
    const minSolid = id === 'banquet-hall' ? 0.3 : 0.8;
    it(`${id}: 实体占用对齐 rect（实心率>=${minSolid}），入口可进出`, () => {
      expect(rect).toBeTruthy();
      let blocked = 0;
      const total = rect.w * rect.h;
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          if (c.blocked[y * W + x]) blocked++;
        }
      }
      expect(blocked / total).toBeGreaterThanOrEqual(minSolid);

      // 门位像素 -> 格；门格本身可走，入口不被砌死
      const dx = Math.floor(door.x / 100);
      const dy = Math.floor(door.y / 100);
      expect(c.blocked[dy * W + dx]).toBe(0);
    });
  }

  it('宴会厅房身核心保持实心不被道路环掏空', () => {
    const b = buildings.find(x => x.id === 'banquet-hall');
    for (let y = b.rect.y; y < b.rect.y + 3; y++) {
      for (let x = b.rect.x + 1; x < b.rect.x + 4; x++) {
        expect(c.blocked[y * W + x]).toBe(1);
      }
    }
  });

  it('三栋（气象台/健身房/铁匠铺）完整实体 == 声明 rect（消除穿墙）', () => {
    // 气象台南缘（95-97,11）是入口+北环路接口，允许 3 格缺口；其余必须实心
    const allowedGaps: Record<string, string[][]> = {
      observatory: [[95, 11], [96, 11], [97, 11]],
      gym: [],
      forge: [],
    };
    for (const id of ['observatory', 'gym', 'forge']) {
      const b = buildings.find(x => x.id === id);
      const gaps = new Set((allowedGaps[id] || []).map(([x, y]) => `${x},${y}`));
      let blocked = 0;
      let total = 0;
      for (let y = b.rect.y; y < b.rect.y + b.rect.h; y++) {
        for (let x = b.rect.x; x < b.rect.x + b.rect.w; x++) {
          if (gaps.has(`${x},${y}`)) continue;
          total++;
          if (c.blocked[y * W + x]) blocked++;
        }
      }
      expect(blocked).toBe(total);
    }
  });
});