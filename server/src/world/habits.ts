// world/habits.ts —— 人设习惯引擎（grillme Q36=C 双层 / Q37=B 七维全参与）
// 爱好标签给动词加权、七维分值修边；每个游戏日产出一份「今日倾向」：
//   sentence  喂大脑的习惯语（提示词层）
//   ranked    排序后的动词候选（权重表层），调用方可据此排次日计划动作
// 确定性硬约束：种子 = f(游戏日, 卡id)，现实时钟不参与——回放一致性（门9）要求同输入同输出。
import path from 'node:path';
import { loadJson } from '../persistence/state.ts';

export interface PersonaCard {
  id: number;
  name: string;
  tone: string;
  hobbies: string[];
  scores: Record<string, number>;
  total: number;
  note: string;
}

export interface HabitVerb {
  verb: string;
  label: string;
  weight: number;
}

const VERBS: Record<string, string> = {
  fish: '钓鱼', farm: '种田', chop: '砍树', mine: '挖矿',
  market: '赶集交易', cook: '烹饪', animal: '畜牧', decor: '布置家具', festival: '节日活动',
};
const VERB_IDS = Object.keys(VERBS);
const HOBBY_VERB: Record<string, string[]> = {
  烹饪: ['cook'], 种田: ['farm'], 砍树: ['chop'], 林业: ['chop'],
  渔业: ['fish'], 挖矿: ['mine'], 赶集: ['market'], 家具: ['decor'],
  畜牧: ['animal'], 节日: ['festival'],
};
const HOBBY_BASE = 3;
const JITTER = 0.15;

const TONE_ADJ: Record<string, string> = {
  暖光: '热心得发亮', 暖心: '心地温热', 温吞: '慢吞吞却实心',
  随和: '随和自在', 阴冷: '凉飕飕地精明', 乖戾: '嘴上不饶人', 寒渊: '冷气从骨缝里冒',
};
const HOBBY_LINE: Record<string, string> = {
  fish: '今天多去水边坐坐。', farm: '惦记着把地里的活赶一赶。', chop: '背起斧头想去林子转转。',
  mine: '盘算着下矿洞挖一窑。', market: '满脑子琢磨怎么赚一笔。', cook: '想掌勺弄顿好的。',
  animal: '牵挂棚里的牲口。', decor: '想把家里拾掇得舒坦些。', festival: '盼着村里凑个热闹。',
};
const DIM_CLAUSE: Record<string, string> = {
  '俭≥7': '花钱抠到骨子里。', '俭≤-7': '手松得兜不住钱。',
  '疏≤-7': '一个人待着才痛快。', '勇≥7': '见着能争的事就眼红。',
};

let cacheKey = '';
let cacheCards: PersonaCard[] = [];

/** 载入人设库（按文件路径缓存；缺文件回落空表，行为不变） */
export function loadPersonas(dataDir: string): PersonaCard[] {
  const file = path.join(dataDir, 'personalities.json');
  try {
    const raw = loadJson<{ cards?: PersonaCard[] }>(file, { cards: [] });
    if (!raw || !Array.isArray(raw.cards)) return [];
    const cards = raw.cards;
    const key = file + ':' + cards.length;
    if (key !== cacheKey) { cacheKey = key; cacheCards = cards; }
    return cacheCards;
  } catch { return []; }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dimMul(dim: string, s: number): Partial<Record<string, number>> {
  // 七维修边规则：|分值|<4 视为中性不动权重，>=4 按档放大对应动词
  const out: Partial<Record<string, number>> = {};
  if (dim === '俭') {
    if (s >= 4) out.market = 1 + 0.05 * s;        // 抠门：经营念头重
    else if (s <= -4) { out.cook = 1 - 0.05 * s; out.festival = 1 - 0.05 * s; } // 挥霍：往享受上花钱
  } else if (dim === '疏') {
    if (s >= 4) { out.festival = 1 + 0.04 * s; out.market = 1 + 0.02 * s; }       // 爱热闹
    else if (s <= -4) { out.fish = 1 - 0.04 * s; out.mine = 1 - 0.04 * s; out.decor = 1 - 0.04 * s; } // 喜独处
  } else if (dim === '勇') {
    if (s >= 4) out.festival = 1 + 0.04 * s;      // 好胜：冲比赛集市
    else if (s <= -4) { out.farm = 1 - 0.03 * s; out.cook = 1 - 0.03 * s; }      // 避冲突：平和劳作
  } else if (dim === '善') {
    if (s >= 4) { out.cook = 1 + 0.03 * s; out.animal = 1 + 0.03 * s; }          // 善意：做饭分享/照看牲口
  } else if (dim === '诚') {
    if (s <= -4) out.market = 1 + 0.03 * (-s);   // 不实：钻营买卖
  }
  return out;
}

/** 某游戏日该角色的习惯倾向（无卡=中性基线，行为与旧版一致） */
export function buildDailyHabits(card: PersonaCard | null, gameDay: number): { sentence: string; ranked: HabitVerb[] } {
  const rng = mulberry32((Math.imul(gameDay, 1000003) ^ Math.imul(card?.id ?? -1, 2654435761)) >>> 0);
  const w: Record<string, number> = {};
  for (const v of VERB_IDS) w[v] = 1;
  let topVerb = 'farm';
  if (card) {
    const diligence = 1 + (card.scores['勤'] ?? 0) * 0.05;   // 勤修边：勤快放大爱好，懒散压平
    const boosts: Record<string, number> = {};
    for (const h of card.hobbies) for (const v of HOBBY_VERB[h] ?? []) boosts[v] = (boosts[v] ?? 0) + HOBBY_BASE * Math.max(0.4, diligence);
    for (const v of Object.keys(boosts)) w[v] += boosts[v];
    for (const dim of Object.keys(card.scores)) {
      const mul = dimMul(dim, card.scores[dim]);
      for (const v of Object.keys(mul)) w[v] *= mul[v]!;
    }
    topVerb = (Object.keys(boosts).sort((a, b) => boosts[b] - boosts[a])[0]) ?? 'farm';
  }
  const ranked = VERB_IDS
    .map(v => ({ verb: v, label: VERBS[v], weight: +(w[v] + rng() * JITTER).toFixed(3) }))
    .sort((a, b) => b.weight - a.weight);
  let sentence = '';
  if (card) {
    sentence = `${TONE_ADJ[card.tone] ?? '随和'}${HOBBY_LINE[topVerb] ?? '惦记着手头的活。'}`;
    for (const k of ['俭≥7', '俭≤-7', '疏≤-7', '勇≥7']) {
      if (k.startsWith('俭')) { const s = card.scores['俭']; if ((k.endsWith('≥7') && s >= 7) || (k.endsWith('-7') && s <= -7)) { sentence += DIM_CLAUSE[k]; break; } }
      else { const s = card.scores[k.endsWith('≤-7') ? '疏' : '勇']; if ((k.endsWith('≥7') && s >= 7) || (k.endsWith('-7') && s <= -7)) { sentence += DIM_CLAUSE[k]; break; } }
    }
  }
  return { sentence, ranked };
}

/** 抽卡落档（village-life 下期端点用）：globals.afCardAssign.val[uid]=cardId，重抽即覆盖 */
export function rememberCard(state: import('../persistence/state.ts').WorldState, uid: string, cardId: number): void {
  const raw = state.globals.get('afCardAssign');
  const map = (typeof raw === 'object' && raw !== null ? (raw as { val?: Record<string, number> }).val : {}) as Record<string, number>;
  map[uid] = cardId;
  state.globals.set('afCardAssign', { val: map } as never);
}