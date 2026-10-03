// test/unit/llm-budget.test.ts —— N12 Agent 成本熔断（每日预算 + 软提醒 + 硬熔断）
// 事故背景：玩家自备 Key 由 Agent 无节制调用，一次失控循环就能烧穿额度；
// llm_usage 计量早就有，缺的是闸。
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { budgetConfig, budgetStatus, budgetTripMessage, dayStartMs, invalidateBudgetCache, clearBudgetCache } from '../../src/cognition/llm-budget.ts';
import { recordUsage } from '../../src/persistence/keyvault.ts';

function db(): DatabaseSync {
  const d = new DatabaseSync(join(mkdtempSync(join(tmpdir(), 'af-budget-')), 'usage.db'));
  d.exec(`CREATE TABLE IF NOT EXISTS llm_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, account_uid TEXT, agent_uid TEXT, task_type TEXT, tier TEXT, tokens_in INTEGER, tokens_out INTEGER, cached INTEGER, usd_hint REAL, ts INTEGER)`);
  return d;
}
const NOW = Date.UTC(2026, 0, 2, 12, 0, 0);
const env = (o: Record<string, string>) => o;

beforeEach(() => clearBudgetCache());

describe('预算配置', () => {
  it('缺省不限流（limit=0）', () => {
    const c = budgetConfig(env({}));
    expect(c.limit).toBe(0);
    expect(c.warnRatio).toBe(0.8);
  });

  it('AF_LLM_DAILY_TOKENS / AF_LLM_BUDGET_WARN 生效', () => {
    const c = budgetConfig(env({ AF_LLM_DAILY_TOKENS: '1000', AF_LLM_BUDGET_WARN: '0.5' }));
    expect(c.limit).toBe(1000);
    expect(c.warnRatio).toBe(0.5);
  });

  it('自然日窗口对齐 UTC 0 点', () => {
    expect(dayStartMs(NOW)).toBe(Date.UTC(2026, 0, 2));
  });
});

describe('三段式闸', () => {
  it('未达线：不提醒不熔断', () => {
    const d = db();
    recordUsage(d, { accountUid: 'u1', taskType: 'dialogue', tier: 'flagship', tokensIn: 100, tokensOut: 50 });
    invalidateBudgetCache('u1');
    const s = budgetStatus(d, 'u1', NOW, env({ AF_LLM_DAILY_TOKENS: '1000' }));
    expect(s.used).toBe(150);
    expect(s.warn).toBe(false);
    expect(s.tripped).toBe(false);
    expect(budgetTripMessage(s)).toBeNull();
  });

  it('过软提醒线：warn=true，justWarned 只报一次', () => {
    const d = db();
    recordUsage(d, { accountUid: 'u2', taskType: 'plan', tier: 'flagship', tokensIn: 900, tokensOut: 100 });
    invalidateBudgetCache('u2');
    const e = { AF_LLM_DAILY_TOKENS: '1000' };
    const s1 = budgetStatus(d, 'u2', NOW, e);
    expect(s1.warn).toBe(true);
    expect(s1.justWarned).toBe(true);
    // 缓存命中 + justWarned 不再触发（每日一次）
    const s2 = budgetStatus(d, 'u2', NOW, e);
    expect(s2.warn).toBe(true);
    expect(s2.justWarned).toBe(false);
  });

  it('超限：tripped=true + 熔断文案点名环境变量', () => {
    const d = db();
    recordUsage(d, { accountUid: 'u3', taskType: 'dialogue', tier: 'flagship', tokensIn: 1500, tokensOut: 200 });
    invalidateBudgetCache('u3');
    const s = budgetStatus(d, 'u3', NOW, env({ AF_LLM_DAILY_TOKENS: '1000' }));
    expect(s.tripped).toBe(true);
    const msg = budgetTripMessage(s);
    expect(msg).toContain('AF_LLM_DAILY_TOKENS');
    expect(msg).toContain('1700');
  });

  it('跨自然日重置（昨日爆表不影响今天）', () => {
    const d = db();
    // recordUsage 恒写 Date.now()，历史用量直接插行以构造跨日数据
    d.prepare('INSERT INTO llm_usage (account_uid, task_type, tier, tokens_in, tokens_out, cached, ts) VALUES (?,?,?,?,?,?,?)')
      .run('u4', 'plan', 'flagship', 5000, 0, 0, Date.UTC(2026, 0, 1, 10));
    invalidateBudgetCache('u4');
    const s = budgetStatus(d, 'u4', NOW, env({ AF_LLM_DAILY_TOKENS: '1000' }));
    expect(s.used).toBe(0);
    expect(s.tripped).toBe(false);
  });

  it('不同账号互不影响', () => {
    const d = db();
    recordUsage(d, { accountUid: 'a', taskType: 'plan', tier: 'flagship', tokensIn: 5000, tokensOut: 0 });
    const s = budgetStatus(d, 'b', NOW, env({ AF_LLM_DAILY_TOKENS: '1000' }));
    expect(s.tripped).toBe(false);
  });
});

describe('接线', () => {
  it('llm.ts 在 chat/embed 命中熔断时降级（源码级锁定，防旁路）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/cognition/llm.ts', import.meta.url), 'utf8');
    expect(src).toContain('if (m.blocked) return null;');
    expect(src).toContain('if (m.blocked) return pseudoEmbed(text);');
    // 缓存命中必须排在熔断判定之前（命中不花钱，不该降级）
    expect(src.indexOf('if (m.hit) return')).toBeLessThan(src.indexOf('if (m.blocked) return null;'));
  });

  it('/af/llm-usage 暴露预算字段', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/gateway/http.ts', import.meta.url), 'utf8');
    expect(src).toContain('budget: { limit: b.limit, usedToday: b.used');
  });
});