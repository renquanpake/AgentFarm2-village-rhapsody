// server/test/unit/personality.test.ts —— Agent 性格与自主生活系统单元测试
import { describe, it, expect } from 'vitest';
import {
  PERSONALITY_PRESETS,
  consumeEnergy,
  calculateSleepRecovery,
  scoreActivities,
  decideNextAction,
  type DecisionContext,
} from '../../src/cognition/personality.ts';


describe('Agent 性格与自主生活系统 (Personality & Autonomous Routine)', () => {
  it('应当包含全部 7 个预设模板且各维度在 0-100 区间', () => {
    const expected = ['隐居者', '社交达人', '商人', '懒人', '探险家', '艺术家', '自定义'];
    for (const name of expected) {
      const p = PERSONALITY_PRESETS[name as keyof typeof PERSONALITY_PRESETS];
      expect(p).toBeDefined();
      expect(p.name).toBe(name);
      expect(p.dimensions.social).toBeGreaterThanOrEqual(0);
      expect(p.dimensions.social).toBeLessThanOrEqual(100);
      expect(p.dimensions.diligence).toBeGreaterThanOrEqual(0);
      expect(p.dimensions.diligence).toBeLessThanOrEqual(100);
      expect(p.dimensions.adventure).toBeGreaterThanOrEqual(0);
      expect(p.dimensions.adventure).toBeLessThanOrEqual(100);
      expect(p.dimensions.commerce).toBeGreaterThanOrEqual(0);
      expect(p.dimensions.commerce).toBeLessThanOrEqual(100);
      expect(p.dimensions.creativity).toBeGreaterThanOrEqual(0);
      expect(p.dimensions.creativity).toBeLessThanOrEqual(100);
    }
  });


  it('精力扣减与阈值检测', () => {
    const res1 = consumeEnergy(100, 10);
    expect(res1.newEnergy).toBe(90);
    expect(res1.isLow).toBe(false);
    expect(res1.isExhausted).toBe(false);


    const res2 = consumeEnergy(25, 10);
    expect(res2.newEnergy).toBe(15);
    expect(res2.isLow).toBe(true);
    expect(res2.isExhausted).toBe(false);


    const res3 = consumeEnergy(10, 20);
    expect(res3.newEnergy).toBe(0);
    expect(res3.isLow).toBe(true);
    expect(res3.isExhausted).toBe(true);
  });


  it('睡眠恢复计算', () => {
    expect(calculateSleepRecovery(0)).toBe(0);
    expect(calculateSleepRecovery(4)).toBe(50);
    expect(calculateSleepRecovery(8)).toBe(100);
    expect(calculateSleepRecovery(10)).toBe(100); // 封顶 100
  });


  it('性格差异打分：商人偏好商业赶集，探险家偏好远行挖矿', () => {
    const ctx: DecisionContext = {
      energy: 80,
      hour: 14,
      day: 1,
      hasUnreadInbox: false,
      pendingTasksCount: 0,
      isRaining: false,
    };


    const merchantScores = scoreActivities(PERSONALITY_PRESETS['商人'].dimensions, ctx);
    const topMerchant = merchantScores[0];
    expect(topMerchant.activity).toBe('trading');


    const explorerScores = scoreActivities(PERSONALITY_PRESETS['探险家'].dimensions, ctx);
    const topExplorer = explorerScores[0];
    expect(['exploring', 'mining', 'fishing']).toContain(topExplorer.activity);
  });


  it('精力为 0 时强制就寝', () => {
    const ctx: DecisionContext = {
      energy: 0,
      hour: 14,
      day: 1,
      hasUnreadInbox: false,
      pendingTasksCount: 0,
    };
    const decision = decideNextAction(PERSONALITY_PRESETS['勤劳度' as any] || PERSONALITY_PRESETS['自定义'], ctx);
    expect(decision.chosenActivity).toBe('resting');
    expect(decision.reason).toContain('强制睡眠');
  });


  it('玩家收件箱命令具有最高优先级', () => {
    const ctx: DecisionContext = {
      energy: 90,
      hour: 12,
      day: 1,
      hasUnreadInbox: true,
      pendingTasksCount: 2,
    };
    const decision = decideNextAction(PERSONALITY_PRESETS['隐居者'], ctx);
    expect(decision.prioritySource).toBe('player_inbox');
  });


  it('隐居者会拒绝要求主动社交的任务', () => {
    const ctx: DecisionContext = {
      energy: 80,
      hour: 10,
      day: 1,
      hasUnreadInbox: false,
      pendingTasksCount: 1,
    };
    const socialQuest = {
      title: '参加村中心集会并发表讲话',
      type: 'gathering',
      requiresSocial: true,
    };
    const decision = decideNextAction(PERSONALITY_PRESETS['隐居者'], ctx, socialQuest);
    // 应当拒绝社交任务，回落至隐居者自主决策 (farming 或 resting)
    expect(decision.prioritySource).toBe('autonomous_routine');
    expect(decision.chosenActivity).not.toBe('socializing');
  });
});