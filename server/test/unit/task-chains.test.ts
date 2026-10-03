// test/unit/task-chains.test.ts —— N9 任务链（内容扩容的核心）
// 事故背景：任务是 10 条无先后关系的孤立项（审计：新手第一天可玩完全部内容），
// give/bind 对 Agent 恒不可完成（动作只在 /ws 人类通道）。
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldState } from '../../src/persistence/state.ts';
import { Tables } from '../../src/world/tables.ts';
import { tasksOf, taskCount, taskView, chainsOf, playerDay, type TaskChain } from '../../src/world/tasks.ts';
import path from 'node:path';

const DATA = path.resolve(new URL('../../../data', import.meta.url).pathname);

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'af-tasks-'));
  const state = new WorldState({ savesDir: dir, seedFile: '', slot: 97, farmLeft: 0, spawns: null, growDayMs: 600000 });
  const tables = new Tables(DATA);
  state.playersDb.set('u1', new Map<string, unknown>([
    ['playerData', { uID: 'u1', nickName: '甲', day: 1 }],
    ['knapData', { props: [{ id: 1, num: 1000 }] }],
  ]));
  state.playersDb.set('u2', new Map<string, unknown>([['playerData', { uID: 'u2', day: 1 }]]));
  return { state, tables };
}

const coins = (state: WorldState, uid: string) =>
  ((state.playersDb.get(uid)!.get('knapData') as { props: Array<{ id: number; num: number }> }).props.find(p => p.id === 1)?.num) ?? 0;

describe('任务链数据（data/task-chains.json）', () => {
  it('至少 6 条链、30 阶起步（内容量门）', () => {
    const chains = chainsOf(new Tables(DATA));
    expect(chains.length).toBeGreaterThanOrEqual(6);
    const stages = chains.reduce((s, c) => s + c.stages.length, 0);
    expect(stages).toBeGreaterThanOrEqual(30);
  });

  it('结构合法：id 唯一、type 非空、count>=1、奖励存在、天数解锁递增', () => {
    const chains = chainsOf(new Tables(DATA));
    const ids = new Set<string>();
    for (const c of chains) {
      expect(c.unlockDay).toBeGreaterThanOrEqual(1);
      for (const s of c.stages) {
        expect(ids.has(s.id)).toBe(false);
        ids.add(s.id);
        expect(s.type).toBeTruthy();
        expect(s.count).toBeGreaterThanOrEqual(1);
        expect(s.desc.length).toBeGreaterThan(4);
        // 奖励 = 物品或金币（rewardCoins）至少其一；纯金币阶 reward 可为空
        expect((s.reward && s.reward.id && s.reward.num > 0) || (s.rewardCoins ?? 0) > 0).toBe(true);
      }
    }
    // 链按天数解锁递进（同一章内不要求严格递增，但整体首链最早）
    expect(Math.min(...chains.map(c => c.unlockDay))).toBe(1);
  });

  it('覆盖六大玩法类型（种植/采集/林业/交易/社交/节日）', () => {
    const types = new Set(chainsOf(new Tables(DATA)).flatMap(c => c.stages.map(s => s.type)));
    for (const t of ['till', 'plant', 'water', 'harvest', 'fish', 'mine', 'chop', 'build', 'cook', 'buy', 'trade', 'talk', 'give', 'bind', 'letter', 'delegate', 'stall', 'train']) {
      expect(types.has(t)).toBe(true);
    }
  });

  it('奖励随阶序递增（对齐 economy-tables.taskReward 曲线）', () => {
    const c = chainsOf(new Tables(DATA)).find(x => x.stages.length >= 4)!;
    const coinStages = c.stages.filter(s => s.reward?.id === 1).map(s => s.reward!.num);
    expect(coinStages.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < coinStages.length; i++) expect(coinStages[i]).toBeGreaterThanOrEqual(coinStages[i - 1]);
  });

  it('数据缺失时回落旧扁平任务（隔离环境仍可跑）', () => {
    const tables = new Tables(mkdtempSync(join(tmpdir(), 'af-empty-')));
    expect(chainsOf(tables)).toEqual([]);
    const { state } = fixture();
    const v = taskView(state, tables, 'u1');
    expect(v.mode).toBe('legacy');
    expect(v.legacy!.length).toBeGreaterThanOrEqual(10);
  });
});

describe('任务链推进', () => {
  it('天数未到的链锁定，达到后解锁', () => {
    const { state, tables } = fixture();
    const view0 = taskView(state, tables, 'u1');
    const later = view0.chains.find(c => c.unlockDay > 1)!;
    expect(later.unlocked).toBe(false);
    expect(later.next).toContain('解锁');

    const pd = state.playersDb.get('u1')!.get('playerData') as { day: number };
    pd.day = later.unlockDay;
    expect(playerDay(state, 'u1')).toBe(later.unlockDay);
    expect(taskView(state, tables, 'u1').chains.find(c => c.id === later.id)!.unlocked).toBe(true);
  });

  it('动作推进对应阶段并发奖（金币入背包）', () => {
    const { state, tables } = fixture();
    const before = coins(state, 'u1');
    taskCount(state, tables, 'u1', 'till');
    const t = tasksOf(state, 'u1');
    const farmer = chainsOf(tables).find(c => c.id === 'chain-farmer')!;
    const st = t.chains![farmer.id];
    expect(st.doneStages).toContain('f1');
    expect(coins(state, 'u1')).toBeGreaterThan(before);
    const v = taskView(state, tables, 'u1').chains.find(c => c.id === farmer.id)!;
    expect(v.finished).toBe(1);
    expect(v.stages.find(s => s.id === 'f1')!.done).toBe(true);
  });

  it('count>1 的阶段按累计推进，不重复发奖', () => {
    const { state, tables } = fixture();
    const river = chainsOf(tables).find(c => c.id === 'chain-river')!;
    const before = coins(state, 'u1');
    taskCount(state, tables, 'u1', 'fish');       // r2 完成
    const mid = coins(state, 'u1');
    taskCount(state, tables, 'u1', 'fish');
    taskCount(state, tables, 'u1', 'fish');       // r3 累计 3 完成
    const after = coins(state, 'u1');
    expect(after).toBeGreaterThan(mid);
    const st = tasksOf(state, 'u1').chains![river.id];
    expect(st.doneStages).toContain('r2');
    expect(st.doneStages).toContain('r3');
    // 金币奖励（reward:{id:1} 与 rewardCoins 同源）claim 标记为 'r3:coins'
    expect(st.claimed.filter(x => x === 'r3' || x === 'r3:coins').length).toBe(1);
    // 再来一次不重复发奖（阶段已完成）
    taskCount(state, tables, 'u1', 'fish');
    expect(coins(state, 'u1')).toBe(after);
    expect(before).toBeLessThan(mid);
  });

  it('社交阶段对 Agent 可完成（act give/bind 已接）', () => {
    const { state, tables } = fixture();
    (state.playersDb.get('u1')!.get('playerData') as { day: number }).day = 3; // 社交链第 3 天解锁
    taskCount(state, tables, 'u1', 'give');
    taskCount(state, tables, 'u1', 'bind');
    const social = chainsOf(tables).find(c => c.id === 'chain-social')!;
    const st = tasksOf(state, 'u1').chains![social.id];
    expect(st.doneStages).toEqual(expect.arrayContaining(['s2', 's4']));
  });

  it('链内不设顺序锁：跳着做也能推进（降低硬门槛）', () => {
    const { state, tables } = fixture();
    taskCount(state, tables, 'u1', 'harvest'); // f4 先做，f1/f2 未做
    const farmer = chainsOf(tables).find(c => c.id === 'chain-farmer')!;
    expect(tasksOf(state, 'u1').chains![farmer.id].doneStages).toContain('f4');
  });

  it('旧扁平任务与任务链并行推进（兼容旧档）', () => {
    const { state, tables } = fixture();
    taskCount(state, tables, 'u1', 'fish');
    const t = tasksOf(state, 'u1');
    expect(t.list.task6.cur).toBe(1);
    expect(t.done.task6).toBe(true);
  });

  it('strict 链一环扣一环：只有当前活跃阶计数，前置未完成锁定', () => {
    const { state, tables } = fixture();
    // chain-chronicle1 是 strict 且 requiresChain chain-farmer 6/6；玩家 day=1 双重锁定
    const v0 = taskView(state, tables, 'u1');
    const ep1 = v0.chains.find(c => c.id === 'chain-chronicle1')!;
    expect(ep1.unlocked).toBe(false);
    expect(ep1.next).toContain('第 10 天解锁');
    // 把玩家日子推进到解锁日，仍被前置链锁住
    const pd = state.playersDb.get('u1')!.get('playerData') as { day?: number };
    pd.day = 10;
    taskCount(state, tables, 'u1', 'talk', 5); // 村志需要 talk，但前置链「新农人」未完成
    const t = tasksOf(state, 'u1');
    expect(t.chains!['chain-chronicle1']?.doneStages ?? []).toEqual([]);
    // 完成前置链后，strict 链只推进活跃阶 z1（talk），z2 也是 talk 却不被推
    const farmer = chainsOf(tables).find(c => c.id === 'chain-farmer')!;
    for (const stg of farmer.stages) for (let i = 0; i < stg.count; i++) taskCount(state, tables, 'u1', stg.type);
    for (let i = 0; i < 1; i++) taskCount(state, tables, 'u1', 'talk');
    const ep = t.chains!['chain-chronicle1'];
    expect(ep.doneStages).toEqual(['z1z1']);      // 1 次 talk 只推活跃阶 z1z1
    for (let i = 0; i < 3; i++) taskCount(state, tables, 'u1', 'talk'); // 补够剩余 talk 阶
    expect(ep.doneStages).toEqual(['z1z1', 'z1z2']);
    expect(ep.doneStages.length).toBe(2);         // 非 talk 型阶段（台顶/训练/比赛）未混水
    // 锁定文案给出前置链名与进度
    const v2 = taskView(state, tables, 'u1');
    // 矿脉初探：第 7 天已过（今天 10 天）但前置「家的模样」未完成 -> 文案必须点名前置链
    const locked = v2.chains.find(c => c.id === 'chain-miner')!;
    expect(locked.unlocked).toBe(false);
    expect(locked.next).toContain('家的模样');
    expect(locked.next).toContain('一环扣一环');
  });

  it('任务视图是唯一出口：含 summary/next 文本指引', () => {
    const { state, tables } = fixture();
    const v = taskView(state, tables, 'u1');
    expect(v.mode).toBe('chains');
    expect(v.summary).toContain('任务链进度');
    const farmer = v.chains.find(c => c.id === 'chain-farmer')!;
    expect(farmer.next).toContain('开垦第一块地');
  });
});