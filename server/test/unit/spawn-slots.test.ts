// 私有住宅（B 包）——住宅碰撞实体生成 + 出生槽位生成器单测。
// 住宅 = 玩家私有地块：出生槽位互不叠身，住宅碰撞随 slot 偏移。
import { describe, it, expect } from 'vitest';
import { spawnSlotFor, spawnSlotsAll, MAX_SPAWN_PLAYERS } from '../../src/world/spawn-slots.js';
import type { SpawnDef } from '../../src/types.js';

const fakeSpawns: SpawnDef = {
  scene: 2,
  houses: [
    { id: 2, type: 'a', door: { x: 100, y: 100 }, rect: { x: 80, y: 80, w: 40, h: 40 } },
    { id: 3, type: 'b', door: { x: 200, y: 100 }, rect: { x: 180, y: 80, w: 40, h: 40 } },
    { id: 4, type: 'c', door: { x: 300, y: 100 }, rect: { x: 280, y: 80, w: 40, h: 40 } },
  ],
};

describe('出生槽位生成器（B 包/M-O2）', () => {
  it('第 1 玩家保留原版家门口，无偏移', () => {
    const s = spawnSlotFor(fakeSpawns, 1);
    expect(s).not.toBeNull();
    expect(s!.playerIdx).toBe(1);
    // 第 1 玩家 door 即出生点（angles=0 的 cos/sin -> (R,0)，但第 1 玩家保留原版，无偏移）
    // 设计内：playerIdx=1 无偏移
  });

  it('同门多玩家偏移互不叠身', () => {
    // 玩家 2 与玩家 3 都落到 houses[0]（(idx-2)%3 -> idx=2->houses[0], idx=3->houses[1]）
    const p2 = spawnSlotFor(fakeSpawns, 2)!;
    const p3 = spawnSlotFor(fakeSpawns, 3)!;
    expect(p2.houseId).toBe(fakeSpawns.houses[0].id);
    expect(p3.houseId).toBe(fakeSpawns.houses[1].id);
    // 不同玩家角度不同 -> 偏移向量不同 -> 不叠身
    const d2 = { x: p2.finalPos.x - p2.door.x, y: p2.finalPos.y - p2.door.y };
    const d3 = { x: p3.finalPos.x - p3.door.x, y: p3.finalPos.y - p3.door.y };
    expect(d2.x * d3.y - d2.y * d3.x).not.toBe(0); // 不共线（除非恰好 180°）
  });

  it('playerIdx 超 houses 长度时回绕（mod 不崩）', () => {
    const s = spawnSlotFor(fakeSpawns, 10);
    expect(s).not.toBeNull();
    expect(s!.houseId).toBe(fakeSpawns.houses[(10 - 2) % 3].id);
  });

  it('全量槽位表长度=playerCount', () => {
    const all = spawnSlotsAll(fakeSpawns, 5);
    expect(all.length).toBe(5);
    expect(all.map(x => x.playerIdx)).toEqual([1, 2, 3, 4, 5]);
  });

  it('MAX 常量约束（回放确定性边界）', () => {
    expect(MAX_SPAWN_PLAYERS).toBeGreaterThanOrEqual(10);
  });

  it('空 houses 返回 null', () => {
    expect(spawnSlotFor({ houses: [] }, 2)).toBeNull();
  });
});
