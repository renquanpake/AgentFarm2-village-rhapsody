// test/unit/economy-gates.test.ts —— 经济钩子冻结闸（M-B1 影子窗）
// 事故：buildings.json hooks 与文档声明「开摊费关至 M-B1」，但 act stall 无闸，
// 节日当天任何玩家都能真扣金币 —— 实现与声明相反（2026-10-03 修）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { economyHookEnabled, economyHookFrozenMsg, economyHookStatus, ECONOMY_HOOKS } from '../../src/world/economy-gates.ts';

describe('经济钩子冻结闸', () => {
  it('缺省全冻结（与文档声明一致）', () => {
    for (const h of ECONOMY_HOOKS) expect(economyHookEnabled(h, {})).toBe(false);
  });

  it('按钩子粒度解冻：AF_ECON_HOOKS=stall 只开开摊', () => {
    const env = { AF_ECON_HOOKS: 'stall' };
    expect(economyHookEnabled('stall', env)).toBe(true);
    expect(economyHookEnabled('interest', env)).toBe(false);
    expect(economyHookEnabled('insurance', env)).toBe(false);
    expect(economyHookEnabled('matching', env)).toBe(false);
  });

  it('逗号列表与 * 全开；空白项忽略', () => {
    const env = { AF_ECON_HOOKS: 'stall, interest ,' };
    expect(economyHookEnabled('stall', env)).toBe(true);
    expect(economyHookEnabled('interest', env)).toBe(true);
    expect(economyHookEnabled('matching', env)).toBe(false);
    expect(economyHookEnabled('matching', { AF_ECON_HOOKS: '*' })).toBe(true);
    expect(economyHookEnabled('stall', { AF_ECON_HOOKS: '' })).toBe(false);
  });

  it('状态快照覆盖四类钩子', () => {
    const st = economyHookStatus({ AF_ECON_HOOKS: 'stall' });
    expect(Object.keys(st).sort()).toEqual([...ECONOMY_HOOKS].sort());
    expect(st.stall).toBe(true);
    expect(st.matching).toBe(false);
  });

  it('冻结话术点名解冻方式（文案即契约）', () => {
    const m = economyHookFrozenMsg('stall', '集市开摊');
    expect(m).toContain('集市开摊');
    expect(m).toContain('AF_ECON_HOOKS');
    expect(m).toContain('M-B1');
  });

  it('ws.ts act stall 真的过闸（源码级锁定，防旁路）', () => {
    const src = readFileSync(new URL('../../src/gateway/ws.ts', import.meta.url), 'utf8');
    expect(src).toContain("economyHookEnabled('stall')");
    // 闸必须在扣费之前
    const gate = src.indexOf("economyHookEnabled('stall')");
    const charge = src.indexOf('const fee = stallFee(app);');
    expect(gate).toBeGreaterThan(-1);
    expect(charge).toBeGreaterThan(gate);
  });
});