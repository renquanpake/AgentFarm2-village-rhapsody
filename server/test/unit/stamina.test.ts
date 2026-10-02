// test/unit/stamina.test.ts —— 采集冷却门（fish/mine 防无限刷）
// 背景：fish/mine 只有位置门+工具门，脚本可原地无限产出冲击 10% 手续费的通缩回收。
// 修法与 train 冷却同构：动作门 + waitSec。
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { gate, FISH_COOLDOWN_MS, MINE_COOLDOWN_MS, waitSecOf } from '../../src/world/stamina.ts';

const dirs: string[] = [];
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-stamina-'));
  dirs.push(dir);
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 56, spawns: null, growDayMs: 1000, init: false };
  return new WorldState(opts);
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

describe('采集冷却门', () => {
  it('首次放行，冷却内拒绝并带剩余秒数', () => {
    const state = harness();
    const t0 = 1_000_000;
    expect(gate(state, 'u1', 'fish', FISH_COOLDOWN_MS, t0).ok).toBe(true);
    const g = gate(state, 'u1', 'fish', FISH_COOLDOWN_MS, t0 + 10_000);
    expect(g.ok).toBe(false);
    expect(g.waitSec).toBe(Math.ceil((FISH_COOLDOWN_MS - 10_000) / 1000));
  });

  it('冷却期满再次放行，并刷新计时', () => {
    const state = harness();
    const t0 = 1_000_000;
    gate(state, 'u1', 'mine', MINE_COOLDOWN_MS, t0);
    expect(gate(state, 'u1', 'mine', MINE_COOLDOWN_MS, t0 + MINE_COOLDOWN_MS).ok).toBe(true);
    // 刷新后再立刻挖 -> 拒绝
    expect(gate(state, 'u1', 'mine', MINE_COOLDOWN_MS, t0 + MINE_COOLDOWN_MS + 1).ok).toBe(false);
  });

  it('钓鱼与挖矿冷却互不影响', () => {
    const state = harness();
    const t0 = 2_000_000;
    gate(state, 'u1', 'fish', FISH_COOLDOWN_MS, t0);
    expect(gate(state, 'u1', 'mine', MINE_COOLDOWN_MS, t0 + 1).ok).toBe(true);
    expect(gate(state, 'u1', 'fish', FISH_COOLDOWN_MS, t0 + 2).ok).toBe(false);
  });

  it('不同玩家互不影响', () => {
    const state = harness();
    const t0 = 3_000_000;
    gate(state, 'u1', 'fish', FISH_COOLDOWN_MS, t0);
    expect(gate(state, 'u2', 'fish', FISH_COOLDOWN_MS, t0 + 1).ok).toBe(true);
  });

  it('waitSecOf 无记录时为 0，冷却中为剩余秒', () => {
    const state = harness();
    const t0 = 4_000_000;
    expect(waitSecOf(state, 'u1', 'fish', FISH_COOLDOWN_MS, t0)).toBe(0);
    gate(state, 'u1', 'fish', FISH_COOLDOWN_MS, t0);
    expect(waitSecOf(state, 'u1', 'fish', FISH_COOLDOWN_MS, t0 + 5_000)).toBe(Math.ceil((FISH_COOLDOWN_MS - 5_000) / 1000));
  });
});