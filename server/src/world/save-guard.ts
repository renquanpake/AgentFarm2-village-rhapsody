// world/save-guard.ts —— D17 客户端直写防护（save 字段白名单 + 经济/成长字段服务端权威化）
//
// 事故模型（单机血统的信任模型在共享经济下即作弊面）：save 消息可整体覆写任何
// 玩家私有桶（knapData 金币/物品/仓库、attributeData 技能、buffData、playerData 位置），
// 改版客户端一次 save 即可铸币/满技能；bucketOf 对未注册 key 还默认落玩家私有桶，
// 客户端可自造任意新 key 塞进存档。
//
// 本模块是**纯函数**（无 IO、无 env 依赖除开关），ws.ts save 分支逐键调用：
//   服务端专属桶 -> 拒写（claims/lease/委托/公告/八卦/摊位/体能/设施/任务…）
//   knapData     -> 幅度封顶（金币与物品的增量上限；减少不设限）
//   未注册键      -> 拒写（字段白名单，杜绝自造键）
// 其余客户端自有键（playerData/taskData/achvData/settingData）放行 —— 原版客户端
// 本地存档形态是设计内权威，硬拒会打断人类玩家游玩。
//
// 逃生阀：AF_TRUST_CLIENT_SAVE=1 全放行（单机旧档调试）；默认护栏开。
import type { WorldState } from '../persistence/state.ts';
import { PLAYER_KEYS, WORLD_KEYS, GLOBAL_KEYS } from '../persistence/state.ts';

export interface SaveGuardLimits {
  /** 金币（道具 id=1）单次 save 允许的净增上限 */
  goldStep: number;
  /** 其他物品单次 save 允许的净增上限（原版拾取/掉落都是个位数） */
  itemStep: number;
  /** 客户端可见的放行上限（防脏数据把存档撑爆） */
  maxValueBytes: number;
}

export const DEFAULT_LIMITS: SaveGuardLimits = { goldStep: 500, itemStep: 20, maxValueBytes: 512 * 1024 };

/** 服务端专属世界桶：客户端 save 一律拒写（这些桶只由服务端逻辑/事件维护） */
export const SERVER_OWNED_WORLD_KEYS = new Set([
  'socialData', 'claimsData', 'leaseData', 'delegatedData', 'noticeData', 'gossipData',
  'afStalls', 'fitnessData', 'staminaData', 'facilityData', 'livestockData',
]);

/** 服务端专属玩家桶：客户端 save 一律拒写（afTasks 此前已豁免，此处补齐成长/新桶） */
export const SERVER_OWNED_PLAYER_KEYS = new Set(['afTasks', 'afOnboarding', 'afAgentMail', 'afAgentAsk', 'attributeData', 'buffData', 'storage']);

/** 客户端自有玩家键（原版客户端本地形态，设计内权威） */
export const CLIENT_OWNED_PLAYER_KEYS = new Set(['playerData', 'taskData', 'knapData', 'achvData', 'settingData']);

export type SaveRejectReason =
  | 'server-owned-world' | 'server-owned-player' | 'unknown-key'
  | 'oversized' | 'gold-step' | 'item-step' | 'trusted-mode';

export interface SaveGuardVerdict {
  /** 是否允许写入（false = 保持服务端现值） */
  allow: boolean;
  /** allow=false 时的落盘/回广播取值：null = 该键不进 kvOut */
  value: unknown;
  reason?: SaveRejectReason;
  detail?: string;
}

export interface GuardStats {
  checked: number;
  rejected: number;
  byReason: Record<string, number>;
  trustedMode: boolean;
}

const stats: GuardStats = { checked: 0, rejected: 0, byReason: {}, trustedMode: false };

export function saveGuardStats(): GuardStats {
  return { ...stats, byReason: { ...stats.byReason } };
}

export function resetSaveGuardStats(): void {
  stats.checked = 0; stats.rejected = 0; stats.byReason = {}; stats.trustedMode = false;
}

/** 道具数组 -> id -> num */
function propsOf(val: unknown): Map<number, number> {
  const m = new Map<number, number>();
  const props = (val as { props?: Array<{ id?: unknown; num?: unknown }> } | undefined)?.props;
  if (!Array.isArray(props)) return m;
  for (const p of props) {
    const id = Number(p?.id), num = Number(p?.num);
    if (Number.isFinite(id) && Number.isFinite(num)) m.set(id, num);
  }
  return m;
}

/** 背包幅度封顶：净增超上限的道具沿用服务端现值（净减不拦），返回过滤后的背包 */
function boundKnap(incoming: unknown, current: unknown, limits: SaveGuardLimits): { value: unknown; rejected: SaveRejectReason[] } {
  const inc = propsOf(incoming);
  const cur = propsOf(current);
  const rejected: SaveRejectReason[] = [];
  const props = Array.from(inc.entries()).map(([id, num]) => ({ id, num }));
  for (const p of props) {
    const cap = p.id === 1 ? limits.goldStep : limits.itemStep;
    const before = cur.get(p.id) ?? 0;
    const delta = p.num - before;
    if (delta > cap) {
      p.num = before;
      rejected.push(p.id === 1 ? 'gold-step' : 'item-step');
    }
    if (p.num < 0) p.num = 0;
  }
  // 服务端有、客户端没带的道具（背包减产）保留服务端值，避免被整体清空
  for (const [id, num] of cur.entries()) if (!inc.has(id)) props.push({ id, num });
  const clone = (incoming && typeof incoming === 'object') ? { ...(incoming as object), props } : { props };
  return { value: clone, rejected };
}

/**
 * 逐键裁决。bucket 由 state.bucketOf 给出；state 传入用于取服务端现值。
 * 环境：env 仅用于 AF_TRUST_CLIENT_SAVE 逃生阀。
 */
export function guardSaveKey(
  name: string,
  bucket: 'world' | 'global' | 'player',
  incoming: unknown,
  current: unknown,
  limits: SaveGuardLimits = DEFAULT_LIMITS,
  env: Record<string, string | undefined> = process.env,
): SaveGuardVerdict {
  stats.checked++;
  const trusted = env.AF_TRUST_CLIENT_SAVE === '1' || env.AF_TRUST_CLIENT_SAVE === 'true';
  stats.trustedMode = trusted;
  if (trusted) return { allow: true, value: incoming, reason: 'trusted-mode' };

  const size = JSON.stringify(incoming ?? null)?.length ?? 0;
  if (size > limits.maxValueBytes) {
    stats.rejected++; stats.byReason.oversized = (stats.byReason.oversized || 0) + 1;
    return { allow: false, value: null, reason: 'oversized', detail: `${size}B` };
  }

  if (bucket === 'world' && SERVER_OWNED_WORLD_KEYS.has(name)) {
    stats.rejected++; stats.byReason['server-owned-world'] = (stats.byReason['server-owned-world'] || 0) + 1;
    return { allow: false, value: null, reason: 'server-owned-world' };
  }
  if (bucket === 'player' && SERVER_OWNED_PLAYER_KEYS.has(name)) {
    stats.rejected++; stats.byReason['server-owned-player'] = (stats.byReason['server-owned-player'] || 0) + 1;
    return { allow: false, value: null, reason: 'server-owned-player' };
  }
  if (bucket === 'player' && !CLIENT_OWNED_PLAYER_KEYS.has(name) && !PLAYER_KEYS.has(name)) {
    stats.rejected++; stats.byReason['unknown-key'] = (stats.byReason['unknown-key'] || 0) + 1;
    return { allow: false, value: null, reason: 'unknown-key' };
  }
  if (bucket === 'global' && !GLOBAL_KEYS.has(name)) {
    stats.rejected++; stats.byReason['unknown-key'] = (stats.byReason['unknown-key'] || 0) + 1;
    return { allow: false, value: null, reason: 'unknown-key' };
  }
  if (bucket === 'player' && name === 'knapData') {
    const { value, rejected } = boundKnap(incoming, current, limits);
    if (rejected.length) {
      stats.rejected++; stats.byReason[rejected[0]] = (stats.byReason[rejected[0]] || 0) + 1;
      return { allow: false, value, reason: rejected[0], detail: `超限道具 ${rejected.length} 项已回落服务端现值` };
    }
    return { allow: true, value };
  }
  return { allow: true, value: incoming };
}

/** 便捷：取玩家桶某键现值 */
export function currentPlayerValue(state: WorldState, uid: string, name: string): unknown {
  return state.playersDb.get(uid)?.get(name);
}