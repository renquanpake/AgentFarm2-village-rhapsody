// cognition/occ.ts —— C3 OCC 情感模型（design M4.3）：8 主分量 + 指数衰减半衰期 1 游戏日 + 行为权重映射
// 事件评价规则表（事件类型 x 人设权重 -> 分量增量）；行为权重表把情感映射到动作偏好
//（愤怒时倾向砍树泄愤、喜悦时倾向送礼）。
import { DatabaseSync } from 'node:sqlite';

export type Emotion = 'joy' | 'distress' | 'hope' | 'fear' | 'anger' | 'gratitude' | 'compassion' | 'jealousy';
export const EMOTIONS: Emotion[] = ['joy', 'distress', 'hope', 'fear', 'anger', 'gratitude', 'compassion', 'jealousy'];

export type ActionPref = 'chop_tree' | 'gift' | 'water' | 'rest' | 'talk' | 'fish';

// 事件评价规则：事件类型 -> 各分量基础增量（人设权重可放大/翻转）
const EVENT_AFFECTS: Record<string, Partial<Record<Emotion, number>>> = {
  'crop.harvested': { joy: 0.5, hope: 0.2 },
  'plant.sown': { hope: 0.3 },
  'crop.watered': { joy: 0.1 },
  'social.fav': { joy: 0.3, gratitude: 0.2 },
  'dm.unlocked': { joy: 0.5, gratitude: 0.3 },
  'fish.caught': { joy: 0.4 },
  'trade.filled': { joy: 0.2, hope: 0.1 },
  'crop.stormDamaged': { distress: 0.6, fear: 0.3 },
  'crop.insurance': { hope: 0.4, gratitude: 0.2 },
  'tree.chopped': { joy: 0.2 },
  'gossip.overheard': { jealousy: 0.3, distress: 0.1 },
};

/** 人设权重（agent 级）：放大/翻转基础增量（缺省 1.0） */
export type PersonaWeights = Partial<Record<Emotion, number>>;

/** 情感分量状态（0-1） */
export type AffectState = Record<Emotion, number>;

export function emptyAffect(): AffectState {
  return { joy: 0, distress: 0, hope: 0, fear: 0, anger: 0, gratitude: 0, compassion: 0, jealousy: 0 };
}

/** 事件 -> 分量增量（基础 x 人设权重；愤怒类事件额外加 anger） */
export function affectDelta(eventType: string, persona: PersonaWeights = {}): AffectState {
  const d = emptyAffect();
  const base = EVENT_AFFECTS[eventType];
  if (!base) {
    // 未知事件：轻微好奇（hope）
    d.hope = 0.05;
  } else {
    for (const [em, amt] of Object.entries(base)) d[em as Emotion] = (amt as number) * (persona[em as Emotion] ?? 1);
  }
  if (eventType === 'crop.stormDamaged') d.anger = (d.anger ?? 0) + 0.2 * (persona.anger ?? 1);
  return d;
}

/** 指数衰减（半衰期 1 游戏日）：comp * 0.5^(ageMs/halfLifeMs) */
export function decayAffect(a: AffectState, ageMs: number, halfLifeMs: number): AffectState {
  const f = Math.pow(0.5, ageMs / halfLifeMs);
  const out = emptyAffect();
  for (const em of EMOTIONS) out[em] = (a[em] ?? 0) * f;
  return out;
}

/** 情感 -> 动作偏好（行为权重表；返回排序后的偏好列表） */
export function actionPreference(a: AffectState): ActionPref[] {
  const score: Record<ActionPref, number> = {
    chop_tree: a.anger * 2 + a.distress,
    gift: a.joy + a.gratitude + a.compassion,
    water: a.hope,
    rest: a.fear + a.distress,
    talk: a.compassion + a.joy * 0.5,
    fish: a.joy * 0.5 + a.hope * 0.5,
  };
  return (Object.keys(score) as ActionPref[]).sort((x, y) => score[y] - score[x]);
}

/** 情感持久化（agent_mood 表；缺表时静默跳过） */
export function saveAffect(db: DatabaseSync, agent: string, a: AffectState, ts: number): void {
  try {
    db.prepare('INSERT INTO agent_mood (agent, comps, ts) VALUES (?, ?, ?) ON CONFLICT(agent) DO UPDATE SET comps = excluded.comps, ts = excluded.ts')
      .run(agent, JSON.stringify(a), ts);
  } catch { /* 表未迁移 */ }
}

export function loadAffect(db: DatabaseSync, agent: string): AffectState | null {
  try {
    const row = db.prepare('SELECT comps FROM agent_mood WHERE agent = ?').get(agent) as { comps: string } | undefined;
    return row ? { ...emptyAffect(), ...JSON.parse(row.comps) } : null;
  } catch { return null; }
}
