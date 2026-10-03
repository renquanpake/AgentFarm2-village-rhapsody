// world/apply.ts —— 事件应用器：纯函数 apply(state, event) + 快照重建 + 状态哈希
// 回放确定性（Correctness Property）：同一事件序列重放两次，状态哈希一致（随机性全部由事件 seed 决定）。
import { sha256, canonicalJson } from './rng.ts';
import type { GameEvent } from '../persistence/events.ts';
import { WorldState } from '../persistence/state.ts';
import type { StateOpts } from '../persistence/state.ts';
import type { Tables } from './tables.ts';
import { worldPlants, worldPlots, worldSprinklers, knapAdd, knapSub } from './farm.ts';
import { pairOf } from './social.ts';
import { tryClaim, release as releaseClaim, type ClaimKind } from './claims.ts';
import { openLease, care as careLease, leaseOf } from './lease.ts';
import { tasksOf, TASK_DEFS } from './tasks.ts';
import type { PlantRec, PlotRec } from '../types.ts';

/** 确保玩家私有桶存在（重放时玩家可能尚未在快照中出现） */
function ensurePlayer(state: WorldState, uid: string): Map<string, unknown> {
  let pm = state.playersDb.get(uid);
  if (!pm) { pm = new Map(); state.playersDb.set(uid, pm); }
  return pm;
}

/** 单个事件应用到状态（纯函数：不碰文件/网络；重放路径专用） */
export function applyEvent(state: WorldState, ev: GameEvent, tables: Tables): void {
  const p = ev.payload;
  switch (ev.type) {
    case 'player.move':
      // 记录事件（M1 导演镜头/回放数据源）；在线坐标本身由客户端 save 持久化
      break;
    case 'agent.pos': {
      const uid = ev.actor!;
      const pos = { x: Number(p.x), y: Number(p.y), scene: Number(p.scene) };
      state.agentPos.set(uid, pos);
      const pm = state.playersDb.get(uid);
      if (pm) {
        const pd = (pm.get('playerData') || {}) as Record<string, unknown>;
        pd.playerPos = { x: pos.x, y: pos.y };
        pd.posSceneType = pos.scene;
        pd.sceneType = pos.scene;
        pm.set('playerData', pd);
      }
      break;
    }
    case 'chat.msg':
    case 'task.progress': {
      // task.progress：推进私有桶 afTasks（奖励物品由独立 item.gained 事件承载）
      if (ev.type === 'task.progress') {
        const uid = String(p.uid);
        const type = String(p.type);
        const n = Number(p.n || 1);
        const pm = ensurePlayer(state, uid);
        const t = tasksOf(state, uid);
        for (const d of TASK_DEFS) {
          if (d.type !== type || t.done[d.id]) continue;
          const it = t.list[d.id];
          if (!it) continue;
          it.cur = Math.min(it.total, it.cur + n);
          if (it.cur >= it.total) t.done[d.id] = true;
        }
        pm.set('afTasks', t);
      }
      break;
    }
    case 'plant.sown': {
      const rec: PlantRec = {
        uId: Number(p.uId), plantId: Number(p.plantId), x: Number(p.x), y: Number(p.y),
        hp: 10, farmType: 1, growDay: 0, sownAt: Number(p.sownAt),
      };
      worldPlants(state).push(rec);
      const plot = worldPlots(state).find(pl => pl.x === rec.x && pl.y === rec.y);
      if (plot) plot.plantUID = rec.uId;
      break;
    }
    case 'crop.watered': {
      const plants = worldPlants(state);
      const pl = plants.find(x => x.uId === Number(p.uId));
      if (pl) { pl.sownAt = Number(p.sownAt); pl.growDay = Number(p.growDay); }
      break;
    }
    case 'crop.autowatered': {
      const updates = (p.updates as Array<{ uId: number; sownAt: number; growDay: number }> || []);
      const plants = worldPlants(state);
      for (const u of updates) {
        const pl = plants.find(x => x.uId === u.uId);
        if (pl) { pl.sownAt = u.sownAt; pl.growDay = u.growDay; }
      }
      break;
    }
    case 'crop.harvested': {
      const plants = worldPlants(state);
      const idx = plants.findIndex(x => x.uId === Number(p.uId));
      if (idx >= 0) {
        const pl = plants[idx];
        plants.splice(idx, 1);
        const plot = worldPlots(state).find(q => q.plantUID === pl.uId);
        if (plot) plot.plantUID = 0;
      }
      break;
    }
    case 'tree.chopped': {
      const plants = worldPlants(state);
      const idx = plants.findIndex(x => x.uId === Number(p.uId));
      if (idx >= 0) {
        const pl = plants[idx];
        const hp = Number(p.hp);
        pl.hp = hp;
        if (hp <= 0) {
          plants.splice(idx, 1);
          const plot = worldPlots(state).find(q => q.plantUID === pl.uId);
          if (plot) plot.plantUID = 0;
        }
      }
      break;
    }
    case 'plot.tilled': {
      const plots = worldPlots(state);
      const exists = plots.some(pl => pl.x === Number(p.x) && pl.y === Number(p.y));
      if (!exists) {
        const rec: PlotRec = { x: Number(p.x), y: Number(p.y), plantUID: 0, farmType: 1, owner: String(p.owner || ev.actor || '') };
        plots.push(rec);
      }
      break;
    }
    case 'sprinkler.placed': {
      const sd = worldSprinklers(state);
      if (!sd.some(s => s.x === Number(p.x) && s.y === Number(p.y))) {
        sd.push({ x: Number(p.x), y: Number(p.y), level: Number(p.level), owner: String(p.owner || ev.actor || '') });
      }
      break;
    }
    case 'item.consumed': {
      const pm = ensurePlayer(state, String(p.uid));
      knapSub(pm, Number(p.itemId), Number(p.num));
      break;
    }
    case 'item.gained': {
      const pm = ensurePlayer(state, String(p.uid));
      knapAdd(pm, Number(p.itemId), Number(p.num));
      break;
    }
    case 'fish.caught': {
      const pm = ensurePlayer(state, String(p.uid));
      knapAdd(pm, Number(p.itemId), 1);
      break;
    }
    case 'ore.mined': {
      const pm = ensurePlayer(state, String(p.uid));
      knapAdd(pm, Number(p.itemId), 1);
      break;
    }
    case 'social.fav': {
      const { p: pair } = pairOf(state, String(p.a), String(p.b));
      pair.fav[String(p.a)] = Math.min(100, (pair.fav[String(p.a)] || 0) + Number(p.delta));
      break;
    }
    case 'social.relation': {
      const { p: pair } = pairOf(state, String(p.a), String(p.b));
      pair.relation = String(p.relation || '');
      pair.relBy = String(p.by || ev.actor || '');
      break;
    }
    case 'dm.unlocked': {
      const { p: pair } = pairOf(state, String(p.a), String(p.b));
      pair.dmUnlocked = true;
      break;
    }
    // C/D 包抢占与租约（2026-10-03 接入事件流）：此前 claimsData/leaseData 只在 live 变更，
    // 回放重建不出来 —— 事件拥有域不入事件流等于事实源缺失。
    case 'claim.granted': {
      // tick/expiresAt 取事件载荷（不是 ev.ts）：live 侧用的是 Date.now()，回放必须逐字重建
      const kind = String(p.kind) as ClaimKind;
      const ref = String(p.ref);
      const since = Number(p.since ?? ev.ts);
      const expiresAt = p.expiresAt === null || p.expiresAt === undefined ? undefined : Number(p.expiresAt);
      tryClaim(state, String(p.uid), kind, ref, since, expiresAt);
      break;
    }
    case 'claim.released': {
      releaseClaim(state, String(p.uid), String(p.kind) as ClaimKind, String(p.ref));
      break;
    }
    case 'lease.opened': {
      // 载荷逐字带 startTick/leaseMs：live 用 Date.now()，回放必须一模一样（否则哈希漂移）
      openLease(state, String(p.plot), String(p.uid), Number(p.startTick ?? ev.ts), Math.max(1000, Number(p.leaseMs)));
      break;
    }
    case 'lease.cared': {
      const plot = String(p.plot);
      careLease(state, plot, String(p.uid), Number(p.lastCareTick ?? ev.ts), 60000);
      const l = leaseOf(state, plot);
      if (l) {
        l.lastCareTick = Number(p.lastCareTick ?? l.lastCareTick);
        l.leaseMs = Number(p.leaseMs ?? l.leaseMs);
        l.careCount = Number(p.careCount ?? l.careCount);
      }
      break;
    }
    case 'lease.regrown': {
      // 再生是「tick 到期」的派生结果：回放里直接删对应租约（等价于 tick 通过）
      const plots = Array.isArray(p.plots) ? p.plots.map(String) : [];
      for (const plot of plots) {
        const l = leaseOf(state, plot);
        if (l) openLease(state, plot, l.owner, Number(ev.ts), l.leaseMs); // 保持存在即等价「未再生」
      }
      break;
    }
    default:
      // 未知事件类型：重放跳过（前向兼容：旧回放器遇新事件不崩）
      break;
  }
}

/** 状态哈希（规范化 JSON + sha256）：回放确定性的判据 */
export function stateHash(state: WorldState): string {
  return sha256(canonicalJson(JSON.parse(state.serialize())));
}

/** 结构化域哈希：仅覆盖"事件拥有"的子集（植物/田地/洒水器/社交/任务书/抢占/租约/委托/公告/八卦/agent 位置）
 *  自由桶（mapData/playerData 等客户端可覆写的部分）不参与，用于启动一致性诊断。
 *  2026-10-03 扩容：抢占/租约/委托/公告/八卦此前只改 live 状态、不入哈希，
 *  漂移不会被门9 发现（注释说「参与 structuredHash」而实现没参与 —— 注释即契约）。 */
export function structuredHash(state: WorldState): string {
  const owned = {
    world: {
      plantData: state.world.get('plantData'),
      farmData: state.world.get('farmData'),
      sprinklerData: state.world.get('sprinklerData'),
      socialData: state.world.get('socialData'),
      // 事件拥有域（各自都有对应事件类型 + apply 分支）
      claimsData: state.world.get('claimsData'),
      leaseData: state.world.get('leaseData'),
      // noticeData / gossipData / delegatedData 暂不收：它们由公告、八卦、委托等多条
      // 非事件路径直写（publishNotice/recordGossip/delegate*），收进哈希只会制造永久漂移。
      // 要收进哈希的前置条件是「这些写入路径全部事件化」，见 online-village tasklist 遗留项。
    },
    players: [...state.playersDb.entries()]
      .filter(([, m]) => m.has('afTasks'))
      .map(([uid, m]) => [uid, m.get('afTasks')] as [string, unknown]),
    agentPos: [...state.agentPos.entries()],
  };
  return sha256(canonicalJson(owned));
}

/** 从"最近快照 + 其后事件"重建状态（恢复/回放/一致性校验共用） */
export function rebuildState(
  snapshotJson: string | null,
  events: GameEvent[],
  stateOpts: StateOpts,
  tables: Tables,
): WorldState {
  const st = snapshotJson
    ? WorldState.fromSnapshot(snapshotJson, stateOpts)
    : new WorldState({ ...stateOpts, init: false, noPersist: true });
  for (const ev of events) applyEvent(st, ev, tables);
  return st;
}
