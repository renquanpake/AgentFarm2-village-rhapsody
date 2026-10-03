// test/unit/content-expansion.test.ts —— N9 季节事件线 + N9 第一小时引导 + N8 度量
// 背景：全年只有「每季最后一天一个节日」，其余 30 个游戏日完全同质（审计：新手第一天
// 可玩完全部内容）；没有任何「新玩家先做什么」的文本指引；战略门 100/30/10 无法判定。
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'node:path';
import { WorldState } from '../../src/persistence/state.ts';
import { Tables } from '../../src/world/tables.ts';
import { seasonEventsOf, activeSeasonEvents, seasonEventsView, triggerSeasonEvents, seasonDayIndex } from '../../src/world/season-events.ts';
import { onboardingSteps, onboardingCount, onboardingView, onboardingFunnel, ONBOARDING_KEY } from '../../src/world/onboarding.ts';
import { calendarDay } from '../../src/world/calendar.ts';
import { recentNotices } from '../../src/world/notices.ts';
import type { Weather } from '../../src/world/calendar.ts';

const DATA = path.resolve(new URL('../../../data', import.meta.url).pathname);

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'af-content-'));
  const state = new WorldState({ savesDir: dir, seedFile: '', slot: 96, farmLeft: 0, spawns: null, growDayMs: 600000 });
  const tables = new Tables(DATA);
  state.playersDb.set('u1', new Map<string, unknown>([['playerData', { uID: 'u1', day: 1 }]]));
  return { state, tables };
}

describe('季节事件线（data/season-events.json）', () => {
  it('四季各 3 个事件，season 用历法枚举', () => {
    const events = seasonEventsOf(new Tables(DATA));
    expect(events.length).toBeGreaterThanOrEqual(12);
    for (const s of ['spring', 'summer', 'autumn', 'winter']) {
      expect(events.filter(e => e.season === s).length).toBeGreaterThanOrEqual(3);
    }
    for (const e of events) { expect(e.title.length).toBeGreaterThan(1); expect(e.desc.length).toBeGreaterThan(6); }
  });

  it('每天至少有一个事件（不留空白日）', () => {
    const { tables } = fixture();
    for (let d = 1; d <= 40; d++) {
      const w = calendarDay(d).weather;
      expect(activeSeasonEvents(tables, d, w).length).toBeGreaterThan(0);
    }
  });

  it('天气限定的事件只在对应天气出现', () => {
    const { tables } = fixture();
    const events = seasonEventsOf(tables).filter(e => e.weather);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      // 找出该事件所在的某个游戏日，验证天气门
      let checked = 0;
      for (let d = 1; d <= 40 && checked < 1; d++) {
        const info = calendarDay(d);
        if (info.season !== e.season) continue;
        const day = seasonDayIndex(d);
        if (day < e.dayFrom || day > e.dayTo) continue;
        const wrong = (['clear', 'rain', 'snow', 'storm'] as Weather[]).filter(w => w !== e.weather);
        expect(activeSeasonEvents(tables, d, wrong[0]).some(x => x.id === e.id)).toBe(false);
        expect(activeSeasonEvents(tables, d, e.weather!).some(x => x.id === e.id)).toBe(true);
        checked++;
      }
      expect(checked).toBe(1);
    }
  });

  it('触发即写公告 + 进八卦池，且同一事件一季只触发一次', () => {
    const { state, tables } = fixture();
    const day = 1;
    const w = calendarDay(day).weather;
    const first = triggerSeasonEvents(state, tables, day, w, Date.now());
    expect(first.length).toBeGreaterThan(0);
    expect(recentNotices(state, 10).some(n => n.text.includes('【'))).toBe(true);
    const gossips = (state.world.get('gossipData') as { items?: Array<{ kind: string; text: string }> } | undefined)?.items || [];
    expect(gossips.some(g => g.kind === 'season')).toBe(true);
    // 幂等：同一天再触发不重复发
    const again = triggerSeasonEvents(state, tables, day, w, Date.now());
    expect(again.length).toBe(0);
    // 下一个季（day+10）应能再次触发
    const nextSeason = triggerSeasonEvents(state, tables, day + 10, calendarDay(day + 10).weather, Date.now());
    expect(nextSeason.length).toBeGreaterThan(0);
  });

  it('文本面：active + upcoming + note（T1 契约）', () => {
    const { tables } = fixture();
    const v = seasonEventsView(tables, 2, calendarDay(2).weather)!;
    expect(v.active.length).toBeGreaterThan(0);
    expect(v.note).toContain('事件线');
    expect(v.active[0].desc.length).toBeGreaterThan(4);
  });

  it('数据缺失时返回 null（不抛）', () => {
    const empty = new Tables(mkdtempSync(join(tmpdir(), 'af-empty-')));
    expect(seasonEventsView(empty, 1, 'clear')).toBeNull();
    expect(activeSeasonEvents(empty, 1, 'clear')).toEqual([]);
  });
});

describe('第一小时引导（data/onboarding.json）', () => {
  it('10 个环节，累计目标 60 分钟，动作类型覆盖新手主线', () => {
    const steps = onboardingSteps(new Tables(DATA));
    expect(steps.length).toBeGreaterThanOrEqual(8);
    const total = steps.reduce((s, x) => s + x.minutes, 0);
    expect(total).toBeGreaterThanOrEqual(45);
    const acts = new Set(steps.map(s => s.act));
    for (const a of ['move', 'forecast', 'till', 'plant', 'water', 'fish', 'trade', 'chop', 'talk', 'tasks']) expect(acts.has(a)).toBe(true);
    for (const s of steps) { expect(s.hint.length).toBeGreaterThan(10); expect(s.doneText.length).toBeGreaterThan(4); }
  });

  it('动作推进环节并给完成提示', () => {
    const { state, tables } = fixture();
    const steps = onboardingSteps(tables);
    const done = onboardingCount(state, tables, 'u1', steps[0].act);
    expect(done?.id).toBe(steps[0].id);
    const v = onboardingView(state, tables, 'u1')!;
    expect(v.finished).toBe(1);
    expect(v.current?.id).not.toBe(steps[0].id);
    expect(v.summary).toContain('下一步');
  });

  it('不重复计数：同一环节完成后不再推进', () => {
    const { state, tables } = fixture();
    const steps = onboardingSteps(tables);
    const a = onboardingCount(state, tables, 'u1', steps[0].act);
    const b = onboardingCount(state, tables, 'u1', steps[0].act);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it('进度存玩家私有桶（服务端权威，客户端 save 不可写）', () => {
    const { state, tables } = fixture();
    onboardingCount(state, tables, 'u1', onboardingSteps(tables)[0].act);
    const v = state.playersDb.get('u1')!.get(ONBOARDING_KEY) as { done: string[] };
    expect(v.done.length).toBe(1);
    expect(onboardingFunnel(state, 'u1').length).toBe(1);
  });

  it('全部完成后给出「去看任务链」的收尾文案', () => {
    const { state, tables } = fixture();
    for (const s of onboardingSteps(tables)) onboardingCount(state, tables, 'u1', s.act);
    const v = onboardingView(state, tables, 'u1')!;
    expect(v.finished).toBe(v.total);
    expect(v.summary).toContain('任务链');
  });

  it('数据缺失时不崩（view 为 null）', () => {
    const { state } = fixture();
    const empty = new Tables(mkdtempSync(join(tmpdir(), 'af-empty-')));
    expect(onboardingView(state, empty, 'u1')).toBeNull();
    expect(onboardingCount(state, empty, 'u1', 'move')).toBeNull();
  });
});