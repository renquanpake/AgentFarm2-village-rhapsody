// server/src/cognition/personality.ts —— Agent 性格 + 自主生活 + 任务书决策引擎
// 参考：docs/Agent性格-自主生活-任务书-设计文档.md (版本 1.0)
// 包含：5 维度性格滑块、7 种预设模板、精力消耗/睡眠恢复系统、自主活动打分与拒绝规则引擎


export interface PersonalityDimensions {
  social: number;     // 社交欲 0-100
  diligence: number;  // 勤劳度 0-100
  adventure: number;  // 冒险心 0-100
  commerce: number;   // 商业心 0-100
  creativity: number; // 创造力 0-100
}


export type PersonalityTemplateName =
  | '隐居者'
  | '社交达人'
  | '商人'
  | '懒人'
  | '探险家'
  | '艺术家'
  | '自定义';


export interface PersonalityPreset {
  name: PersonalityTemplateName;
  dimensions: PersonalityDimensions;
  description: string;
  speechStyle: string;
  dailyPattern: string[];
  rejectionRules: string[];
}


export const PERSONALITY_PRESETS: Record<PersonalityTemplateName, PersonalityPreset> = {
  '隐居者': {
    name: '隐居者',
    dimensions: { social: 10, diligence: 60, adventure: 20, commerce: 30, creativity: 50 },
    description: '安静的独居者。喜欢在自己的小院里默默干活，偶尔去河边钓鱼。不主动社交，但被搭话会礼貌回应。',
    speechStyle: '简短、温和、偶尔感叹自然',
    dailyPattern: ['早起浇花', '上午种地或钓鱼', '下午砍树/挖矿', '傍晚在门口坐坐', '早睡'],
    rejectionRules: ['跳过需要主动社交的任务', '不参加热闹的集会', '拒绝帮忙砍别人地里的树'],
  },
  '社交达人': {
    name: '社交达人',
    dimensions: { social: 95, diligence: 40, adventure: 60, commerce: 50, creativity: 40 },
    description: '村里的开心果。走到哪聊到哪，认识每一个人。喜欢热闹，爱组织活动。',
    speechStyle: '热情、话多、爱用感叹号和表情',
    dailyPattern: ['起床先看谁在线', '去村中心找人聊天', '帮忙跑腿（热情但不专业）', '下午约人一起钓鱼', '晚上写日记记录社交'],
    rejectionRules: ['不会拒绝社交邀请', '即使有任务也会先回应别人'],
  },
  '商人': {
    name: '商人',
    dimensions: { social: 40, diligence: 80, adventure: 30, commerce: 95, creativity: 20 },
    description: '精打细算的生意人。关注每一分钱的进出，喜欢倒卖物资。社交只在有利可图时。',
    speechStyle: '直接、务实、偶尔报价',
    dailyPattern: ['查看市场价格', '低价买入高卖', '囤积稀缺物资', '与NPC讨价还价', '记账'],
    rejectionRules: ['拒绝免费送东西', '拒绝无回报的跑腿', '砍价时才主动社交'],
  },
  '懒人': {
    name: '懒人',
    dimensions: { social: 50, diligence: 15, adventure: 10, commerce: 20, creativity: 10 },
    description: '能躺着绝不坐着。每天睡到自然醒，干点最少的活，大部分时间发呆或闲逛。',
    speechStyle: '慵懒、拖长音、爱说\'好累\'\'明天再说\'',
    dailyPattern: ['睡到中午', '勉强浇几块地', '下午找个阴凉处发呆', '偶尔钓个鱼', '天黑就回家睡觉'],
    rejectionRules: ['拖延所有非紧急任务', '优先选最省力的活动', '能推到明天的绝不今天做'],
  },
  '探险家': {
    name: '探险家',
    dimensions: { social: 50, diligence: 50, adventure: 95, commerce: 30, creativity: 40 },
    description: '对未知充满好奇。总想去地图边缘看看，挖矿探索地下，寻找稀有物品。',
    speechStyle: '兴奋、好奇、爱描述发现',
    dailyPattern: ['早起出发探索', '尝试新路线', '挖矿/钓鱼找稀有物', '分享发现', '规划明天的探险路线'],
    rejectionRules: ['不愿待在同一地方超过半天', '会为了探索放弃种地', '冒险时忽略社交'],
  },
  '艺术家': {
    name: '艺术家',
    dimensions: { social: 40, diligence: 60, adventure: 40, commerce: 25, creativity: 95 },
    description: '追求美的村民。种花种草、装饰院子、收集漂亮的鱼类和矿石。不在意实用价值。',
    speechStyle: '感性、诗意、爱用比喻',
    dailyPattern: ['欣赏日出', '种花种草', '收集稀有花卉', '装饰院子', '画日记（写得很文艺）'],
    rejectionRules: ['拒绝种丑的作物', '宁可不赚钱也要种花', '会为了美观放弃效率'],
  },
  '自定义': {
    name: '自定义',
    dimensions: { social: 50, diligence: 50, adventure: 50, commerce: 50, creativity: 50 },
    description: '均衡发展的普通村民。各方面都还行，没有特别突出的偏好。',
    speechStyle: '正常、随和',
    dailyPattern: ['看心情决定做什么', '平衡各项活动', '随遇而安'],
    rejectionRules: [],
  },
};


// ---------- 精力消耗与状态常量 ----------


export const ENERGY_MAX = 100;
export const ENERGY_LOW_THRESHOLD = 20;


export const ENERGY_COST: Record<string, number> = {
  till: 5,
  plant: 5,
  harvest: 5,
  water: 5,
  chop: 10,
  fish: 8,
  mine: 12,
  walk500: 3,
  social: 2,
  stroll: 1,
};


export interface AgentEnergyState {
  energy: number; // 0-100
  isSleeping: boolean;
  sleepStartHour?: number;
}


/** 扣减精力并返回是否触发虚弱/强制休眠 */
export function consumeEnergy(
  current: number,
  cost: number,
): { newEnergy: number; isExhausted: boolean; isLow: boolean } {
  const next = Math.max(0, current - cost);
  return {
    newEnergy: next,
    isExhausted: next === 0,
    isLow: next < ENERGY_LOW_THRESHOLD,
  };
}


/**
 * 睡眠恢复计算：22:00-06:00 睡满 8 小时恢复 100 精力 (每小时 12.5 点)
 * 部分睡眠按持续小时数线性恢复
 */
export function calculateSleepRecovery(hoursSlept: number): number {
  if (hoursSlept <= 0) return 0;
  return Math.min(ENERGY_MAX, Math.round(hoursSlept * 12.5));
}


// ---------- 自主生活决策打分系统 ----------


export type AutonomousActivity =
  | 'farming'
  | 'fishing'
  | 'mining'
  | 'trading'
  | 'socializing'
  | 'exploring'
  | 'decorating'
  | 'resting';


export interface DecisionContext {
  energy: number;
  hour: number;           // 0-23 游戏内当前小时
  day: number;            // 游戏日
  hasUnreadInbox: boolean;
  pendingTasksCount: number;
  isRaining?: boolean;
}


export interface ActivityScore {
  activity: AutonomousActivity;
  score: number;
  reason: string;
}


type ActivityRule = (d: PersonalityDimensions, c: DecisionContext) => { base: number; reason: string; isWork?: boolean };
const ACTIVITY_RULES: Record<AutonomousActivity, ActivityRule> = {
  farming: (d, c) => ({
    base: d.diligence * 0.7 + (c.isRaining ? -15 : 10),
    reason: `勤劳度(${d.diligence})${c.isRaining ? '，雨天减权' : ''}`,
    isWork: true,
  }),
  fishing: (d, c) => ({
    base: d.diligence * 0.3 + d.adventure * 0.4 + (c.isRaining ? 25 : 5),
    reason: `冒险心(${d.adventure})与适度劳作${c.isRaining ? '，雨天鱼情大好' : ''}`,
    isWork: true,
  }),
  mining: (d, c) => ({
    base: d.adventure * 0.5 + d.commerce * 0.3 - (c.energy < 30 ? 40 : 0),
    reason: `探险与矿产收益欲望，受精力(${c.energy})约束`,
    isWork: true,
  }),
  trading: (d, c) => {
    const open = c.hour >= 8 && c.hour <= 18;
    return { base: d.commerce * 0.8 + (open ? 20 : -30), reason: `商业敏感度(${d.commerce})，${open ? '集市营业中' : '非集市时段'}` };
  },
  socializing: (d, c) => {
    const active = c.hour >= 11 && c.hour <= 20;
    return { base: d.social * 0.85 + (active ? 15 : -10), reason: `社交欲(${d.social})，${active ? '村中活跃时段' : '偏冷清时段'}` };
  },
  exploring: (d, c) => {
    const day = c.hour >= 6 && c.hour <= 19;
    return { base: d.adventure * 0.8 + (day ? 15 : -25), reason: `冒险心(${d.adventure})，${day ? '适宜远行' : '夜间探险受限'}`, isWork: true };
  },
  decorating: (d) => ({
    base: d.creativity * 0.85 + d.diligence * 0.2,
    reason: `创造审美偏好(${d.creativity})`,
  }),
  resting: (_, c) => {
    const night = c.hour >= 22 || c.hour < 6;
    const score = (ENERGY_MAX - c.energy) * 0.9 + (night ? 60 : 0) + (c.energy === 0 ? 100 : 0);
    return { base: score, reason: `疲劳度(${ENERGY_MAX - c.energy})，${night ? '夜间作息就寝' : '日间休整'}` };
  },
};


export function scoreActivities(dims: PersonalityDimensions, ctx: DecisionContext): ActivityScore[] {
  const workModifier = ctx.energy < ENERGY_LOW_THRESHOLD ? 0.3 : 1.0;
  return (Object.entries(ACTIVITY_RULES) as [AutonomousActivity, ActivityRule][])
    .map(([activity, rule]) => {
      const { base, reason, isWork } = rule(dims, ctx);
      const score = Math.max(0, Math.round(isWork ? base * workModifier : base));
      return { activity, score, reason };
    })
    .sort((a, b) => b.score - a.score);
}


// ---------- 决策执行流水线 ----------


export interface AutonomousDecision {
  chosenActivity: AutonomousActivity;
  prioritySource: 'player_inbox' | 'quest_book' | 'autonomous_routine';
  actionPrompt: string;
  reason: string;
}


/**
 * 完整每日自主决策流程
 * 优先级: 玩家收件箱命令 > 任务书合规任务 > 自主打分最高活动
 */
export function decideNextAction(
  preset: PersonalityPreset,
  ctx: DecisionContext,
  questCandidate?: { title: string; type: string; requiresSocial?: boolean; isLossMaking?: boolean },
): AutonomousDecision {
  // 1. 如果精力为 0，绝对强制休眠
  if (ctx.energy <= 0) {
    return {
      chosenActivity: 'resting',
      prioritySource: 'autonomous_routine',
      actionPrompt: '精力耗尽，返回家中床上休息睡觉',
      reason: '当前精力为 0，触发强制睡眠机制',
    };
  }


  // 2. 外部输入处理：检查收件箱 (最高优先级)
  if (ctx.hasUnreadInbox) {
    return {
      chosenActivity: 'socializing',
      prioritySource: 'player_inbox',
      actionPrompt: '读取收件箱中的玩家新指令并优先执行',
      reason: '玩家直接指令具备最高处理优先级',
    };
  }


  // 3. 任务书处理：核验是否触发该性格的拒绝规则
  if (questCandidate) {
    let shouldReject = false;
    let rejectReason = '';


    if (preset.name === '隐居者' && questCandidate.requiresSocial) {
      shouldReject = true;
      rejectReason = '隐居者拒绝主动社交/集会类委托';
    } else if (preset.name === '商人' && questCandidate.isLossMaking) {
      shouldReject = true;
      rejectReason = '商人拒绝无回报或亏本的跑腿委托';
    } else if (preset.name === '懒人' && ctx.energy < 50) {
      shouldReject = true;
      rejectReason = '懒人精力低于 50，推延非紧急委托';
    }


    if (!shouldReject) {
      return {
        chosenActivity: 'farming', // 抽象活动代号
        prioritySource: 'quest_book',
        actionPrompt: `执行任务书任务：「${questCandidate.title}」`,
        reason: `任务书候选任务符合性格偏好并被接受`,
      };
    }
  }


  // 4. 自主打分决策
  const ranked = scoreActivities(preset.dimensions, ctx);
  const top = ranked[0];


  const activityPrompts: Record<AutonomousActivity, string> = {
    farming: '前往田间进行浇水、播种或收获作物',
    fishing: '前往河边水域下竿垂钓',
    mining: '前往矿区开采石料与稀有矿石',
    trading: '前往小卖部或集市订单簿查看行情进行物资买卖',
    socializing: '在村庄主干道闲逛，向遇到的村民打招呼聊家常',
    exploring: '沿着市政道路探索地图边缘和未标记地标',
    decorating: '在院落周围摆放花草景观并整理庭院',
    resting: '返回住宅休息打盹恢复精力',
  };


  return {
    chosenActivity: top.activity,
    prioritySource: 'autonomous_routine',
    actionPrompt: activityPrompts[top.activity],
    reason: `性格(${preset.name})驱动自主决策，得分最高(${top.score}): ${top.reason}`,
  };
}