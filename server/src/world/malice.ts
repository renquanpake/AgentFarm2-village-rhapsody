// world/malice.ts —— 恶意动词引擎（受租约/归属校验；极恶人设的执行层）
// 极恶人设卡片需要真实动词执行层：取物（偷他人已成熟作物）/ 清除（毁他人田）。
// 两道闸与正常动词同源，不新增信任面：
// - 地块归属：farmData.plotDatas.owner（till 时写死，apply.ts 重放同源）
// - 认领锁：claimsData 的 plot@x,y（TTL 5 分钟未动作自动失效；holderOf 不判过期，故直读记录）
// - D 包租约：leaseData 的有效租约同样保护（枯萎/再生中已自释，放行）
// 偷窃要求作物已成熟且认领过期或无人认领；清除不看认领锁（毁田是暴力 verb，受归属门即可）。
// 只造世界变更（摘株/复位 plantUID/入包），不落事件流 —— malice.* 由持 app.log 的调用方补记。
import type { WorldState } from '../persistence/state.ts';
import type { Tables } from './tables.ts';
import { worldPlants, worldPlots, cropAtWorld, knapAdd } from './farm.ts';
import { CLAIMS_KEY, type ClaimRecord } from './claims.ts';
import { LEASE_KEY, type LeaseRecord } from './lease.ts';
import { log } from '../logging.ts';

export interface MaliceResult {
  ok: boolean;
  msg: string;
  detail?: string;
}

/** 恶动词近邻门：正常动词要切比雪夫距离 1 的相邻格，恶意动词放宽到 2 格（人设卡执行半径，不开放参数） */
const REACH = 2;

/** 只读地块认领记录（含 TTL）—— claims.ts 的 holderOf 不看过期，直读记录才能区分「保护期内」与「已失效」 */
function claimRecord(state: WorldState, ref: string): ClaimRecord | undefined {
  const cd = state.world.get(CLAIMS_KEY) as { claims?: Record<string, ClaimRecord> } | undefined;
  return cd?.claims?.[`plot:${ref}`];
}

/** 只读地块租约（不建桶，leaseOf 会 materialize leaseData，纯读保持无副作用） */
function leaseRecord(state: WorldState, ref: string): LeaseRecord | undefined {
  const ld = state.world.get(LEASE_KEY) as { leases?: Record<string, LeaseRecord> } | undefined;
  return ld?.leases?.[ref];
}

/** 行动者当前格（像素 -> 格）。来源优先级同 ws.ts 的 apos：agentPos 运行时位 > 在线玩家位 > 存档 playerPos。 */
function actorCell(state: WorldState, uid: string): { gx: number; gy: number } | null {
  const ap = state.agentPos.get(uid);
  const op = state.online.get(uid);
  const pd = state.playersDb.get(uid)?.get('playerData') as { playerPos?: { x?: number; y?: number } } | undefined;
  const X = Number(ap ? ap.x : (op ? op.x : pd?.playerPos?.x));
  const Y = Number(ap ? ap.y : (op ? op.y : pd?.playerPos?.y));
  if (!Number.isFinite(X) || !Number.isFinite(Y)) return null;
  return { gx: Math.floor(X / 100), gy: Math.floor(Y / 100) };
}

/** 近邻判定：切比雪夫距离 <= REACH */
function nearEnough(ax: number, ay: number, tx: number, ty: number): boolean {
  return Math.max(Math.abs(ax - tx), Math.abs(ay - ty)) <= REACH;
}

/**
 * 取物（偷窃）：从他人已成熟但认领已过期的作物中取走。
 * Gates: target plot must have a mature crop (sceneType=2, farmType=1, growth >= maturity)
 *        AND its claim must be expired (no active claim or TTL passed)
 *        AND actor must be adjacent to the plot cell.
 * On success: removes plant from target plot, adds crop item to actor's knapData, logs event.
 */
export function actSteal(
  state: WorldState, tables: Tables, actorUid: string, targetX: number, targetY: number,
): MaliceResult {
  const cell = actorCell(state, actorUid);
  if (!cell) return { ok: false, msg: '找不到行动者当前位置（无坐标）' };
  if (!nearEnough(cell.gx, cell.gy, targetX, targetY)) {
    return { ok: false, msg: `离目标太远（${targetX},${targetY}），需要站在其 ${REACH} 格范围内` };
  }

  // 归属先行：自己的田直接提示收获，不走偷窃通道（土壤自播无地块记录 = 无主，照旧可偷）
  const plot = worldPlots(state).find(pl => pl.x === targetX && pl.y === targetY);
  if (plot && plot.owner === actorUid) return { ok: false, msg: '这是你自己的田，用 act harvest 收就行' };

  const p = cropAtWorld(state, targetX, targetY); // 内含 growPlants：先推进生长再判成熟
  if (!p || p.farmType !== 1) return { ok: false, msg: '这个格子上没有可偷的作物' };
  const crop = tables.cropOf(p.plantId);
  if (!crop) return { ok: false, msg: '未知作物' };
  if ((p.growDay ?? 0) < crop.days) {
    return { ok: false, msg: `${crop.name}还没成熟（${p.growDay ?? 0}/${crop.days} 天），偷早了没意思` };
  }

  const ref = `plot@${targetX},${targetY}`;
  // 认领锁：仍持有（含自己）且在 TTL 内一律动不了；过期或无人认领才可下手
  const rec = claimRecord(state, ref);
  if (rec && !(rec.expiresAt !== undefined && rec.expiresAt <= Date.now())) {
    return {
      ok: false,
      msg: rec.owner === actorUid
        ? `你正认领保护着这块地，等它过期再下手`
        : `这块地还在 ${rec.owner} 的认领保护期内（5 分钟未动作自动失效）`,
    };
  }
  // D 包租约：有效租约（非枯萎）内同样受保护；租约到期枯萎/再生中的田地放行
  const lease = leaseRecord(state, ref);
  if (lease && !lease.withered && lease.owner !== actorUid) {
    return { ok: false, msg: `这块田在 ${lease.owner} 的租约照料期内，别去惹他` };
  }

  // 结算（与 harvest 同款事务顺序：先摘后给，单 persist 收尾）
  const plants = worldPlants(state);
  plants.splice(plants.indexOf(p), 1);
  const owned = worldPlots(state).find(pl => pl.plantUID === p.uId);
  if (owned) owned.plantUID = 0;
  knapAdd(state.ensurePlayerData(actorUid), crop.cropItemId, 1);
  state.persist();
  log.write('info', 'malice', `[malice.steal] ${actorUid} 取走 ${crop.name}（格 ${targetX},${targetY}）`, { uid: actorUid, itemId: crop.cropItemId });
  return { ok: true, msg: `取到了${crop.name}` };
}

/**
 * 清除（毁田）：移除他人地块上的植物（无论是否成熟）。
 * Gates: plot must NOT belong to actor (check playerData.farmDatas ownership)
 *        AND actor must be adjacent.
 * Does NOT give items to actor (it's destruction, not theft).
 */
export function actClear(
  state: WorldState, tables: Tables, actorUid: string, targetX: number, targetY: number,
): MaliceResult {
  const cell = actorCell(state, actorUid);
  if (!cell) return { ok: false, msg: '找不到行动者当前位置（无坐标）' };
  if (!nearEnough(cell.gx, cell.gy, targetX, targetY)) {
    return { ok: false, msg: `离目标太远（${targetX},${targetY}），需要站在其 ${REACH} 格范围内` };
  }

  const plot = worldPlots(state).find(pl => pl.x === targetX && pl.y === targetY);
  if (!plot) return { ok: false, msg: `(${targetX},${targetY}) 不是已犁地块（先 act till 的才有得毁）` };
  if (plot.owner === actorUid) return { ok: false, msg: '这是你自己的田，别毁了' };

  const p = cropAtWorld(state, targetX, targetY);
  if (!p || p.farmType !== 1) return { ok: false, msg: `这块地上没有作物可清除（${targetX},${targetY}）` };

  // 无论成熟与否一并移除；田块 plantUID 复位，物品不出手（毁田不给赃）
  const plants = worldPlants(state);
  plants.splice(plants.indexOf(p), 1);
  plot.plantUID = 0;
  state.persist();
  log.write('info', 'malice', `[malice.clear] ${actorUid} 毁除了 (${targetX},${targetY}) 上的植物`, { uid: actorUid, uId: p.uId });
  return { ok: true, msg: `已清除 (${targetX},${targetY}) 上的植物` };
}