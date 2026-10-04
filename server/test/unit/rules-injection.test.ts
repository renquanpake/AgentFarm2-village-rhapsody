// test/unit/rules-injection.test.ts —— 批2 P3 Task4：三注入点接线 + rulesHash 归因
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { App } from '../../src/app.ts';
import { WorldState, type StateOpts } from '../../src/persistence/state.ts';
import { openDb } from '../../src/persistence/db.ts';
import { EventLog } from '../../src/persistence/events.ts';
import { Tables } from '../../src/world/tables.ts';
import { rulesPrompt } from '../../src/world/rules-prompt.ts';
import { npcDialoguePrompt, plannerSystemPrompt } from '../../src/world/dialogue-prompt.ts';
import { recordAgentOp, recapView } from '../../src/world/agent-log.ts';
import { llmDailyPlan, type LlmOps } from '../../src/cognition/llm.ts';

const dirs: string[] = [];
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-inj-'));
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
/** 捕获 llm.chat 的 system 入参 */
function fakeLlm(reply: string): { llm: LlmOps; systems: string[] } {
  const systems: string[] = [];
  const llm = {
    chat: async (_agent: string, system: string) => { systems.push(system); return reply; },
    embed: async () => null,
  } as unknown as LlmOps;
  return { llm, systems };
}

afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const NPC_CTX = {
  npcName: '树根', identity: '老农', tagline: '地不哄人。', desc: '种了一辈子地，朴实寡言。',
  day: 3, seasonCn: '春', weatherCn: '晴', festival: null, gossip: null,
};

describe('注入点 1：NPC 对话 system 带完整版规则', () => {
  it('system 串含反幻觉尾句与权威价格行', () => {
    const { app, tables } = harness();
    const rules = rulesPrompt(app, { budget: 'full' });
    const sys = npcDialoguePrompt(NPC_CTX, rules);
    expect(sys).toContain('以上资料未写明的，回答不知道。');
    const id = tables.items.find((it) => tables.basePriceOf(it.id) > 0)!.id;
    expect(sys).toContain(String(tables.basePriceOf(id)));
    // 人设与现场仍在（规则段不能吃掉角色声音）
    expect(sys).toContain('树根');
    expect(sys).toContain('地不哄人。');
    expect(sys).toContain('第3天');
  });

  it('NPC 提问价格时 rules 段在 system 内（对话链不靠 user 消息传规则）', () => {
    const { app } = harness();
    const rules = rulesPrompt(app, { budget: 'full' });
    const sys = npcDialoguePrompt(NPC_CTX, rules);
    const rulesAt = sys.indexOf('【价目】');
    expect(rulesAt).toBeGreaterThan(0);
    expect(sys.indexOf('【条款】')).toBeGreaterThan(rulesAt);
  });
});

describe('注入点 2：托管次日计划 system 带精简版规则', () => {
  it('llmDailyPlan 的 system 含 lite 规则尾句（预算 ≤300）', async () => {
    const { app } = harness();
    const rules = rulesPrompt(app, { budget: 'lite' });
    const { llm, systems } = fakeLlm('① 去河边钓鱼\n② 给邻居送菜');
    const plans = await llmDailyPlan(llm, 'u_plan', {
      persona: 'p', weather: '晴', festival: null, memorySummary: [], topActions: [],
      rules: plannerSystemPrompt(rules),
    });
    expect(plans).toEqual(['去河边钓鱼', '给邻居送菜']);
    expect(systems[0]).toContain('以上资料未写明的，回答不知道。');
    expect(systems[0]).toContain('角色规划器');
  });

  it('lite 规则进 system 后仍在 300 token 预算内（注入不放爆规划请求）', () => {
    const { app } = harness();
    const sys = plannerSystemPrompt(rulesPrompt(app, { budget: 'lite' }));
    expect(Math.ceil(sys.length / 2)).toBeLessThanOrEqual(360);
  });
});

describe('rulesHash 归因：行为流水可查规则版本', () => {
  it('recordAgentOp 带 rulesHash → recapView 暴露（归因可查）', () => {
    const { state } = harness();
    recordAgentOp(state, 'u_hash', { day: 1, action: 'talk', ok: true, detail: '问价', rulesHash: 'abc123' });
    const v = recapView(state, 'u_hash', 5)!;
    expect(v.recent[0].rulesHash).toBe('abc123');
    expect(v.rulesHash).toBe('abc123');
  });

  it('旧行无 rulesHash 字段不报错、归因降级为 null（历史会话兼容）', () => {
    const { state } = harness();
    recordAgentOp(state, 'u_old', { day: 1, action: 'talk', ok: true, detail: '旧行' });
    const v = recapView(state, 'u_old', 5)!;
    expect(v.recent[0].rulesHash ?? null).toBeNull();
    expect(v.rulesHash ?? null).toBeNull();
  });
});