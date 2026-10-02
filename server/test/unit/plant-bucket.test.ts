// test/unit/plant-bucket.test.ts —— 世界植物桶归位 VILLAGE_MAP（原版 GD.SceneType=2）
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { worldPlants, worldPlots, plantAtWorld, cropAtWorld, WORLD_SCENE_TYPE, PLOT_SCENE_TYPE, treeOf } from '../../src/world/farm.ts';

const dirs: string[] = [];
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-pb-'));
  dirs.push(dir);
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 56, spawns: null, growDayMs: 1000, init: false };
  const state = new WorldState(opts);
  return { dir, state };
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

const plant = (uId: number, x: number, y: number, plantId: number, farmType = 2) => ({ uId, x, y, plantId, hp: 10, farmType, growDay: 0 });

describe('世界植物桶 = VILLAGE_MAP(2)', () => {
  it('读 sceneType=2 桶，不读 HOME_MAP(1) 的场景装饰', () => {
    const h = harness();
    h.state.world.set('plantData', {
      datas: [
        { sceneType: 3, plants: [plant(1, 60, 60, 19)] },
        { sceneType: 2, plants: [plant(151, 100, 100, 19), plant(152, 101, 100, 3)] },
        { sceneType: 1, plants: [plant(1064, 60, 60, 19), plant(1065, 61, 60, 18)] },
      ],
    });
    const w = worldPlants(h.state);
    expect(w.map(p => p.uId)).toEqual([151, 152]);
    expect(w.filter(p => treeOf(p)).length).toBe(1);
  });

  it('空存档时按 VILLAGE_MAP 建桶', () => {
    const h = harness();
    const w = worldPlants(h.state);
    expect(w).toEqual([]);
    const pd = h.state.world.get('plantData') as { datas: Array<{ sceneType: number }> };
    expect(pd.datas.map(d => d.sceneType)).toContain(WORLD_SCENE_TYPE);
    expect(WORLD_SCENE_TYPE).toBe(2);
  });

  it('农田仍读 HOME_MAP(1) 桶（原版 plotDatas 位置）', () => {
    const h = harness();
    h.state.world.set('farmData', { plotDatas: [{ sceneType: 1, plots: [{ x: 69, y: 71, plantUID: 0, farmType: 1, owner: 'u1' }] }] });
    const p = worldPlots(h.state);
    expect(p.length).toBe(1);
    expect(PLOT_SCENE_TYPE).toBe(1);
  });
});

describe('玩家作物桶归位迁移', () => {
  it('搬 farmType=1 到村庄桶、重发冲突 uId、改写地块引用、留装饰', () => {
    const h = harness();
    // 村庄桶 uId 含 1365；HOME_MAP 的玩家作物也是 1365（slot94 实测的跨桶重号）
    h.state.world.set('plantData', {
      datas: [
        { sceneType: 3, plants: [] },
        { sceneType: 2, plants: [plant(151, 100, 100, 19), plant(1365, 101, 100, 3), plant(1473, 102, 100, 17)] },
        { sceneType: 1, plants: [plant(1064, 81, 81, 7), plant(1365, 81, 81, 1, 1)] },
      ],
    });
    h.state.world.set('farmData', { plotDatas: [{ sceneType: 1, plots: [{ x: 81, y: 81, plantUID: 1365, farmType: 1, owner: 'u1' }] }] });

    h.state.migratePlantBucket();

    const vil = (h.state.world.get('plantData') as { datas: Array<{ sceneType: number; plants: Array<{ uId: number; farmType: number }> }> }).datas.find(d => d.sceneType === 2)!;
    const home = (h.state.world.get('plantData') as { datas: Array<{ sceneType: number; plants: Array<{ uId: number; farmType: number }> }> }).datas.find(d => d.sceneType === 1)!;

    // 作物已进村庄桶，且拿到不冲突的新 uId
    const crops = vil.plants.filter(p => p.farmType === 1);
    expect(crops.length).toBe(1);
    expect(crops[0].uId).toBe(1474);
    expect(vil.plants.filter(p => p.uId === 1365).length).toBe(1); // 装饰那株保持 1365
    // uId 在村庄桶内唯一
    expect(new Set(vil.plants.map(p => p.uId)).size).toBe(vil.plants.length);
    // HOME_MAP 只剩装饰
    expect(home.plants.map(p => p.uId)).toEqual([1064]);
    // 地块引用跟随新 uId
    const plot = worldPlots(h.state)[0];
    expect(plot.plantUID).toBe(1474);
    // worldPlants 现在能看到这株作物
    expect(worldPlants(h.state).filter(p => p.farmType === 1).length).toBe(1);
    // 迁移标记已落 globals（保证重启不重复执行）
    expect((h.state.globals.get('afPlantBucketVillage') as { val?: number } | undefined)?.val).toBe(1);
  });

  it('幂等：无作物时不动数据，重复执行结果一致', () => {
    const h = harness();
    h.state.world.set('plantData', { datas: [{ sceneType: 2, plants: [plant(151, 100, 100, 19)] }, { sceneType: 1, plants: [plant(1064, 60, 60, 7)] }] });
    const before = JSON.stringify((h.state.world.get('plantData') as { datas: unknown }).datas);
    h.state.migratePlantBucket();
    h.state.migratePlantBucket();
    expect(JSON.stringify((h.state.world.get('plantData') as { datas: unknown }).datas)).toBe(before);
  });
});
describe('同格并存：场景装饰 + 玩家作物', () => {
  it('plantAtWorld 判占位，cropAtWorld 优先返回作物', () => {
    const h = harness();
    // 村庄桶数组顺序：装饰株在前（索引 257 实测），迁移来的作物追加在后
    h.state.world.set('plantData', {
      datas: [
        { sceneType: 2, plants: [plant(408, 81, 81, 1, 2), plant(1474, 81, 81, 1, 1)] },
        { sceneType: 1, plants: [] },
      ],
    });
    expect(plantAtWorld(h.state, 81, 81)!.farmType).toBe(2);
    expect(cropAtWorld(h.state, 81, 81)!.uId).toBe(1474);
    expect(cropAtWorld(h.state, 81, 81)!.farmType).toBe(1);
  });

  it('只有装饰株时回退场景株（保留"场景植物"提示路径）', () => {
    const h = harness();
    h.state.world.set('plantData', { datas: [{ sceneType: 2, plants: [plant(408, 81, 81, 1, 2)] }] });
    expect(cropAtWorld(h.state, 81, 81)!.farmType).toBe(2);
  });

  it('空坐标两者都返回 undefined', () => {
    const h = harness();
    h.state.world.set('plantData', { datas: [{ sceneType: 2, plants: [plant(408, 81, 81, 1, 2)] }] });
    expect(plantAtWorld(h.state, 90, 90)).toBeUndefined();
    expect(cropAtWorld(h.state, 90, 90)).toBeUndefined();
  });
});
