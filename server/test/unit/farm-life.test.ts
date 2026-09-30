// test/unit/farm-life.test.ts —— B9 畜牧 + 烹饪加工
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from '../../src/app.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog } from '../../src/persistence/events.ts';
import { Tables } from '../../src/world/tables.ts';
import { knapAdd } from '../../src/world/farm.ts';
import { adoptAnimal, worldAnimals, feedAnimal, petAnimal, produceFromAnimals, growLivestock, ANIMALS } from '../../src/world/livestock.ts';
import { cook, buildFacility, outputPrice, RECIPES } from '../../src/world/cooking.ts';

const dirs: string[] = [];
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-fl-'));
  dirs.push(dir);
  const tables = new Tables(path.join(dir, 'data'));
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 1000, init: false };
  const state = new WorldState(opts);
  const db = openDb(path.join(dir, 'events.db'));
  const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
  log.init();
  log.takeSnapshot();
  const app = { state, tables, db, log } as unknown as App;
  return { dir, app, state, db, log, tables, opts };
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

const pm = (state: WorldState, uid: string) => {
  if (!state.playersDb.has(uid)) state.playersDb.set(uid, new Map());
  return state.playersDb.get(uid)!;
};

describe('畜牧', () => {
  it('领养 -> 生长 -> 成年产出（品质受饱食+心情）', () => {
    const h = harness();
    const r = adoptAnimal(h.state, h.tables, 'u1', 3, 550, 550, 0);
    expect(r.ok).toBe(true);
    const a = worldAnimals(h.state)[0];
    expect(a.animalId).toBe(3);
    knapAdd(pm(h.state, 'u1'), ANIMALS[3].feedItemId, 2); // 备足食物
    for (let i = 0; i < 2; i++) feedAnimal(h.state, 'u1', a.uId);
    for (let i = 0; i < 3; i++) petAnimal(h.state, 'u1', a.uId);
    expect(a.satiety).toBe(100);
    expect(a.mood).toBe(100);
    a.sownAt = Date.now() - 3000;
    growLivestock(h.state);
    expect(a.growDay).toBe(2);
    const out = produceFromAnimals(h.state, h.tables, 2, Date.now());
    expect(out.length).toBe(1);
    expect(out[0].quality).toBe('gold');
    expect(out[0].itemId).toBe(ANIMALS[3].produceItemId);
    h.db.close();
  });

  it('低饱食心情 -> 普通品质', () => {
    const h = harness();
    adoptAnimal(h.state, h.tables, 'u1', 1, 550, 550, 0);
    const a = worldAnimals(h.state)[0];
    a.satiety = 10; a.mood = 10;
    a.sownAt = Date.now() - 10_000; a.growDay = 3;
    const out = produceFromAnimals(h.state, h.tables, 5, Date.now());
    expect(out.length).toBe(1);
    expect(out[0].quality).toBe('normal');
    h.db.close();
  });

  it('喂食无食物 -> 拒；有食物 -> 成功', () => {
    const h = harness();
    const r = adoptAnimal(h.state, h.tables, 'u1', 2, 550, 550, 0);
    const a = worldAnimals(h.state)[0];
    const bad = feedAnimal(h.state, 'u1', a.uId);
    expect(bad.ok).toBe(false);
    knapAdd(pm(h.state, 'u1'), ANIMALS[2].feedItemId, 2);
    const good = feedAnimal(h.state, 'u1', a.uId);
    expect(good.ok).toBe(true);
    expect(good.satiety).toBe(90);
    h.db.close();
  });
});

describe('烹饪加工', () => {
  it('厨房配方（免设施）：消耗原料 + 产出成品 + 起步价', () => {
    const h = harness();
    knapAdd(pm(h.state, 'u1'), 12, 1);
    knapAdd(pm(h.state, 'u1'), 28, 2);
    const r = cook(h.app as unknown as App, 'u1', 2);
    expect(r.ok).toBe(true);
    expect(r.out?.itemId).toBe(140);
    expect(r.out?.qty).toBe(1);
    const kn = pm(h.state, 'u1').get('knapData') as { props?: Array<{ id: number; num?: number }> };
    expect(kn.props?.find(p => p.id === 12)?.num ?? 0).toBe(0);
    expect(kn.props?.find(p => p.id === 140)?.num ?? 0).toBe(1);
    expect(r.out?.price).toBe(outputPrice(h.tables, RECIPES[2]));
    h.db.close();
  });

  it('磨坊需先建造设施', () => {
    const h = harness();
    knapAdd(pm(h.state, 'u1'), 28, 3);
    let r = cook(h.app as unknown as App, 'u1', 1);
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/mill/);
    knapAdd(pm(h.state, 'u1'), 1, 600);
    const b = buildFacility(h.state, 'u1', 'mill', 5, 5);
    expect(b.ok).toBe(true);
    r = cook(h.app as unknown as App, 'u1', 1);
    expect(r.ok).toBe(true);
    expect(r.out?.itemId).toBe(23);
    h.db.close();
  });

  it('recipes.json 优先（tables.recipes），缺省回退内置', () => {
    const h = harness();
    expect(h.tables.recipes.length).toBe(0);
    fs.mkdirSync(path.join(h.dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(h.dir, 'data', 'recipes.json'), JSON.stringify([
      { id: 99, facility: 'kitchen', name: '测试配方', inputs: { '12': 1 }, output: { itemId: 140, qty: 1 } },
    ]));
    const t2 = new Tables(path.join(h.dir, 'data'));
    expect(t2.recipes.length).toBe(1);
    expect(t2.recipes[0].inputs[12]).toBe(1);
    h.db.close();
  });
});
