#!/usr/bin/env node
// tools/eval-roleplay.mjs —— F2 角色扮演评测（自主行为占比 + 多样性熵防退化）
// 认知栈（OCC 情感 -> 动作偏好 + 目标 + 记忆）作为"无 LLM 基线脑"驱动脚本 agent；
// 每个场景：触发指令（instructions）vs 自主动作（topActions 选择），度量自主占比与动作熵。
// LLM 脑（M7 路由接通的玩家 Key）接入后同套场景可切换（AF_EVAL_LLM=1）。
// 用法：node tools/eval-roleplay.mjs [--out data/eval/roleplay-report.json]
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'tools', 'eval-roleplay-scenarios.json'), 'utf8'));
const OUT = process.argv.includes('--out') ? join(ROOT, process.argv[process.argv.indexOf('--out') + 1]) : null;

const { WorldState } = await import(join(ROOT, 'server', 'src', 'persistence', 'state.ts'));
const { EventLog } = await import(join(ROOT, 'server', 'src', 'persistence', 'events.ts'));
const { openDb } = await import(join(ROOT, 'server', 'src', 'persistence', 'db.ts'));
const { Tables } = await import(join(ROOT, 'server', 'src', 'world', 'tables.ts'));
const { CognitionService } = await import(join(ROOT, 'server', 'src', 'cognition', 'orchestrator.ts'));

// LLM 脑模式：AF_EVAL_LLM=1 / --llm。provider 走 AF_LLM_*（缺省回落 USER_IMG_*——agnes 端点同时提供
// chat 与生图）；无 Key 时 createLlmOps 自动降级（planDailyLlm 回落规则 / extractLlm 回落规则抽取）。
const LLM = process.env.AF_EVAL_LLM === '1' || process.argv.includes('--llm');
function loadDotEnv(file) {
  let txt; try { txt = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv(join(ROOT, '.env'));
const LLM_PROVIDER = LLM ? {
  url: process.env.AF_LLM_URL || process.env.USER_IMG_BASE_URL || '',
  key: process.env.AF_LLM_KEY || process.env.USER_IMG_API_KEY || '',
  model: process.env.AF_LLM_MODEL || 'agnes-3.0-flash',
} : null;
if (LLM && !LLM_PROVIDER.url && !LLM_PROVIDER.key) console.warn('[eval] --llm 但无 AF_LLM_*/USER_IMG_* Key：将全规则兜底');

function shannonNorm(labels) {
  const dist = {};
  for (const l of labels) dist[l] = (dist[l] || 0) + 1;
  const n = labels.length || 1;
  let h = 0;
  for (const c of Object.values(dist)) h -= (c / n) * Math.log2(c / n);
  const maxH = Math.log2(Object.keys(dist).length || 1);
  return maxH > 0 ? h / maxH : 0;
}

async function runScenario(sc) {
  const dir = mkdtempSync(join(tmpdir(), 'eval-rp-'));
  try {
    const tables = new Tables(join(dir, 'data'));
    const opts = { savesDir: join(dir, 'saves'), seedFile: '', slot: 1, farmLeft: 14, spawns: null, growDayMs: 60000, init: false };
    const state = new WorldState(opts);
    const db = openDb(join(dir, 'events.db'));
    const elog = new EventLog(db, { snapshotEvery: 5000, getState: () => state, stateOpts: opts });
    elog.init();
    const app = { state, tables, db, log: elog };
    if (LLM_PROVIDER) app.provider = LLM_PROVIDER; // C 轨 LLM 编排（M4 走 M7 路由；无 Key 自动降级）
    const cog = new CognitionService(app);
    const { GoalStore } = await import(join(ROOT, 'server', 'src', 'cognition', 'goals.ts'));
    const goals = new GoalStore(db);
    const agent = 'agent-' + sc.id;
    state.playersDb.set(agent, new Map());

    // C4 目标层：人设 life 目标 + 晨间 daily 计划（自主动作的第二来源，防情感趋同退化）
    goals.ensureLifeGoals(agent, sc.persona);
    const dailyCtx = { persona: sc.persona, weather: sc.weather, festival: sc.festival, memorySummary: [], topActions: cog.topActions(agent) };
    if (LLM_PROVIDER) await cog.planDailyLlm(agent, dailyCtx); // LLM 计划（失败回落规则 planDaily）
    else goals.planDaily(agent, dailyCtx);

    // 每日计划项 -> 可执行动作词（规则映射）
    const GOAL_VERB = { '查看并浇水/收获成熟作物': 'water', '外出劳作': 'farm', '雨天屋内整理与社交': 'talk' };
    const goalPool = goals.active(agent, 'daily').map(g => {
      const t = g.text;
      if (t.startsWith('执行：')) return t.slice(3);
      if (GOAL_VERB[t]) return GOAL_VERB[t];
      if (t.includes('参加')) return 'trade';
      return 'rest';
    });

    const instructAt = new Map(sc.instructions.map(i => [i.at, i.action]));
    const actions = [];
    let seq = 1;
    let goalI = 0;
    let selfI = 0;
    let llmExtracts = 0;
    for (let t = 0; t < sc.ticks; t++) {
      // 世界事件（驱动认知更新：情感/记忆/图谱）
      const evType = sc.seedEvents[t % sc.seedEvents.length];
      elog.append(evType, agent, { uid: agent, uId: seq++, item: 1, delta: 10, npc: 1, day: t, weather: sc.weather, festival: sc.festival, activity: 'v' });
      cog.onEvent({ seq: 1, ts: Date.now(), type: evType, actor: agent, payload: { uid: agent }, seed: null });
      // LLM 图谱抽取（限 3 次/场景控配额；失败自动回落规则抽取）
      if (LLM_PROVIDER && llmExtracts < 3) {
        llmExtracts++;
        await cog.extractLlm({ seq: 1, ts: Date.now(), type: evType, actor: agent, payload: { uid: agent }, seed: null });
      }
      // 动作决策：触发指令优先；否则自主（OCC 情感偏好 与 目标层计划项交替）
      const triggered = instructAt.get(t);
      if (triggered) {
        actions.push({ t, kind: 'triggered', action: triggered });
      } else {
        let a;
        if (selfI % 2 === 0) {
          a = cog.topActions(agent)[0] ?? 'rest';
        } else {
          a = goalPool[goalI++ % goalPool.length] ?? 'rest';
        }
        selfI++;
        actions.push({ t, kind: 'self', action: a });
      }
    }
    const selfCount = actions.filter(a => a.kind === 'self').length;
    const selfLabels = actions.filter(a => a.kind === 'self').map(a => a.action);
    const allLabels = actions.map(a => a.action);
    const selfDirected = selfCount / actions.length;
    const entropy = shannonNorm(allLabels);
    const entropySelf = shannonNorm(selfLabels);
    db.close();
    return {
      scenario: sc.id, ticks: sc.ticks,
      selfDirected: Number(selfDirected.toFixed(3)),
      entropyNorm: Number(entropy.toFixed(3)),
      entropySelfNorm: Number(entropySelf.toFixed(3)),
      actions: allLabels,
      llmExtracts,
      pass: selfDirected >= cfg.gates.selfDirectedMin && entropySelf >= cfg.gates.entropyMinNorm,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const report = {
  at: new Date().toISOString(),
  gates: cfg.gates,
  brain: LLM_PROVIDER
    ? `llm(M7路由 ${LLM_PROVIDER.model || 'default'}${LLM_PROVIDER.key ? '' : '，无Key→规则兜底'})`
    : 'cognition-rules(无LLM基线)',
  scenarios: [],
};
let allPass = true;
for (const sc of cfg.scenarios) {
  const r = await runScenario(sc);
  report.scenarios.push(r);
  console.log(`[eval] ${sc.id}: 自主占比 ${r.selfDirected} 熵 ${r.entropySelfNorm} -> ${r.pass ? 'PASS' : 'FAIL'}`);
  if (!r.pass) allPass = false;
}
report.pass = allPass;
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('[eval] 报告 ->', OUT);
}
console.log(`[eval] 总结：${allPass ? '全部达标' : '未达标'}（门：自主 >= ${cfg.gates.selfDirectedMin}，熵 >= ${cfg.gates.entropyMinNorm}）`);
process.exit(allPass ? 0 : 1);
