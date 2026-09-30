// test/unit/schedule.test.ts —— B7 NPC 日程系统
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from '../../src/app.ts';
import type { NpcDef } from '../../src/types.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog } from '../../src/persistence/events.ts';
import { Tables } from '../../src/world/tables.ts';
import { npcDecision, npcHomeScene, gameHourOf, runNpcSchedules, villagePois, type NpcPois } from '../../src/world/schedule.ts';
import { ensureDayAnchor, calendarDay } from '../../src/world/calendar.ts';

const dirs: string[] = [];
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-sch-'));
  dirs.push(dir);
  const tables = new Tables(path.join(dir, 'data'));
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 240_000, init: false };
  const state = new WorldState(opts);
  const db = openDb(path.join(dir, 'events.db'));
  const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
  log.init();
  log.takeSnapshot();
  const app = { state, tables, db, log, stateOpts: opts } as unknown as App;
  (app as unknown as { stateOpts: StateOpts }).stateOpts = opts;
  return { dir, app, state, db, log };
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

const pois: NpcPois = {
  scene: 2,
  villageCenter: { x: 5000, y: 4000 },
  riverside: { x: 6000, y: 7000 },
  mine: { x: 3500, y: 1000 },
  doors: [{ x: 3700, y: 2500, house: 2 }],
};
const npc1: NpcDef = { id: 1, name: '甲' };
const npc4: NpcDef = { id: 4, name: '屠夫', appear_rule: [[3, 999, 1000]] as unknown as NpcDef['appear_rule'] };

describe('npcDecision 时段规则', () => {
  it('深夜睡觉 / 上午在家 / 午间午餐 / 傍晚河边 / 夜间归家', () => {
    const d0 = npcDecision(npc1, { day: 5, hour: 3, weather: 'clear', festival: null }, pois);
    expect(d0.activity).toBe('睡觉');
    const d9 = npcDecision(npc1, { day: 5, hour: 10, weather: 'clear', festival: null }, pois);
    expect(d9.activity).toBe('在家中');
    const d12 = npcDecision(npc1, { day: 5, hour: 12, weather: 'clear', festival: null }, pois);
    expect(d12.activity).toBe('村中心午餐');
    const d19 = npcDecision(npc1, { day: 5, hour: 19, weather: 'clear', festival: null }, pois);
    expect(d19.activity).toBe('河边傍晚闲逛');
    const d22 = npcDecision(npc1, { day: 5, hour: 22, weather: 'clear', festival: null }, pois);
    expect(d22.activity).toBe('在家中');
  });

  it('下午劳作：偶数去河边、奇数去村中心、4 倍数去矿点', () => {
    const d14a = npcDecision({ id: 2, name: '偶' } as NpcDef, { day: 5, hour: 14, weather: 'clear', festival: null }, pois);
    expect([d14a.x, d14a.y]).toEqual([6000, 7000]); // 河边
    const d14b = npcDecision(npc1, { day: 5, hour: 14, weather: 'clear', festival: null }, pois);
    expect([d14b.x, d14b.y]).toEqual([5000, 4000]); // 村中心（奇数且 id%4!=0）
    const d14c = npcDecision(npc4, { day: 5, hour: 14, weather: 'clear', festival: null }, pois);
    expect([d14c.x, d14c.y]).toEqual([3500, 1000]); // 矿点（id 4 % 4 == 0）
  });

  it('天气覆盖：雨/风暴 -> 居家（风暴最高优先）', () => {
    const rain = npcDecision(npc1, { day: 5, hour: 14, weather: 'rain', festival: null }, pois);
    expect(rain.activity).toBe('雨天室内');
    const storm = npcDecision(npc1, { day: 5, hour: 12, weather: 'storm', festival: '春花会' }, pois);
    expect(storm.activity).toBe('风暴避险'); // 风暴压过节日聚集
  });

  it('节日：10-20 时聚集村中心', () => {
    const f = npcDecision(npc1, { day: 9, hour: 12, weather: 'clear', festival: '春花会' }, pois);
    expect(f.activity).toBe('节日：春花会');
    expect([f.x, f.y]).toEqual([5000, 4000]);
    // 节日时段外（9 时）不聚集
    const f2 = npcDecision(npc1, { day: 9, hour: 9, weather: 'clear', festival: '春花会' }, pois);
    expect(f2.activity).not.toBe('节日：春花会');
  });
});

describe('npcHomeScene', () => {
  it('appear_rule type=3 兜底场景（>1000 视为村景 2）', () => {
    expect(npcHomeScene(npc4)).toBe(1000); // 1000 非 >1000 -> 原样
    expect(npcHomeScene({ id: 8, appear_rule: [[3, 1, 10000]] as unknown as NpcDef['appear_rule'] })).toBe(2); // 10000 -> 归村景
    expect(npcHomeScene({ id: 9, appear_rule: [[3, 1, 7]] as unknown as NpcDef['appear_rule'] })).toBe(7);
    expect(npcHomeScene({ id: 9 } as NpcDef)).toBe(2);
  });
});

describe('gameHourOf / runNpcSchedules', () => {
  it('游戏小时由锚点折算', () => {
    const h = harness();
    const t0 = 1_000_000;
    h.state.globals.set('afDayAnchor', { val: t0 });
    const gh = gameHourOf(h.state, t0 + 240_000 * 1 + 20_000); // 1 游戏日 + 1/12 日 = 2 小时
    expect(gh.day).toBe(1);
    expect(gh.hour).toBe(2);
    h.db.close();
  });

  it('调度幂等：首次全换位，二次 0 变化；事件入库', () => {
    const h = harness();
    ensureDayAnchor(h.state, 1_000_000);
    (h.app as unknown as { tables: Tables }).tables.npcs = [npc1, npc4];
    const c1 = runNpcSchedules(h.app as unknown as App, 1_000_000);
    expect(c1).toBe(2);
    const c2 = runNpcSchedules(h.app as unknown as App, 1_000_000 + 5000);
    expect(c2).toBe(0);
    const evs = h.log.since(0).filter(e => e.type === 'npc.schedule');
    expect(evs.length).toBe(2);
    // 换小时 -> 活动变化才再发
    const c3 = runNpcSchedules(h.app as unknown as App, 1_000_000 + 240_000); // +1 游戏日 -> 0 时睡觉（与首排同位置）
    expect(c3).toBe(0);
    h.db.close();
  });

  it('villagePois 确定性派生', () => {
    const h = harness();
    const p = villagePois(h.app as unknown as App);
    expect(p.scene).toBe(2);
    expect(p.villageCenter.x).toBeGreaterThan(0);
    h.db.close();
  });
});
