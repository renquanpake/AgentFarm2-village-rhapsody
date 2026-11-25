// world/quality.ts —— 收获品质（M12 品质系统）
//
// 设计（学习自 Stardew 品质模型，改造为确定性可重放）：
//   收获时 roll 品质：普通 60% / 银 30% / 金 10%。
//   种子 = hash(uid, uId, growDayMs 对齐的游戏日) —— 同事件流重放必得同品质（回放确定性）。
//   品质产出：金 = 额外 +1 产物（2x）；银 = 50% 额外 +1（roll 第二 bit）。
//   品质只影响产出数量，不新增物品 id（items.json 封闭体系，改 id 会断原版渲染）。
//   事件流：crop.harvested 带 quality 字段，observe/日报可消费。
import type { WorldState } from '../persistence/state.ts';

export type Quality = 'normal' | 'silver' | 'gold';

/** FNV-1a 32 位（确定性字符串 hash） */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 收获品质 roll（纯函数，确定性）：种子 = uid + uId + 游戏日 */
export function rollQuality(uid: string, uId: number, gameDay = Math.floor(Date.now() / 86_400_000)): { quality: Quality; bonus: number } {
  const h = fnv1a(`${uid}|${uId}|${gameDay}`);
  const r = h / 0xffffffff; // [0,1)
  if (r < 0.10) return { quality: 'gold', bonus: 1 };       // 金：必额外 +1
  if (r < 0.40) {                                          // 银：[0.10,0.40)
    const r2 = ((h >>> 8) & 0xff) / 0xff;
    return { quality: 'silver', bonus: r2 < 0.5 ? 1 : 0 };   // 银：50% 额外 +1
  }
  return { quality: 'normal', bonus: 0 };
}

/** 品质中文标签 */
export const QUALITY_CN: Record<Quality, string> = { normal: '普通', silver: '银', gold: '金' };

/** 品质售价倍率（NPC 收购与订单簿参考用；金 1.5x / 银 1.25x） */
export const QUALITY_MUL: Record<Quality, number> = { normal: 1, silver: 1.25, gold: 1.5 };

/** 收获结算：给定基础产量 1，返回 (品质, 实际入包数量) */
export function harvestYield(state: WorldState, uid: string, uId: number): { quality: Quality; qty: number } {
  const day = state.growDayMsValue ? Math.floor(Date.now() / state.growDayMsValue()) : 0;
  const { quality, bonus } = rollQuality(uid, uId, day);
  return { quality, qty: 1 + bonus };
}