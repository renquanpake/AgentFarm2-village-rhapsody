// cognition/goals.ts —— C4 目标层级 + 睡眠期整理（design M4.4-M4.5）
// goals 表三层：life（persona 派生）/ daily（每晨规划）/ action（当前）；
// 睡眠期任务序列：反思归纳 -> 图谱清洗 -> 关系摘要 -> 次日计划（强档 LLM；无 Key 走规则兜底），限每日 1 次。
import { DatabaseSync } from 'node:sqlite';

export interface GoalRec {
  id: number; agent: string; tier: 'life' | 'daily' | 'action';
  parent: number | null; text: string; status: 'active' | 'done' | 'dropped';
  made_at: number; done_at: number | null;
}

export class GoalStore {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  add(agent: string, tier: GoalRec['tier'], text: string, parent?: number, madeAt = Date.now()): number {
    const info = this.db.prepare(
      'INSERT INTO goals (agent, tier, parent, text, status, made_at, done_at) VALUES (?, ?, ?, ?, \'active\', ?, NULL)'
    ).run(agent, tier, parent ?? null, text, madeAt);
    return Number(info.lastInsertRowid);
  }

  active(agent: string, tier?: GoalRec['tier']): GoalRec[] {
    const rows = tier
      ? this.db.prepare('SELECT * FROM goals WHERE agent = ? AND tier = ? AND status = \'active\' ORDER BY made_at ASC').all(agent, tier)
      : this.db.prepare('SELECT * FROM goals WHERE agent = ? AND status = \'active\' ORDER BY tier DESC, made_at ASC').all(agent);
    return (rows as Array<Record<string, unknown>>).map(r => this.row(r));
  }

  private row(r: Record<string, unknown>): GoalRec {
    return {
      id: Number(r.id), agent: String(r.agent), tier: r.tier as GoalRec['tier'],
      parent: r.parent ? Number(r.parent) : null, text: String(r.text),
      status: r.status as GoalRec['status'], made_at: Number(r.made_at),
      done_at: r.done_at ? Number(r.done_at) : null,
    };
  }

  complete(agent: string, goalId: number, now = Date.now()): void {
    this.db.prepare("UPDATE goals SET status = 'done', done_at = ? WHERE id = ? AND agent = ? AND status = 'active'").run(now, goalId, agent);
  }

  /** 派生 life 层（persona 派生；幂等：已有 life 则跳过） */
  ensureLifeGoals(agent: string, persona: string, now = Date.now()): void {
    const has = this.db.prepare("SELECT COUNT(*) n FROM goals WHERE agent = ? AND tier = 'life'").get(agent) as { n: number };
    if (has.n) return;
    // 按人设派生三层 life 目标（规则兜底；LLM 版走 M7 强档）
    const lines: Record<string, string[]> = {
      default: ['成为村里有名的农夫', '存够 1000 金币', '交三个深交好友'],
      farmer: ['把农田扩到最大', '种出最漂亮的作物', '成为集市最受欢迎卖家'],
      angler: ['钓齐所有鱼种', '成为钓鱼大赛冠军', '攒够一条金龙鱼的钱'],
      social: ['成为村里人脉王', '解锁全部深交', '主持一场节日聚会'],
    };
    for (const t of lines[persona] ?? lines.default) this.add(agent, 'life', t, undefined, now);
  }

  /** 次日计划（daily 层）：输入 目标树+情感+记忆摘要+天气 -> 可执行计划列表（规则兜底版） */
  planDaily(agent: string, ctx: { persona: string; weather: string; festival: string | null; memorySummary: string[]; topActions: string[] }, now = Date.now()): number[] {
    const ids: number[] = [];
    const festivalGoal = ctx.festival ? `参加${ctx.festival}活动` : null;
    const plans = [
      festivalGoal,
      ...ctx.topActions.slice(0, 3).map(a => `执行：${a}`),
      '查看并浇水/收获成熟作物',
      ctx.weather === 'rain' ? '雨天屋内整理与社交' : '外出劳作',
    ].filter(Boolean) as string[];
    for (const p of plans) ids.push(this.add(agent, 'daily', p, undefined, now));
    return ids;
  }
}

export interface SleepCycleResult {
  reflected: string;
  factsRevised: number;
  relationSummary: string;
  dailyGoalIds: number[];
  at: number;
}

/** 睡眠期整理：反思 -> 图谱清洗 -> 关系摘要 -> 次日计划（每日 1 次；强档 LLM 编排点，此处规则兜底） */
export function runSleepCycle(db: DatabaseSync, agent: string, ctx: {
  persona: string;
  weather: string;
  festival: string | null;
  memorySummary: string[];
  facts: import('./facts.ts').FactStore;
  goals: GoalStore;
  topActions: string[];
  lastSleepDay?: number;
  currentDay: number;
}): SleepCycleResult | null {
  if (ctx.lastSleepDay === ctx.currentDay) return null; // 限每日 1 次
  // 1) 反思归纳（写进 memory 的 summary；规则版=最近记忆前 3 条拼接）
  const reflected = ctx.memorySummary.slice(0, 3).join('；') || '（无新记忆）';
  // 2) 图谱清洗：低置信旧事实失效
  const factsRevised = ctx.facts.sleepRevision(Date.now());
  // 3) 关系摘要：当前事实里 social 类三元组数量
  const relFacts = ctx.facts.current(agent).filter(f => f.predicate.startsWith('related') || f.predicate === 'deep_friend' || f.predicate === 'favors');
  const relationSummary = relFacts.length ? `当前关系事实 ${relFacts.length} 条` : '暂无关系事实';
  // 4) 次日计划
  const dailyGoalIds = ctx.goals.planDaily(agent, { persona: ctx.persona, weather: ctx.weather, festival: ctx.festival, memorySummary: ctx.memorySummary, topActions: ctx.topActions });
  return { reflected, factsRevised, relationSummary, dailyGoalIds, at: Date.now() };
}
