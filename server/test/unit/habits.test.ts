// test/unit/habits.test.ts —— 人设习惯引擎：爱好驱动频率 / 七维修边 / 确定性（种子=游戏日+卡id）
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildDailyHabits, loadPersonas, type PersonaCard } from '../../src/world/habits.ts';

const DATA_DIR = path.resolve(process.cwd(), '../data');
const cards = loadPersonas(DATA_DIR);

function meanWeight(c: PersonaCard | null, days: number, verbs: string[]): number {
  let sum = 0;
  for (let d = 1; d <= days; d++) sum += buildDailyHabits(c, d).ranked.find(r => verbs.includes(r.verb))!.weight;
  return +(sum / days).toFixed(3);
}

describe('loadPersonas', () => {
  it('解析一百张人设卡（七维齐全）', () => {
    expect(cards.length).toBe(100);
    for (const c of cards) {
      expect(Object.keys(c.scores).sort().join(',')).toBe('俭,勇,勤,善,正,疏,诚');
      expect(c.hobbies.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('爱好驱动行为（权重表层）', () => {
  it('钓者：拆掉爱好后钓鱼均值显著下降（同卡对照）', () => {
    const angler = cards.find(c => c.hobbies.includes('渔业'))!;
    const stripped: PersonaCard = { ...angler, hobbies: [] };
    const full = meanWeight(angler, 60, ['fish']);
    const bare = meanWeight(stripped, 60, ['fish']);
    expect(full - bare).toBeGreaterThanOrEqual(0.8);
    expect(bare).toBeLessThan(1.3);
  });

  it('矿工：拆掉爱好后挖矿均值显著下降', () => {
    const miner = cards.find(c => c.hobbies.includes('挖矿'))!;
    const stripped: PersonaCard = { ...miner, hobbies: [] };
    expect(meanWeight(miner, 60, ['mine']) - meanWeight(stripped, 60, ['mine'])).toBeGreaterThanOrEqual(0.8);
  });
});

describe('七维修边（分值与动词联动）', () => {
  it('守财奴：清零七维后赶集交易均值下降（抠门驱动经营念头）', () => {
    const miser = cards.filter(c => (c.scores['俭'] ?? 0) >= 7)[0];
    expect(miser).toBeTruthy();
    const neutral: PersonaCard = { ...miser, scores: {} };
    expect(meanWeight(miser, 60, ['market']) - meanWeight(neutral, 60, ['market'])).toBeGreaterThan(0.2);
  });

  it('喜独处者（合成卡：疏=-8 无社交爱好）：独处三动词均值高于热闹两动词', () => {
    const loner: PersonaCard = { id: 9001, name: '独处者', tone: '随和', hobbies: ['种田'], scores: { '善': 0, '诚': 0, '勤': 5, '俭': 0, '疏': -8, '勇': 0, '正': 0 }, total: -3, note: '' };
    const neutral: PersonaCard = { ...loner, scores: {} };
    const soloFull = ['fish', 'mine', 'decor'].reduce((s, v) => s + meanWeight(loner, 60, [v]), 0) / 3;
    const socialFull = ['festival', 'market'].reduce((s, v) => s + meanWeight(loner, 60, [v]), 0) / 2;
    const soloNeutral = ['fish', 'mine', 'decor'].reduce((s, v) => s + meanWeight(neutral, 60, [v]), 0) / 3;
    expect(soloFull).toBeGreaterThan(socialFull);
    expect(soloFull - soloNeutral).toBeGreaterThan(0.2);
  });
});

describe('确定性（回放一致性）', () => {
  it('同一 (卡, 游戏日) 两次调用结果逐字相同；换日即变', () => {
    const c = cards[5];
    const a = JSON.stringify(buildDailyHabits(c, 40));
    expect(a).toBe(JSON.stringify(buildDailyHabits(c, 40)));
    expect(a).not.toBe(JSON.stringify(buildDailyHabits(c, 41)));
  });

  it('无卡时全部动词等权中性（不改变无关角色行为）', () => {
    const r = buildDailyHabits(null, 9).ranked;
    expect(r.map(x => x.weight).every(w => w > 0.99 && w < 1.16)).toBe(true);
  });
});

describe('习惯语（提示词层）', () => {
  it('有卡出非空短句（<=40 字）、无卡为空串', () => {
    const s = buildDailyHabits(cards[0], 7).sentence;
    expect(s.length).toBeGreaterThan(4);
    expect(s.length).toBeLessThanOrEqual(40);
    expect(buildDailyHabits(null, 7).sentence).toBe('');
  });
});