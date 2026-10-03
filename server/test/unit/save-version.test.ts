// test/unit/save-version.test.ts —— N11 存档版本化与迁移注册表
// 事故：`persist()` 写死 version:4 而 importSave 从不读版本号 → 版本号是死值；
// 三个历史迁移散装在构造函数里，没有顺序/区间/回归手段。
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldState } from '../../src/persistence/state.ts';
import { SAVE_VERSION, SAVE_VERSION_KEY, MIGRATIONS, runMigrations, saveVersionOf, migrationPlan } from '../../src/persistence/save-version.ts';

function state(): WorldState {
  const dir = mkdtempSync(join(tmpdir(), 'af-ver-'));
  return new WorldState({ savesDir: dir, seedFile: '', slot: 98, farmLeft: 0, spawns: null, growDayMs: 600000 });
}

/** 构造出一份「老版本档」：抹掉版本号与全部迁移 flag（模拟线上 v1-v4 存档） */
function oldSave(v = 1): WorldState {
  const s = state();
  s.globals.delete(SAVE_VERSION_KEY);
  for (const m of MIGRATIONS) s.globals.delete(m.flag);
  return s;
}

describe('迁移注册表', () => {
  it('每条迁移声明合法版本区间且区间不重叠', () => {
    const sorted = [...MIGRATIONS].sort((a, b) => a.from - b.from);
    for (const m of MIGRATIONS) {
      expect(m.from).toBeLessThan(m.to);
      expect(m.flag).toMatch(/^af[A-Za-z]+$/);
      expect(m.describe.length).toBeGreaterThan(4);
    }
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].from).toBeGreaterThanOrEqual(sorted[i - 1].to);
    expect(MIGRATIONS[MIGRATIONS.length - 1].to).toBe(SAVE_VERSION);
  });

  it('v1 老档补齐：三条迁移按序应用并写版本号', () => {
    const s = oldSave(1);
    const r = runMigrations(s, 1, () => {});
    expect(r.applied).toEqual(['coord-shift', 'plant-bucket-village', 'stray-bucket-repair']);
    expect(saveVersionOf(s)).toBe(SAVE_VERSION);
    expect((s.globals.get(SAVE_VERSION_KEY) as { val: number }).val).toBe(SAVE_VERSION);
  });

  it('幂等：重复调用不再应用（flag 已置位）', () => {
    const s = oldSave(1);
    runMigrations(s, 1, () => {});
    const again = runMigrations(s, 1, () => {});
    expect(again.applied).toEqual([]);
    expect(again.skipped.length).toBeGreaterThanOrEqual(3);
  });

  it('版本区间外的迁移跳过（v4 档只补幽灵桶）', () => {
    const s = oldSave(4);
    const r = runMigrations(s, 4, () => {});
    expect(r.applied).toEqual(['stray-bucket-repair']);
  });

  it('迁移真的修数据：幽灵桶数据归位', () => {
    const s = oldSave(4);
    s.playersDb.set('', new Map<string, unknown>([['afDayAnchor', { val: 123 }]]));
    runMigrations(s, 4, () => {});
    expect(s.playersDb.has('')).toBe(false);
    expect(s.globals.get('afDayAnchor')).toEqual({ val: 123 });
  });

  it('版本读取优先级：globals 标记 > 文档 version > v1', () => {
    const s = oldSave(1);
    expect(saveVersionOf(s)).toBe(1);
    expect(saveVersionOf(s, 4)).toBe(4);
    s.globals.set(SAVE_VERSION_KEY, { val: 5 });
    expect(saveVersionOf(s, 4)).toBe(5);
  });

  it('构造即自动补迁移（启动路径无需调用方干预）', () => {
    const s = state();
    expect(saveVersionOf(s)).toBe(SAVE_VERSION);
  });

  it('迁移计划只列待补项', () => {
    expect(migrationPlan(1).filter(m => m.needed).map(m => m.id)).toEqual(['coord-shift', 'plant-bucket-village', 'stray-bucket-repair']);
    expect(migrationPlan(SAVE_VERSION).filter(m => m.needed)).toEqual([]);
  });
});