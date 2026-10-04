// test/unit/tutorial.test.ts —— 批2 P4 Task1：数据驱动新手教程（服务端权威进度）
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { App } from '../../src/app.ts';
import { WorldState, type StateOpts, PLAYER_KEYS } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog } from '../../src/persistence/events.ts';
import { Tables } from '../../src/world/tables.ts';
import { tutorialSteps, tutorialProgress, tutorialAct, tutorialView, TUTORIAL_KEY } from '../../src/world/tutorial.ts';

const dirs: string[] = [];
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-tut-'));
  dirs.push(dir);
  const dataDir = path.join(ROOT, 'data');
  const tables = new Tables(dataDir);
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 600_000, init: false };
  const state = new WorldState(opts);
  const db = openDb(path.join(dir, 'events.db'));
  const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
  log.init();
  log.takeSnapshot();
  const app = { state, tables, db, log, dataDir } as unknown as App;
  return { dir, app, state, tables };
}

afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe('tutorial：步骤表（data/tutorial.json 驱动）', () => {
  it('7 步齐备，id/title/hint/need 齐全且与规格 §4.1 顺序一致', () => {
    const { tables } = harness();
    const steps = tutorialSteps(tables);
    expect(steps.length).toBe(7);
    expect(steps.map((s) => s.id)).toEqual(['see-self', 'move', 'tasks', 'farm', 'talk', 'agent', 'delegate']);
    for (const s of steps) {
      expect(s.title.trim().length, `${s.id} 缺 title`).toBeGreaterThan(0);
      expect(s.hint.trim().length, `${s.id} 缺 hint`).toBeGreaterThan(0);
      expect(typeof s.need, `${s.id} 缺 need`).toBe('string');
    }
  });

  it('need 指向既有 act 名（不新增动作，Ruling P1）', () => {
    const { tables } = harness();
    const src = fs.readFileSync(path.join(ROOT, 'server/src/gateway/ws.ts'), 'utf8');
    const branches = new Set([...src.matchAll(/action === '([a-z_]+)'/g)].map((m) => m[1]));
    for (const s of tutorialSteps(tables)) {
      for (const act of s.need.split('+').map((x) => x.trim()).filter(Boolean)) {
        expect(branches.has(act), `步骤 ${s.id} 的 need「${act}」不是既有 act 分支`).toBe(true);
      }
    }
  });

  it('步骤 4 种收四连（till+plant+water+harvest），步骤 6 的 agent 不依赖 act', () => {
    const { tables } = harness();
    const steps = tutorialSteps(tables);
    expect(steps[3].need).toBe('till+plant+water+harvest');
    expect(steps[0].need).toBe('onboarding'); // 第 1 步用既有 onboarding act 作「看过引导」信号
    // 第 6 步（雇佣 Agent）没有对应 act：完成判定走「托管在线/已派活」，need 留空
    expect(steps[5].need).toBe(''); // 第 6 步没有对应 act：靠托管上线信号
  });

  it('数据文件缺失时回落为内置 7 步（表损坏不炸服）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-tut-empty-'));
    dirs.push(dir);
    const steps = tutorialSteps(new Tables(dir)); // 空目录：读不到 tutorial.json
    expect(steps.length).toBe(7);
    expect(steps.map((x) => x.id)).toEqual(['see-self', 'move', 'tasks', 'farm', 'talk', 'agent', 'delegate']);
  });
});

describe('tutorial：进度桶（afTutorial，按玩家私有）', () => {
  it('TUTORIAL_KEY 已登记进 PLAYER_KEYS（幽灵桶防线，门11 同源）', () => {
    expect(TUTORIAL_KEY).toBe('afTutorial');
    expect(PLAYER_KEYS.has(TUTORIAL_KEY)).toBe(true);
  });

  it('新号进度为空、active = 第一步', () => {
    const { state } = harness();
    state.playersDb.set('u_t1', new Map([['playerData', { coins: 0, sceneType: 2 }]]));
    const p = tutorialProgress(state, 'u_t1');
    expect(p.done).toEqual([]);
    expect(p.active).toBe('see-self');
  });

  it('未知 uid 也返回进度（不抛），active 仍是第一步', () => {
    const { state } = harness();
    const p = tutorialProgress(state, 'u_not_exist');
    expect(p.done).toEqual([]);
    expect(p.active).toBe('see-self');
  });

  it('act 计数只认 ok=true（同 tasks 模式：失败不推进）', () => {
    const { state } = harness();
    state.playersDb.set('u_t2', new Map([['playerData', { coins: 0, sceneType: 2 }]]));
    tutorialAct(state, 'u_t2', 'move', false);
    tutorialAct(state, 'u_t2', 'move', true);
    const p = tutorialProgress(state, 'u_t2');
    expect(p.done).toContain('move');
    expect(p.seen.move).toBe(1);
  });

  it('走完 act 序列后：除第 6 步（托管在线信号）外全部完成', () => {
    const { state } = harness();
    state.playersDb.set('u_t3', new Map([['playerData', { coins: 0, sceneType: 2 }]]));
    for (const act of ['onboarding', 'move', 'move', 'tasks', 'till', 'plant', 'water', 'harvest', 'talk', 'delegate']) {
      tutorialAct(state, 'u_t3', act, true);
    }
    const p = tutorialProgress(state, 'u_t3');
    for (const id of ['see-self', 'move', 'tasks', 'farm', 'talk', 'delegate']) expect(p.done, `缺 ${id}`).toContain(id);
    // 第 6 步（雇佣 Agent）不由 act 驱动：托管上线前 active 指向它，且不能被其它 act 误完成
    expect(p.done).not.toContain('agent');
    expect(p.active).toBe('agent');
  });

  it('第 6 步可显式标记完成（托管在线时由客户端/服务端上报），随后 active=null', () => {
    const { state } = harness();
    state.playersDb.set('u_t4', new Map([['playerData', { coins: 0, sceneType: 2 }]]));
    for (const act of ['onboarding', 'move', 'move', 'tasks', 'till', 'plant', 'water', 'harvest', 'talk', 'delegate']) tutorialAct(state, 'u_t4', act, true);
    tutorialAct(state, 'u_t4', 'agent', true); // 托管 Agent 上线信号（服务端/客户端显式上报）
    const p = tutorialProgress(state, 'u_t4');
    expect(p.done).toContain('agent');
    expect(p.active).toBeNull();
  });

  it('进度落玩家私有桶（playersDb[uid].afTutorial），不写 world 桶', () => {
    const { state } = harness();
    state.playersDb.set('u_t5', new Map([['playerData', { coins: 0, sceneType: 2 }]]));
    tutorialAct(state, 'u_t5', 'move', true);
    const pm = state.playersDb.get('u_t5')!;
    expect(pm.get('afTutorial')).toBeTruthy();
    expect(state.world.get('afTutorial')).toBeUndefined();
  });

  it('脏数据（旧版本缺字段/非数组）不炸：回落空进度', () => {
    const { state } = harness();
    state.playersDb.set('u_t6', new Map([['playerData', { coins: 0, sceneType: 2 }], ['afTutorial', { done: 'not-array', seen: 7 }]]));
    const p = tutorialProgress(state, 'u_t6');
    expect(p.done).toEqual([]);
    expect(p.seen).toEqual({});
  });
});

describe('tutorial：视图与端点契约', () => {
  it('tutorialView 返回 steps + progress（GET /af/tutorial 响应形状）', () => {
    const { app, state } = harness();
    state.playersDb.set('u_t7', new Map([['playerData', { coins: 0, sceneType: 2 }]]));
    tutorialAct(state, 'u_t7', 'move', true);
    const v = tutorialView(app, 'u_t7');
    expect(v.steps.length).toBe(7);
    expect(v.progress.active).toBe('see-self'); // see-self 需客户端上报，其余按 act
    expect(typeof v.key).toBe('string');
  });

  it('无 uid 时也给 steps（公开文本面，玩家未登录也能读教程文案）', () => {
    const { app } = harness();
    const v = tutorialView(app, undefined);
    expect(v.steps.length).toBe(7);
    expect(v.progress.done).toEqual([]);
  });
});