// test/unit/decor.test.ts —— B10 家具装饰 + 庭院评比
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from '../../src/app.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog } from '../../src/persistence/events.ts';
import { Tables } from '../../src/world/tables.ts';
import { knapAdd } from '../../src/world/farm.ts';
import {
  worldDecors, placeDecor, removeDecor, courtyardScore, courtyardCompletion, courtyardContest,
  decorSpotsFor, decorCatalog,
} from '../../src/world/decor.ts';

// 用真实数据目录（collision/spawns/decor.json）+ 临时 state
const REAL_DATA = path.resolve(__dirname, '../../../data');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'af-dec-'));
const tables = new Tables(REAL_DATA);
const opts: StateOpts = { savesDir: path.join(TMP, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: tables.spawns, growDayMs: 600000, init: false };
const state = new WorldState(opts);
const db = openDb(path.join(TMP, 'events.db'));
const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
log.init();
const app = { state, tables, db, log } as unknown as App;
function pm(uid: string) { if (!state.playersDb.has(uid)) state.playersDb.set(uid, new Map()); return state.playersDb.get(uid)!; }

describe('decorCatalog / decorSpotsFor', () => {
  it('目录 60 件（六类）', () => {
    expect(decorCatalog(tables).length).toBeGreaterThanOrEqual(20);
    const cats = new Set(decorCatalog(tables).map(d => d.category));
    expect(cats.size).toBe(6);
  });

  it('宅基地布置点：房屋周围的非障碍格', () => {
    const houses = tables.spawns?.houses || [];
    expect(houses.length).toBeGreaterThan(0);
    const spots = decorSpotsFor(tables, houses[0].id);
    expect(spots.length).toBeGreaterThan(0);
    // 点位都在 100x100 网格中心
    expect(spots[0].x % 100).toBe(50);
  });
});

describe('placeDecor / removeDecor / 评分', () => {
  it('布置：点位校验 + 扣金币 + 计分', () => {
    const spots = decorSpotsFor(tables, 2);
    const def = decorCatalog(tables)[0];
    knapAdd(pm('u1'), 1, def.price + 100);
    const r = placeDecor(state, tables, 'u1', 2, def.id, spots[0].x, spots[0].y);
    expect(r.ok).toBe(true);
    expect(worldDecors(state).length).toBe(1);
    expect(courtyardScore(state, tables, 'u1')).toBe(def.points);
  });

  it('非宅基地点位 -> 拒', () => {
    const def = decorCatalog(tables)[0];
    const r = placeDecor(state, tables, 'u1', 2, def.id, 123456, 654321);
    expect(r.ok).toBe(false);
  });

  it('移除：退还 50% 金币', () => {
    const def = decorCatalog(tables)[0];
    knapAdd(pm('u1'), 1, 0);
    const before = (pm('u1').get('knapData') as { props?: Array<{ id: number; num?: number }> }).props?.find(p => p.id === 1)?.num ?? 0;
    const spot = worldDecors(state)[0];
    const r = removeDecor(state, tables, 'u1', spot.x, spot.y);
    expect(r.ok).toBe(true);
    const after = (pm('u1').get('knapData') as { props?: Array<{ id: number; num?: number }> }).props?.find(p => p.id === 1)?.num ?? 0;
    expect(after).toBe(before + Math.floor(def.price / 2));
  });

  it('完成度：已布置 / 可布置格', () => {
    const placed = courtyardCompletion(state, tables, 'u1', 2);
    expect(placed).toBeGreaterThanOrEqual(0);
    expect(placed).toBeLessThanOrEqual(1);
  });
});

describe('courtyardContest', () => {
  it('按庭院分排序', () => {
    // u1 已布置若干；u2 布置更多
    const spots = decorSpotsFor(tables, 2);
    knapAdd(pm('u2'), 1, 100000);
    for (let i = 0; i < 3 && i < spots.length; i++) placeDecor(state, tables, 'u2', 2, decorCatalog(tables)[i].id, spots[i].x, spots[i].y);
    const rank = courtyardContest(app);
    expect(rank.length).toBeGreaterThan(0);
    // 降序
    for (let i = 1; i < rank.length; i++) expect(rank[i - 1].score).toBeGreaterThanOrEqual(rank[i].score);
  });
});
