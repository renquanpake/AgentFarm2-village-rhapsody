// world/apply.ts —— 事件应用器：纯函数 apply(state, event) + 快照重建 + 状态哈希
// 回放确定性（Correctness Property）：同一事件序列重放两次，状态哈希一致（随机性全部由事件 seed 决定）。
import { sha256, canonicalJson } from './rng.ts';
import type { GameEvent } from '../persistence/events.ts';
import { WorldState } from '../persistence/state.ts';
import type { StateOpts } from '../persistence/state.ts';
import type { Tables } from './tables.ts';
import { worldPlants, worldPlots, worldSprinklers, knapAdd, knapSub } from './farm.ts';
import { pairOf } from './social.ts';
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
    default:
      // 未知事件类型：重放跳过（前向兼容：旧回放器遇新事件不崩）
      break;
  }
}

/** 状态哈希（规范化 JSON + sha256）：回放确定性的判据 */
export function stateHash(state: WorldState): string {
  return sha256(canonicalJson(JSON.parse(state.serialize())));
}

/** 结构化域哈希：仅覆盖"事件拥有"的子集（植物/田地/洒水器/社交/任务书/agent 位置）
 *  自由桶（mapData/playerData 等客户端可覆写的部分）不参与，用于启动一致性诊断 */
export function structuredHash(state: WorldState): string {
  const owned = {
    world: {
      plantData: state.world.get('plantData'),
      farmData: state.world.get('farmData'),
      sprinklerData: state.world.get('sprinklerData'),
      socialData: state.world.get('socialData'),
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
