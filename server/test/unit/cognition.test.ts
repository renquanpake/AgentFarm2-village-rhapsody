// test/unit/cognition.test.ts —— C1-C5 认知栈（情节记忆/知识图谱/OCC 情感/目标层级/八卦 + 编排）
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from '../../src/app.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog, type GameEvent } from '../../src/persistence/events.ts';
import { Tables } from '../../src/world/tables.ts';
import { MemoryStore, recencyScore, cosine, normalize, pseudoEmbed } from '../../src/cognition/memory.ts';
import { FactStore } from '../../src/cognition/facts.ts';
import { affectDelta, decayAffect, actionPreference, emptyAffect, saveAffect, loadAffect } from '../../src/cognition/occ.ts';
import { GoalStore, runSleepCycle } from '../../src/cognition/goals.ts';
import { truncateDetail, propagateGossip, gossipText } from '../../src/cognition/gossip.ts';
import { CognitionService } from '../../src/cognition/orchestrator.ts';
import { createLlmOps, type LlmOps } from '../../src/cognition/llm.ts';

const dirs: string[] = [];
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-cog-'));
  dirs.push(dir);
  const tables = new Tables(path.join(dir, 'data'));
  const opts: StateOpts = { savesDir: path.join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 86400000, init: false };
  const state = new WorldState(opts);
  const db = openDb(path.join(dir, 'events.db'));
  const log = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
  log.init();
  log.takeSnapshot();
  const app = { state, tables, db, log } as unknown as App;
  return { dir, app, state, db, log, tables };
}
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

const T = 1_000_000;

describe('C1 情节记忆', () => {
  it('三路召回：新近 + 相关 + 重要（1/3 加权）', () => {
    const h = harness();
    const m = new MemoryStore(h.db);
    m.add('a1', '今天种了小麦', { kind: 'plant', importance: 0.5, ts: T, vector: pseudoEmbed('今天种了小麦') });
    m.add('a1', '昨天钓到大鱼', { kind: 'fish', importance: 0.9, ts: T - 86_400_000, vector: pseudoEmbed('昨天钓到大鱼') });
    m.add('a1', '小麦收获', { kind: 'crop', importance: 0.6, ts: T - 1000, vector: pseudoEmbed('小麦收获') });
    const hits = m.recall('a1', '小麦', { now: T, halfLifeMs: 86_400_000, k: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].content).toContain('小麦'); // 相关度高的排前
    h.db.close();
  });

  it('纯函数：recency/cosine/normalize/伪向量确定性', () => {
    expect(recencyScore(T, T, 86400000)).toBe(1);
    expect(recencyScore(T - 86400000, T, 86400000)).toBeCloseTo(0.5);
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(normalize([2, 4, 6])).toEqual([0, 0.5, 1]);
    expect(JSON.stringify(pseudoEmbed('abc'))).toBe(JSON.stringify(pseudoEmbed('abc')));
  });
});

describe('C2 知识图谱', () => {
  it('事件抽取 <=3 三元组 + 当前有效事实 + 睡眠修订', () => {
    const h = harness();
    const f = new FactStore(h.db);
    const ev = (type: string, payload: Record<string, unknown>): GameEvent => ({ seq: 1, ts: T, type, actor: 'u1', payload, seed: null });
    expect(f.extractFromEvent(ev('crop.harvested', { uId: 5 })).length).toBeLessThanOrEqual(3);
    expect(f.extractFromEvent(ev('social.fav', { a: 'u1', b: 'u2', delta: 10 }))[0].p).toBe('favors');
    // 入库 + 当前有效
    expect(f.commitExtraction(ev('trade.filled', { maker: 'u1', taker: 'u2', item: 12, price: 53, qty: 2, ts: T }))).toBe(1);
    expect(f.current('u1').some(x => x.predicate === 'sold_to')).toBe(true);
    // 失效 + 睡眠修订
    const id = f.add('u1', 'likes', 'u2', T, 0.3);
    f.invalidate(id, T + 1000);
    expect(f.current('u1').find(x => x.id === id)).toBeUndefined();
    const stale = f.add('u1', 'old_fact', 'x', T - 30 * 86_400_000, 0.2);
    expect(f.sleepRevision(T, { minConfidence: 0.5, maxAgeMs: 7 * 86_400_000 })).toBeGreaterThanOrEqual(1);
    h.db.close();
  });
});

describe('C3 OCC 情感', () => {
  it('事件增量 + 衰减 + 行为映射', () => {
    const d = affectDelta('crop.stormDamaged');
    expect(d.distress).toBeGreaterThan(0);
    expect(d.anger).toBeGreaterThan(0);
    const a = emptyAffect();
    a.anger = 1; a.joy = 0.5;
    const decayed = decayAffect(a, 86_400_000, 86_400_000);
    expect(decayed.anger).toBeCloseTo(0.5);
    expect(decayed.joy).toBeCloseTo(0.25);
    const angry = emptyAffect(); angry.anger = 0.9;
    const pref = actionPreference(angry);
    expect(pref[0]).toBe('chop_tree'); // 愤怒 -> 砍树泄愤
    const happy = emptyAffect(); happy.joy = 0.9; happy.gratitude = 0.9;
    expect(actionPreference(happy)[0]).toBe('gift'); // 喜悦 -> 送礼
  });

  it('情感持久化读写', () => {
    const h = harness();
    const a = emptyAffect(); a.joy = 0.7;
    saveAffect(h.db, 'u1', a, T);
    expect(loadAffect(h.db, 'u1')?.joy).toBeCloseTo(0.7);
    h.db.close();
  });
});

describe('C4 目标层级 + 睡眠期', () => {
  it('life 目标派生（幂等）+ 次日计划 + 睡眠周期', () => {
    const h = harness();
    const goals = new GoalStore(h.db);
    const facts = new FactStore(h.db);
    goals.ensureLifeGoals('u1', 'farmer');
    goals.ensureLifeGoals('u1', 'farmer'); // 幂等
    const lives = goals.active('u1', 'life');
    expect(lives.length).toBe(3);
    const daily = goals.planDaily('u1', { persona: 'farmer', weather: 'rain', festival: '春花会', memorySummary: ['s1'], topActions: ['浇水', '送礼'] });
    expect(daily.length).toBeGreaterThan(0);
    // 睡眠周期（每日 1 次）
    const ctx = { persona: 'farmer', weather: 'clear', festival: null, memorySummary: ['m1', 'm2'], facts, goals, topActions: ['浇水'], currentDay: 5, lastSleepDay: 4 };
    const r1 = runSleepCycle(h.db, 'u1', ctx as never);
    expect(r1).not.toBeNull();
    expect(r1!.dailyGoalIds.length).toBeGreaterThan(0);
    // 同日再跑 -> null（限每日 1 次）
    ctx.lastSleepDay = 5;
    expect(runSleepCycle(h.db, 'u1', ctx as never)).toBeNull();
    h.db.close();
  });
});

describe('C5 八卦传播', () => {
  it('每跳截断 30% + 3 跳上限', () => {
    const t = '1234567890';
    expect(truncateDetail(t, 0.7).length).toBeLessThan(t.length);
    const h = harness();
    const m = new MemoryStore(h.db);
    const r1 = propagateGossip(h.db, { from: 'a', to: 'b', text: '1234567890', credibility: 0.8 }, m, 1, T);
    expect(r1.recorded).toBe(true);
    expect(propagateGossip(h.db, { from: 'a', to: 'b', text: 'x', credibility: 0.8 }, m, 4, T).stopped).toBe(true);
  });

  it('好感文案正负向', () => {
    expect(gossipText(30, '甲', '乙')).toContain('变好');
    expect(gossipText(-30, '甲', '乙')).toContain('闹翻');
  });
});

describe('CognitionService 编排', () => {
  it('事件 -> 记忆 + 图谱 + 情感 联动', () => {
    const h = harness();
    h.state.playersDb.set('u1', new Map());
    const cs = new CognitionService(h.app as unknown as App);
    const ev = (type: string, payload: Record<string, unknown>): GameEvent => ({ seq: 1, ts: T, type, actor: 'u1', payload, seed: null });
    cs.onEvent(ev('crop.harvested', { uId: 5 }));
    // 记忆有内容
    expect(cs.memory.recall('u1', '收获', { now: T, k: 3 }).length).toBeGreaterThan(0);
    // 图谱有事实
    expect(cs.facts.current('u1').some(x => x.predicate === 'harvested')).toBe(true);
    // 情感有收获喜悦
    expect(cs.currentAffect('u1', T).joy).toBeGreaterThan(0);
    h.db.close();
  });

  it('无 Key 降级：LLM 不可用时 embed 回落伪向量、抽取回落规则', async () => {
    const h = harness();
    h.state.playersDb.set('u1', new Map());
    const cs = new CognitionService(h.app as unknown as App);
    const llm = cs.llm('u1');
    // 无 provider 无玩家 Key -> available=false；embed 回落伪向量
    expect(llm.available).toBe(false);
    const v = await llm.embed('u1', '测试文本');
    expect(v).toEqual(pseudoEmbed('测试文本'));
    // 抽取回落规则（返回 >=1 条）
    const ev: GameEvent = { seq: 1, ts: T, type: 'crop.harvested', actor: 'u1', payload: { uId: 7 }, seed: null };
    const n = await cs.extractLlm(ev);
    expect(n).toBeGreaterThanOrEqual(1);
    h.db.close();
  });

  it('伪 LLM 注入：chat 返回计划 -> planDailyLlm 走 LLM 分支', async () => {
    const h = harness();
    h.state.playersDb.set('u1', new Map());
    const cs = new CognitionService(h.app as unknown as App);
    // 注入一个总是返回计划的 LlmOps（覆盖 cs.llm 缓存）
    const fake: LlmOps = {
      available: true,
      chat: async (_a, _s, _u, _t) => '去浇水\n参加春花会\n钓三条鱼',
      embed: async () => pseudoEmbed('x'),
    };
    (cs as unknown as { llmOpsCache: Map<string, LlmOps> }).llmOpsCache.set('u1', fake);
    const n = await cs.planDailyLlm('u1', { persona: 'farmer', weather: 'clear', festival: '春花会', memorySummary: [], topActions: [] });
    expect(n).toBe(3);
    const goals = new GoalStore(h.db);
    expect(goals.active('u1', 'daily').length).toBe(3);
    h.db.close();
  });
});
