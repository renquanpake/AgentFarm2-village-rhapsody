// test/unit/save-key-registry.test.ts —— 存档键注册表审计 + 幽灵桶回归
// 事故：未注册的 world/globals 键被 importSave 判成玩家私有键，uid 切成空串，
// 落进 uid='' 幽灵桶 —— 重启即丢（afDayAnchor/fitnessData/staminaData 实测存档已中招）。
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldState, WORLD_KEYS, GLOBAL_KEYS } from '../../src/persistence/state.ts';
import { auditSaveKeys } from '../../src/persistence/save-keys.ts';

const SRC = new URL('../../src', import.meta.url).pathname;

function state(): WorldState {
  const dir = mkdtempSync(join(tmpdir(), 'af-savekey-'));
  return new WorldState({ savesDir: dir, seedFile: '', slot: 99, farmLeft: 0, spawns: null, growDayMs: 600000 });
}

describe('存档键审计门', () => {
  it('源码里所有 world/globals 写入键都已登记（缺一判死）', () => {
    const r = auditSaveKeys(SRC);
    expect(r.missing.map(m => `${m.bucket}:${m.key} @ ${m.at}`)).toEqual([]);
    // 抽查历史上中招的键，确保在册
    for (const k of ['fitnessData', 'staminaData', 'facilityData', 'afStalls', 'gossipData']) expect(WORLD_KEYS.has(k)).toBe(true);
    for (const k of ['afDayAnchor', 'afLastGameDay', 'afLastStorm']) expect(GLOBAL_KEYS.has(k)).toBe(true);
  });

  it('审计器能识别未登记键（自检：造一个未注册的写入点）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-savekey-src-'));
    mkdirSync(join(dir, 'world'), { recursive: true });
    writeFileSync(join(dir, 'world', 'x.ts'), "state.world.set('zzzStrayKey', v);\nconst KEY = 'zzzConstKey';\nstate.world.set(KEY, v);\n");
    const r = auditSaveKeys(dir);
    expect(r.missing.map(m => m.key).sort()).toEqual(['zzzConstKey', 'zzzStrayKey']);
  });
});

describe('importSave 桶归位', () => {
  it('已注册的世界/全局键回到对应桶，且不产生 uid="" 幽灵桶', () => {
    const st = state();
    st.importSave({ version: 4, datas: [
      { key: 'fitnessData', val: { u1: { attrs: { strength: 3 } } } },
      { key: 'staminaData', val: { u1: { fishAt: 111 } } },
      { key: 'afDayAnchor', val: { val: 999 } },
      { key: 'afLastStorm', val: { val: { day: 3, victims: 1 } } },
      { key: 'knapData_u871b1de2ec59', val: { props: [{ id: 1, num: 50 }] } },
    ] } as never);
    expect(st.world.get('fitnessData')).toEqual({ u1: { attrs: { strength: 3 } } });
    expect(st.world.get('staminaData')).toEqual({ u1: { fishAt: 111 } });
    expect(st.globals.get('afDayAnchor')).toEqual({ val: 999 });
    expect(st.globals.get('afLastStorm')).toEqual({ val: { day: 3, victims: 1 } });
    expect(st.playersDb.has('')).toBe(false);
    expect(st.playersDb.get('u871b1de2ec59')?.get('knapData')).toEqual({ props: [{ id: 1, num: 50 }] });
  });

  it('未登记的无主键被丢弃并留痕（不进幽灵桶）', () => {
    const st = state();
    st.importSave({ version: 4, datas: [{ key: 'zzzUnknownWorldKey', val: { x: 1 } }] } as never);
    expect(st.playersDb.has('')).toBe(false);
    expect(st.world.has('zzzUnknownWorldKey')).toBe(false);
    expect(st.globals.has('zzzUnknownWorldKey')).toBe(false);
  });

  it('历史污染存档：幽灵桶数据被搬回注册表桶并清空幽灵桶', () => {
    const st = state();
    st.playersDb.set('', new Map<string, unknown>([
      ['fitnessData', { u1: { attrs: { agility: 7 } } }],
      ['staminaData', { u1: { mineAt: 42 } }],
      ['afLastGameDay', { val: 12 }],
    ]));
    st.repairStrayBuckets();
    expect(st.playersDb.has('')).toBe(false);
    expect(st.world.get('fitnessData')).toEqual({ u1: { attrs: { agility: 7 } } });
    expect(st.world.get('staminaData')).toEqual({ u1: { mineAt: 42 } });
    expect(st.globals.get('afLastGameDay')).toEqual({ val: 12 });
  });
});