// test/unit/fitness.test.ts —— P2 健身房：属性训练 + 冷却（world/fitness.ts）
import { describe, it, expect } from 'vitest';
import type { App } from '../../src/app.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { Tables } from '../../src/world/tables.ts';
import { GYM_ATTRS, TRAIN_COOLDOWN_MS, fitnessOf, normalizeGymAttr, trainAttr } from '../../src/world/fitness.ts';

function harness() {
  const tables = new Tables('data');
  const state = new WorldState({ savesDir: '', seedFile: '', slot: 99, farmLeft: 14, spawns: null, growDayMs: 600_000, init: false } as StateOpts);
  const app = { state, tables } as unknown as App;
  return { app, state };
}

const T0 = 1_700_000_000_000; // 现实量级时间戳（lastTrainAt 按 Date.now() 语义比较）

describe('fitness 训练', () => {
  it('GYM_ATTRS 三属性', () => {
    expect(GYM_ATTRS).toEqual(['strength', 'agility', 'charisma']);
  });

  it('训练 +1 并累计', () => {
    const { state } = harness();
    const r1 = trainAttr(state, 'u1', 'strength', T0);
    expect(r1.ok).toBe(true);
    expect(r1.level).toBe(1);
    const r2 = trainAttr(state, 'u1', 'strength', T0 + TRAIN_COOLDOWN_MS);
    expect(r2.ok).toBe(true);
    expect(r2.level).toBe(2);
    const r3 = trainAttr(state, 'u1', 'charisma', T0 + 2 * TRAIN_COOLDOWN_MS);
    expect(r3.ok).toBe(true);
    expect(r3.level).toBe(1);
    const rec = fitnessOf(state, 'u1');
    expect(rec.attrs.strength).toBe(2);
    expect(rec.attrs.charisma).toBe(1);
  });

  it('冷却内拒绝并给 waitSec', () => {
    const { state } = harness();
    expect(trainAttr(state, 'u2', 'agility', T0).ok).toBe(true);
    const r = trainAttr(state, 'u2', 'agility', T0 + TRAIN_COOLDOWN_MS - 1000);
    expect(r.ok).toBe(false);
    expect(r.waitSec).toBe(1);
  });

  it('冷却恰好到期可再训', () => {
    const { state } = harness();
    trainAttr(state, 'u3', 'strength', T0);
    const r = trainAttr(state, 'u3', 'strength', T0 + TRAIN_COOLDOWN_MS);
    expect(r.ok).toBe(true);
  });

  it('未知属性拒绝', () => {
    const { state } = harness();
    const r = trainAttr(state, 'u4', 'luck', T0);
    expect(r.ok).toBe(false);
  });

  it('不同 uid 状态隔离', () => {
    const { state } = harness();
    trainAttr(state, 'a', 'strength', T0);
    trainAttr(state, 'b', 'agility', T0);
    expect(fitnessOf(state, 'a').attrs.strength).toBe(1);
    expect(fitnessOf(state, 'a').attrs.agility).toBeUndefined();
    expect(fitnessOf(state, 'b').attrs.agility).toBe(1);
  });
});

// P2：welcome 文案与报错文案都写 `train {attr:力量/敏捷/亲和}`，实现却只收英文键，
// 玩家照提示发中文必然被拒。normalizeGymAttr 把中文名/常见同义词归一到内部键。
describe('fitness 属性别名', () => {
  it('英文键原样通过（含大小写与空白）', () => {
    expect(normalizeGymAttr('strength')).toBe('strength');
    expect(normalizeGymAttr('agility')).toBe('agility');
    expect(normalizeGymAttr('Charisma')).toBe('charisma');
    expect(normalizeGymAttr('  strength  ')).toBe('strength');
  });

  it('中文名归一到对应键', () => {
    expect(normalizeGymAttr('力量')).toBe('strength');
    expect(normalizeGymAttr('敏捷')).toBe('agility');
    expect(normalizeGymAttr('亲和')).toBe('charisma');
    expect(normalizeGymAttr(' 力量 ')).toBe('strength');
  });

  it('未公示的同义词不认（不擅自扩契约）', () => {
    expect(normalizeGymAttr('力气')).toBeNull();
    expect(normalizeGymAttr('魅力')).toBeNull();
    expect(normalizeGymAttr('力量训练')).toBeNull();
  });

  it('无法识别返回 null', () => {
    expect(normalizeGymAttr('')).toBeNull();
    expect(normalizeGymAttr('   ')).toBeNull();
    expect(normalizeGymAttr('luck')).toBeNull();
    expect(normalizeGymAttr('力量值')).toBeNull();
  });

  it('中文名训练真的生效（+1 且落正确键）', () => {
    const { state } = harness();
    const r = trainAttr(state, 'u5', '力量', T0);
    expect(r.ok).toBe(true);
    expect(r.level).toBe(1);
    expect(fitnessOf(state, 'u5').attrs.strength).toBe(1);
    expect(fitnessOf(state, 'u5').attrs.agility).toBeUndefined();
  });

  it('中文名与英文键走同一冷却池', () => {
    const { state } = harness();
    expect(trainAttr(state, 'u6', '敏捷', T0).ok).toBe(true);
    const r = trainAttr(state, 'u6', 'agility', T0 + 1000);
    expect(r.ok).toBe(false);
    expect(r.waitSec).toBeGreaterThan(0);
  });

  it('报错文案同时给中文名与英文键', () => {
    const { state } = harness();
    const r = trainAttr(state, 'u7', '运气', T0);
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('力量/strength');
    expect(r.msg).toContain('敏捷/agility');
    expect(r.msg).toContain('亲和/charisma');
  });
});
