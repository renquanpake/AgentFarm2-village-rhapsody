// cognition/orchestrator.ts —— C 轨编排：游戏事件 -> 认知栈（M4）
// 事件 -> 情节记忆（C1）+ 知识图谱抽取（C2）+ OCC 情感（C3）+ 八卦（C5）。
// LLM 抽取/计划走 M7 路由（玩家 Key）；无 Key 全规则兜底（本段默认路径，确定性可测）。
import type { App } from '../app.ts';
import type { GameEvent } from '../persistence/events.ts';
import { MemoryStore, pseudoEmbed } from './memory.ts';
import { FactStore } from './facts.ts';
import { affectDelta, decayAffect, saveAffect, loadAffect, emptyAffect, actionPreference, EMOTIONS } from './occ.ts';
import { triggerGossipOnFavChange } from './gossip.ts';
import { GoalStore } from './goals.ts';
import { createLlmOps, type LlmOps, llmExtract, llmDailyPlan } from './llm.ts';
import { rulesPrompt } from '../world/rules-prompt.ts';
import { plannerSystemPrompt } from '../world/dialogue-prompt.ts';

export class CognitionService {
  memory: MemoryStore;
  facts: FactStore;
  private app: App;
  private llmOpsCache = new Map<string, LlmOps>();
  constructor(app: App) {
    this.app = app;
    this.memory = new MemoryStore(app.db);
    this.facts = new FactStore(app.db);
  }

  llm(agentUid: string): LlmOps {
    if (!this.llmOpsCache.has(agentUid)) this.llmOpsCache.set(agentUid, createLlmOps(this.app, agentUid));
    return this.llmOpsCache.get(agentUid)!;
  }

  /** LLM 增强记忆入库：embedding（LLM 优先，伪向量兜底） */
  async rememberWithEmbed(agent: string, content: string, opts: { kind?: string; importance?: number } = {}): Promise<void> {
    const llm = this.llm(agent);
    let vector: number[];
    try { vector = (await llm.embed(agent, content)) ?? pseudoEmbed(content); } catch { vector = pseudoEmbed(content); }
    this.memory.add(agent, content, { kind: opts.kind ?? 'llm', importance: opts.importance ?? 0.6, vector });
  }

  /** LLM 三元组抽取（失败回落规则抽取） */
  async extractLlm(ev: GameEvent): Promise<number> {
    const trs = await llmExtract(this.llm(ev.actor ?? 'system'), ev.actor ?? 'system', JSON.stringify({ type: ev.type, payload: ev.payload }));
    if (trs) {
      for (const t of trs) this.facts.add(t.s, t.p, t.o, ev.ts, t.conf, 'llm:' + ev.type);
      return trs.length;
    }
    return this.facts.commitExtraction(ev); // 规则兜底
  }

  /** LLM 次日计划（失败回落规则 planDaily；返回计划条数）
   *  P3：system 注入精简版规则上下文（lite ≤300 token），计划里的动作名/价格/坐标不许自编 */
  async planDailyLlm(agent: string, ctx: { persona: string; weather: string; festival: string | null; memorySummary: string[]; topActions: string[] }): Promise<number> {
    const plans = await llmDailyPlan(this.llm(agent), agent, {
      ...ctx,
      rules: plannerSystemPrompt(rulesPrompt(this.app, { budget: 'lite', uid: agent })),
    });
    const goals = new GoalStore(this.app.db);
    if (plans) {
      for (const p of plans) goals.add(agent, 'daily', p);
      return plans.length;
    }
    return goals.planDaily(agent, ctx).length; // 规则兜底
  }

  /** 每事件认知更新（log.listen 钩子；幂等、轻量） */
  onEvent(ev: GameEvent): void {
    const app = this.app;
    const now = ev.ts || Date.now();
    // C1 情节记忆：有叙事价值的事件入记忆（kind=事件类型；重要性按类型）
    const imp = EVENT_IMPORTANCE[ev.type] ?? 0.2;
    const content = describeEvent(ev);
    if (content) this.memory.add(ev.actor ?? 'world', content, { kind: ev.type, importance: imp, participants: participantsOf(ev), ts: ev.ts });
    // C2 图谱抽取（<=3 三元组/事件）
    this.facts.commitExtraction(ev);
    // C3 情感：owner（actor 或 payload 主角）的情感分量 += 事件增量（衰减由下次加载时算）
    const owner = ev.actor ?? (ev.payload.uid as string | undefined);
    if (owner && owner !== 'system') {
      const base = loadAffect(app.db, owner) ?? emptyAffect();
      const d = affectDelta(ev.type);
      for (const em of EMOTIONS) base[em] = Math.min(1, Math.max(0, base[em] + d[em]));
      saveAffect(app.db, owner, base, now);
    }
    // C5 八卦：好感突变
    if (ev.type === 'social.fav') {
      const p = ev.payload;
      triggerGossipOnFavChange(app.db, this.memory, app.state, String(p.a), String(p.b), Number(p.delta ?? 0), ev.ts);
    }
  }

  /** 当前情感（含时间衰减） */
  currentAffect(agent: string, now = Date.now()): Record<(typeof EMOTIONS)[number], number> {
    const a = loadAffect(this.app.db, agent);
    if (!a) return emptyAffect();
    const ts = this.app.db.prepare('SELECT ts FROM agent_mood WHERE agent = ?').get(agent) as { ts: number } | undefined;
    return decayAffect(a, Math.max(0, now - (ts?.ts ?? now)), 86_400_000);
  }

  /** 行为偏好（情感 -> 动作） */
  topActions(agent: string, now = Date.now()): string[] {
    return actionPreference(this.currentAffect(agent, now)).slice(0, 3).map(a => actionLabel(a));
  }
}

const EVENT_IMPORTANCE: Record<string, number> = {
  'crop.stormDamaged': 0.9, 'crop.insurance': 0.6, 'social.fav': 0.5, 'dm.unlocked': 0.8,
  'trade.filled': 0.4, 'festival.result': 0.8, 'npc.schedule': 0.3, 'calendar.day': 0.3,
};

function participantsOf(ev: GameEvent): string[] | undefined {
  const p = ev.payload;
  const out: string[] = [];
  if (ev.actor) out.push(ev.actor);
  for (const k of ['a', 'b', 'uid', 'maker', 'taker']) if (typeof p[k] === 'string' && p[k]) out.push(p[k] as string);
  return out.length ? [...new Set(out)].slice(0, 6) : undefined;
}

function describeEvent(ev: GameEvent): string | null {
  const p = ev.payload;
  switch (ev.type) {
    case 'crop.harvested': return `收获了作物 #${p.uId}`;
    case 'crop.stormDamaged': return `风暴损毁了我的一株作物（#${p.uId}）`;
    case 'crop.insurance': return `风暴损失获得保险赔付 ${p.amount} 金币`;
    case 'social.fav': return `${p.a} 对 ${p.b} 的好感变化 ${Number(p.delta) > 0 ? '+' : ''}${p.delta}`;
    case 'dm.unlocked': return `${p.a} 与 ${p.b} 成为深交`;
    case 'trade.filled': return `与 ${p.maker} 成交：${p.qty} 件物品 @${p.price}`;
    case 'fish.caught': return `钓到了一件渔获（id ${p.itemId}）`;
    case 'festival.result': return `节日比赛：${p.winner} 夺冠（${p.festival}）`;
    case 'calendar.day': return `新的一天（${p.weather}${p.festival ? '，' + p.festival : ''}）`;
    case 'npc.schedule': return null;
    default: return null; // 低叙事价值事件不入记忆（防噪声）
  }
}

function actionLabel(a: string): string {
  const m: Record<string, string> = { chop_tree: '砍树泄愤', gift: '送礼社交', water: '浇地耕作', rest: '回屋休息', talk: '找人聊天', fish: '去河边钓鱼' };
  return m[a] ?? a;
}
