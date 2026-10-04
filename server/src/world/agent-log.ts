// world/agent-log.ts —— Agent 行为流水（"他刚才干了什么"的事实源）
//
// 事故背景：玩家问 Agent「你刚才干了什么」，Agent 只能靠自己的日记/记忆回答 ——
// 日记是 LLM 自己写的，可能没写、可能写错，于是玩家拿到的是编造的答案。
// 现在每次 act（成功与失败都记）都落一条结构化流水，回答时先读流水再作答，
// 「刚才干了什么」变成可核对的事实而不是叙事。
//
// 存储：世界桶 agentLogData（每 uid 一条环形 200 条，已登记 WORLD_KEYS）。
import type { WorldState } from '../persistence/state.ts';
import type { Tables } from './tables.ts';

export const AGENT_LOG_KEY = 'agentLogData';
const MAX_PER_UID = 200;

export interface AgentOp {
  ts: number;
  day: number;
  action: string;
  ok: boolean;
  detail: string;   // 动作结果的中文摘要（截断）
  scene?: number;
  x?: number;
  y?: number;
  /** P3：本次动作所依据的规则提示词 hash（对话/规划类才有；旧行无此字段，兼容降级） */
  rulesHash?: string;
}

interface LogData { ops: Record<string, AgentOp[]> }

function data(state: WorldState): LogData {
  let d = state.world.get(AGENT_LOG_KEY) as LogData | undefined;
  if (!d || !d.ops) { d = { ops: {} }; state.world.set(AGENT_LOG_KEY, d); }
  return d;
}

/** 记一条行为（act 统一出口调用；detail 传结果 msg，失败也记 —— 「为什么没做成」同样要能回答） */
export function recordAgentOp(state: WorldState, uid: string, op: Omit<AgentOp, 'ts'> & { ts?: number }, cap = 400): void {
  const d = data(state);
  const arr = d.ops[uid] || (d.ops[uid] = []);
  arr.push({ ts: op.ts ?? Date.now(), ...op });
  while (arr.length > cap) arr.shift();
  void MAX_PER_UID;
}

/** 最近 n 条（倒序，最新在前） */
export function opsOf(state: WorldState, uid: string, n = 20): AgentOp[] {
  const arr = data(state).ops[uid] || [];
  return arr.slice(-Math.max(1, Math.min(200, n))).reverse();
}

/** 相对时间（中文，分钟/小时级） */
function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  return `${Math.round(s / 86400)} 天前`;
}

/** 动作中文名（文案即契约：玩家与 Agent 看的是同一份表） */
const ACTION_CN: Record<string, string> = {
  move: '移动', move_to: '前往', chat: '发言', talk: '搭话', buy: '购买', trade: '交易',
  till: '犁地', plant: '播种', water: '浇水', harvest: '收获', chop: '砍树', fish: '钓鱼',
  mine: '挖矿', place: '放置', build: '建造', cook: '烹饪', adopt: '收养', feed: '喂食',
  decor_place: '摆家具', decor_remove: '收家具', courtyard: '看庭院', stall: '开摊',
  letter: '写信', give: '送礼', bind: '结关系', forecast: '看天气', train: '训练',
  report: '资产日报', claim: '认领', release: '放弃认领', claims: '查看认领',
  lease: '租约', delegate: '委托', reply: '回话', recap: '回顾', mail: '看信箱',
  tasks: '看任务', onboarding: '看引导', season: '看时令', animals: '看畜牧',
};

export function actionCn(a: string): string {
  return ACTION_CN[a] || a;
}

/** 流水文本（观察与回复共用；`now` 传入便于测试确定性） */
export function recapLines(state: WorldState, uid: string, n = 12, now = Date.now()): string[] {
  return opsOf(state, uid, n).map(op => {
    const mark = op.ok ? '' : '（未成）';
    const detail = (op.detail || '').slice(0, 60);
    return `${ago(op.ts, now)} 第${op.day}天 ${actionCn(op.action)}${mark}${detail ? '：' + detail : ''}`;
  });
}

/** 流水结构（observe.recap / /af/agent-recap 用） */
export function recapView(state: WorldState, uid: string, n = 12, now = Date.now()): {
  total: number; recent: Array<{ at: number; ago: string; day: number; action: string; actionCn: string; ok: boolean; detail: string; scene?: number; x?: number; y?: number; rulesHash?: string }>;
  lines: string[];
  note: string;
  /** 最近一次带 rulesHash 的规则版本（旧行无该字段 → null，归因降级不报错） */
  rulesHash?: string | null;
} | null {
  const ops = opsOf(state, uid, n);
  if (!ops.length) return null;
  const recent = ops.map(op => ({ at: op.ts, ago: ago(op.ts, now), day: op.day, action: op.action, actionCn: actionCn(op.action), ok: op.ok, detail: op.detail, scene: op.scene, x: op.x, y: op.y, rulesHash: op.rulesHash }));
  const withHash = [...recent].reverse().find((r) => !!r.rulesHash);
  return {
    total: (data(state).ops[uid] || []).length,
    recent,
    lines: recapLines(state, uid, n, now),
    note: `最近 ${ops.length} 条行为流水（世界桶 ${AGENT_LOG_KEY}，玩家与 Agent 共用同一份事实）`,
    rulesHash: withHash?.rulesHash ?? null,
  };
}

/** 供 MCP/工具层把流水接进 LLM 上下文时的紧凑文本 */
export function recapText(state: WorldState, uid: string, n = 12, now = Date.now()): string {
  const lines = recapLines(state, uid, n, now);
  return lines.length ? lines.join('\n') : '（还没有任何行为记录）';
}

/** 测试与运维：清空某 uid 流水 */
export function clearAgentOps(state: WorldState, uid: string): void {
  delete data(state).ops[uid];
}

export type { Tables };