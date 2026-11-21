// world/persona-drift.ts —— 人设分值双向漂移（养育演变）
// 社交/恶意事件 -> 相关角色七维分值微调 -> 累计进 globals.afPersonaDrift（per-player，
// 不污染共享 personalities.json）；回放一致性：规则确定性、累计值随 globals 落盘。
import type { WorldState } from '../persistence/state.ts';
import { log } from '../logging.ts';
import { loadPersonas } from './habits.ts';

interface DriftRule {
  event: string;        // event type 前缀匹配（如 'social.gift'）
  dim: string;          // 维度：'善','诚','勤','俭','疏','勇','正'
  delta: number;        // +1..+3 / -1..-3
  condition?: (payload: Record<string, unknown>) => boolean;
}

const RULES: DriftRule[] = [
  { event: 'social.gift', dim: '善', delta: 1, condition: p => Number(p.num) >= 10 },
  { event: 'malice.steal', dim: '善', delta: -1 },
  { event: 'malice.clear', dim: '善', delta: -1 },
  { event: 'social.greet', dim: '疏', delta: 1 },
  { event: 'social.fallout', dim: '疏', delta: -2 },
];

const CARD_ASSIGN = 'afCardAssign';
const DRIFT_KEY = 'afPersonaDrift';
const CLAMP_MIN = -10;
const CLAMP_MAX = 10;

/**
 * 应用一次事件到相关角色的分值卡；返回受影响角色 uid（供日志/测试）。
 * 每事件每角色只命中一条 RULES（顺序优先，命中即停）。累计器存 globals，不写共享卡库。
 */
export function applyDrift(state: WorldState, eventType: string, actorUid: string, payload: Record<string, unknown>): string[] {
  const affected: string[] = [];
  const assignRaw = state.globals.get(CARD_ASSIGN);
  const assignVal = (assignRaw as { val?: Record<string, number> } | null | undefined)?.val;
  if (!assignVal) return affected;

  const driftRaw = state.globals.get(DRIFT_KEY);
  const existingDrift = (driftRaw as { val?: Record<string, Record<string, number>> } | null | undefined)?.val || {};
  const driftMap: Record<string, Record<string, number>> = existingDrift;

  const targetUid = String((payload as { target?: string }).target || actorUid);
  const cards = loadPersonas(state.dataDir || '');

  for (const [uid, cardId] of Object.entries(assignVal)) {
    if (uid !== actorUid && uid !== targetUid) continue;

    for (const rule of RULES) {
      if (!eventType.startsWith(rule.event)) continue;
      if (rule.condition && !rule.condition(payload)) continue;

      const card = cards.find(c => c.id === cardId);
      if (!card || !(rule.dim in card.scores)) continue;
      const base = card.scores[rule.dim];

      if (!driftMap[uid]) driftMap[uid] = {};
      const prevAccum = driftMap[uid]![rule.dim] || 0;
      const accum = prevAccum + rule.delta;
      driftMap[uid]![rule.dim] = accum;
      const effective = Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, base + accum));
      if (effective === base) {
        driftMap[uid]![rule.dim] = prevAccum; // 边界钳制吞掉本次增量，回滚累积器
        break;
      }
      affected.push(uid);
      try { log.write('info', 'persona-drift', `${uid} ${rule.dim} ${base}->${effective} (${eventType})`); } catch {}
      break;
    }
  }

  state.globals.set(DRIFT_KEY, { val: driftMap });
  return affected;
}