// test/unit/metrics.test.ts —— N8 里程碑度量基建（留存/漏斗/时长）
// 事故背景：战略门是「100 陌生人中 30 个玩满 2h、10 个留存」，但没有任何
// 注册/会话/时长/漏斗记录 —— 该门在结构上无法判定。
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'node:path';
import { WorldState } from '../../src/persistence/state.ts';
import { Tables } from '../../src/world/tables.ts';
import { metricsSessionStart, metricsSessionEnd, metricsAction, metricsReport, METRIC_KEY } from '../../src/world/metrics.ts';
import { onboardingCount, onboardingSteps } from '../../src/world/onboarding.ts';
import { App } from '../../src/app.ts';

const DATA = path.resolve(new URL('../../../data', import.meta.url).pathname);

function appFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'af-metrics-'));
  const state = new WorldState({ savesDir: dir, seedFile: '', slot: 95, farmLeft: 0, spawns: null, growDayMs: 600000 });
  state.playersDb.set('u1', new Map<string, unknown>([['playerData', { uID: 'u1', day: 1 }]]));
  const app = { state, tables: new Tables(DATA) } as unknown as App;
  // 日锚：让 gameDayOf 可算（当前日 = 0）
  state.globals.set('afDayAnchor', { val: Date.now() });
  return { app, state, tables: app.tables };
}

describe('会话与时长', () => {
  it('会话开始记首登/会话数/当日活跃', () => {
    const { app } = appFixture();
    metricsSessionStart(app, 'u1');
    metricsSessionStart(app, 'u1');
    const r = metricsReport(app);
    expect(r.players.total).toBe(1);
    expect(r.players.activeToday).toBe(1);
    const rec = (app.state.world.get(METRIC_KEY) as { players: Record<string, { sessions: number }> }).players.u1;
    expect(rec.sessions).toBe(2);
  });

  it('会话结束累计时长；单次上限 6 小时防挂机刷爆', () => {
    const { app } = appFixture();
    metricsSessionStart(app, 'u1');
    metricsSessionEnd(app, 'u1', Date.now() + 10 * 3600_000); // 假 10 小时
    const rec = (app.state.world.get(METRIC_KEY) as { players: Record<string, { totalPlayMs: number }> }).players.u1;
    expect(rec.totalPlayMs).toBe(6 * 3600_000);
    const r = metricsReport(app);
    expect(r.players.played2h).toBe(1);   // 6h >= 2h
    expect(r.players.totalPlayHours).toBe(6);
  });

  it('无日锚时不把玩家算成当日活跃（不崩）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-metrics2-'));
    const state = new WorldState({ savesDir: dir, seedFile: '', slot: 94, farmLeft: 0, spawns: null, growDayMs: 600000 });
    state.playersDb.set('u1', new Map<string, unknown>([['playerData', { day: 1 }]]));
    const app = { state, tables: new Tables(DATA) } as unknown as App;
    metricsSessionStart(app, 'u1');
    const r = metricsReport(app);
    expect(r.players.total).toBe(1);
    expect(r.players.activeToday).toBe(0);
  });

  it('动作计数进分布', () => {
    const { app } = appFixture();
    metricsAction(app, 'u1', 'till');
    metricsAction(app, 'u1', 'till');
    metricsAction(app, 'u1', 'fish');
    expect(metricsReport(app).actions).toMatchObject({ till: 2, fish: 1 });
  });
});

describe('漏斗与留存', () => {
  it('引导完成情况进漏斗（按环节到达人数）', () => {
    const { app, state, tables } = appFixture();
    const steps = onboardingSteps(tables);
    for (const uid of ['u1', 'u2', 'u3']) {
      state.playersDb.set(uid, new Map<string, unknown>([['playerData', { uID: uid, day: 1 }]]));
      metricsSessionStart(app, uid);
    }
    // u1 走完 3 步，u2 走完 1 步
    for (let i = 0; i < 3; i++) onboardingCount(state, tables, 'u1', steps[i].act);
    onboardingCount(state, tables, 'u2', steps[0].act);
    metricsAction(app, 'u1', 'x'); // 触发漏斗快照
    metricsAction(app, 'u2', 'x');
    const r = metricsReport(app);
    const first = r.funnel.find(f => f.step === steps[0].id)!;
    const third = r.funnel.find(f => f.step === steps[2].id)!;
    expect(first.reached).toBe(2);   // u1/u2 都完成了第 1 环（u3 没动）
    expect(third.reached).toBe(1);   // 只有 u1 走到第 3 环
    expect(third.rate).toBeLessThan(first.rate);
  });

  it('留存：次日上线计入 D1', () => {
    const { app } = appFixture();
    metricsSessionStart(app, 'u1');
    const rec = (app.state.world.get(METRIC_KEY) as { players: Record<string, { days: number[] }> }).players.u1;
    rec.days.push(1); // 模拟第 1 个游戏日也上线过
    const r = metricsReport(app);
    expect(r.players.retainedD1).toBe(1);
    expect(r.players.retainedD7).toBe(0);
  });

  it('headline：样本不足 100 时明说不可判定', () => {
    const { app } = appFixture();
    metricsSessionStart(app, 'u1');
    const r = metricsReport(app);
    expect(r.headline.canJudge100_30_10).toBe(false);
    expect(r.headline.note).toContain('/100');
  });

  it('内容消耗：任务链完成阶数进快照', () => {
    const { app, state, tables } = appFixture();
    state.playersDb.get('u1')!.set('afTasks', { list: {}, done: {}, chains: { 'chain-farmer': { doneStages: ['f1', 'f2'], claimed: ['f1', 'f2'] } } });
    metricsAction(app, 'u1', 'till');
    const r = metricsReport(app);
    expect(r.content.taskStagesDone).toBe(2);
    expect(r.content.avgTaskStages).toBe(2);
  });

  it('空世界不崩（0 玩家）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-metrics3-'));
    const state = new WorldState({ savesDir: dir, seedFile: '', slot: 93, farmLeft: 0, spawns: null, growDayMs: 600000 });
    const app = { state, tables: new Tables(DATA) } as unknown as App;
    const r = metricsReport(app);
    expect(r.players.total).toBe(0);
    expect(r.players.medianPlayMs).toBe(0);
    expect(r.funnel.length).toBeGreaterThanOrEqual(8);
  });
});