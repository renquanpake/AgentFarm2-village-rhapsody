// world.ts —— 世界状态：场景实例、实体、时间、移动、广播、消息路由
import crypto from 'node:crypto';
import { data, scenesById, balance } from './config.ts';
import { mapMeta, isWalkable } from './maps.ts';
import type { Dir } from './types.ts';
import { doInteract } from './actions.ts';
import { brainTick } from './brain.ts';
import { socialTick, pendingTalk } from './social.ts';
import { runCommand } from './commands.ts';
import { saveGame, restoreGame } from './save.ts';
import { ensureMemory } from './memory.ts';

export const DIR_V: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export interface Plant {
  plantId: number; sceneId: number; instanceId: number;
  grid: [number, number]; grow: number; watered: boolean; wateredToday: boolean;
}
export interface Building {
  buildId: number; sceneId: number; instanceId: number;
  grid: [number, number]; owner: string;
}
export interface Room {
  key: string; sceneId: number; instanceId: number; mapName: string;
  width: number; height: number; owner?: string;
  plants: Plant[]; buildings: Building[];
  tilled: Set<string>;      // "c,r" 已开垦的耕地格
  tiles: Uint8Array | null; // collide
}

export interface Brain {
  plan: string; step?: string; path: [number, number][] | null; nextThink: number; lastThought: string;
  cmdQueue: { text: string; by: string; t: number }[];
  lastStep?: number; lastLLM?: number; lastCmd?: string; pathing?: boolean; lastFov?: number;
  externalAct?: { action: string; param?: any; at: number } | null;
  lastActAt?: number;
}

/** 玩家级 Agent 接入配置（档1 自带模型 / 档2 外部程序） */
export interface BrainCfg {
  mode: 'builtin' | 'external';
  baseUrl?: string; key?: string; model?: string; temperature?: number;
  vision: boolean;        // 多模态/识图声明（影响观察是否带视觉补充，最终由外部程序决定）
  token: string;          // 外部接入 token
  externalConnected?: boolean;
  ws?: any;               // 外部程序连接
}

export interface Actor {
  id: string; name: string; color: string; isAgent: boolean;
  isNpc?: boolean; head?: string; pathName?: string;
  sceneId: number; instanceId: number; x: number; y: number; dir: Dir;
  moving: boolean;
  hunger: number; hp: number; gold: number;
  items: Record<string, number>;
  relations: Record<string, number>;
  relation: Record<string, string>;
  hosted: boolean; lastInput: number;
  asleep: boolean;
  busy: { until: number; label: string } | null;
  brain: Brain;
  stats: { useTool: Record<string, number>; talk: number; help: number; plant: number };
  counters: Record<string, number>;
  tasks: { accepted: string[]; completed: string[] };
  spawnedAt: number;
}

export class World {
  actors = new Map<string, Actor>();
  rooms = new Map<string, Room>();
  clients = new Map<any, { actorId: string; spectateId: string; mapNamesSent: boolean }>();
  gameAbsMin = 9 * 60; // 自第1天09:00起的绝对游戏分钟
  nextId = 1;
  io: ((target: any, msg: any) => void) | null = null;   // 单发（index.ts 注入）
  broadcast: ((msg: any, room?: Room) => void) | null = null;
  autoSaveTimer: any = null;

  constructor() {
    restoreGame(this);
    this.createNpcs();
    this.autoSaveTimer = setInterval(() => saveGame(this), 60000);
    process.on('SIGINT', () => { saveGame(this); process.exit(0); });
  }

  /** 村庄 NPC（原版 26 人，先放主要 10 位在共享场景散步；对话走 socialTick 模板） */
  private createNpcs() {
    if ([...this.actors.values()].some(a => a.isNpc)) return; // 已存在（存档恢复）
    const chosen = data.npcs.slice(0, 12);
    const spots: [number, number][] = [[22, 16], [38, 18], [20, 38], [45, 24], [50, 42], [28, 50], [58, 30], [12, 28], [62, 48], [34, 56], [8, 40], [55, 12]];
    for (let i = 0; i < chosen.length; i++) {
      const n = chosen[i];
      const a = this.newActor(n.name, '#c9a06c', true);
      a.isNpc = true;
      a.head = n.head || '';
      a.pathName = n.path_name || '';
      const sceneId = n.path_name === 'yisheng' ? 113 : 2; // 医生在医院，其余村庄
      const room = this.getRoom(sceneId, 0);
      this.loadRoomCollide(room);
      a.sceneId = sceneId; a.instanceId = 0;
      const sp = spots[i] || [20, 20];
      a.x = this.canWalk(room, sp[0], sp[1]) ? sp[0] : this.findSpawn(room)[0];
      a.y = this.canWalk(room, sp[0], sp[1]) ? sp[1] : this.findSpawn(room)[1];
      this.actors.set(a.id, a);
    }
    console.log(`[npc] 已创建 ${chosen.length} 位村民`);
  }

  get day() { return 1 + Math.floor(this.gameAbsMin / 1440); }
  get hour() { return (this.gameAbsMin % 1440) / 60; }

  roomKey(sceneId: number, instanceId: number) { return `${sceneId}-${instanceId}`; }

  getRoom(sceneId: number, instanceId: number): Room {
    const key = this.roomKey(sceneId, instanceId);
    let r = this.rooms.get(key);
    if (!r) {
      const sc = scenesById[sceneId];
      const meta = mapMeta(sc?.map || '');
      r = {
        key, sceneId, instanceId, mapName: sc?.map || '',
        width: meta?.width ?? 0, height: meta?.height ?? 0, plants: [], buildings: [],
        tilled: new Set(), tiles: null
      };
      this.rooms.set(key, r);
    }
    return r;
  }
  loadRoomCollide(r: Room) {
    if (r.width) return;
    const sc = scenesById[r.sceneId];
    const meta = mapMeta(sc?.map || '');
    r.mapName = sc?.map || r.mapName;
    r.width = meta?.width ?? 0; r.height = meta?.height ?? 0;
  }

  canWalk(r: Room, c: number, row: number): boolean {
    if (c < 0 || row < 0 || c >= r.width || row >= r.height) return false;
    if (!isWalkable(r.mapName, c, row)) return false;
    if (r.buildings.some(b => b.grid[0] === c && b.grid[1] === row)) return false;
    return true;
  }

  findSpawn(r: Room): [number, number] {
    const cx = Math.floor(r.width / 2), cy = Math.floor(r.height / 2);
    // 从中心螺旋找可走格
    for (let rad = 0; rad < Math.max(r.width, r.height); rad++) {
      for (let dc = -rad; dc <= rad; dc++) {
        for (let dr = -rad; dr <= rad; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const c = cx + dc, row = cy + dr;
          if (this.canWalk(r, c, row) && ![...this.actors.values()].some(a => a.sceneId === r.sceneId && a.instanceId === r.instanceId && a.x === c && a.y === row)) {
            return [c, row];
          }
        }
      }
    }
    return [1, 1];
  }

  private newActor(name: string, color: string, isAgent: boolean): Actor {
    return {
      id: `a${this.nextId++}`, name, color: color || '#ffd166', isAgent,
      sceneId: 1, instanceId: 0, x: 10, y: 10, dir: 'down', moving: false,
      hunger: 100, hp: 100, gold: balance.economy.start_gold ?? 200,
      items: {}, relations: {}, relation: {},
      hosted: isAgent, lastInput: Date.now(), asleep: false, busy: null,
      brain: { plan: isAgent ? 'idle' : 'idle', path: null, nextThink: 0, lastThought: '', cmdQueue: [] },
      brainCfg: { mode: 'builtin', vision: false, token: this.randToken(), externalConnected: false },
      stats: { useTool: {}, talk: 0, help: 0, plant: 0 }, counters: {},
      tasks: { accepted: [], completed: [] }, spawnedAt: Date.now()
    };
  }

  randToken(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  join(ws: any, { name, color, agentName }: { name: string; color: string; agentName?: string }): Actor {
    const a = this.newActor(name || '路人', color || '#ffd166', false);
    // 初始装备：基础工具 + 一点种子（甲方简化，保证可玩）
    a.items = { '2': 1, '4': 1, '58': 1, '6': 1, '36': 5 };
    this.actors.set(a.id, a);
    ensureMemory(a); // 记忆四件套初始化（无则建默认）
    const room = this.getRoom(a.sceneId, a.instanceId);
    this.loadRoomCollide(room);
    [a.x, a.y] = this.findSpawn(room);
    this.clients.set(ws, { actorId: a.id, spectateId: '', mapNamesSent: false });

    // 绑定 Agent：创建一个独立 Agent 角色陪伴（与玩家同在）
    if (agentName) {
      const ag = this.newActor(agentName, color || '#06d6a0', true);
      this.actors.set(ag.id, ag);
      ag.sceneId = a.sceneId; ag.instanceId = a.instanceId;
      for (let i = 1; i < 6; i++) {
        const [x, y] = [a.x + i, a.y];
        if (this.canWalk(room, x, y)) { ag.x = x; ag.y = y; break; }
      }
      // 玩家与 Agent 互认好友（关系绑定）
      a.relations[ag.id] = 30; a.relation[ag.id] = 'friend';
      ag.relations[a.id] = 30; ag.relation[a.id] = 'friend';
    }
    return a;
  }

  // ===== 消息路由（C3 协议） =====
  handle(ws: any, msg: any) {
    const c = this.clients.get(ws);
    if (!c) { if (msg.type === 'join') this.join(ws, msg); return; }
    const a = this.actors.get(c.actorId)!;
    if (!a) return;

    switch (msg.type) {
      case 'control': this.onControl(a, msg); break;
      case 'chat': this.onChat(a, msg, ws); break;
      case 'talk': this.onTalk(a, msg); break;
      case 'agent_config': this.onAgentConfig(a, msg); break;
      case 'spectate': c.spectateId = msg.target || ''; this.send(ws, { type: 'spectate', targetId: c.spectateId, targetName: this.actors.get(c.spectateId)?.name }); break;
      case 'spectate_exit': c.spectateId = ''; this.send(ws, { type: 'spectate', targetId: '' }); break;
    }
  }

  /** 玩家级 Agent 接入配置（档1 自带模型 / 档2 外部程序 token） */
  onAgentConfig(a: Actor, msg: any) {
    const cfg = a.brainCfg!;
    if (msg.mode === 'external') {
      cfg.mode = 'external';
      cfg.vision = !!msg.vision;
      if (msg.regenerateToken) cfg.token = this.randToken();
    } else {
      cfg.mode = 'builtin';
      cfg.baseUrl = String(msg.baseUrl || '').trim() || undefined;
      cfg.key = String(msg.key || '').trim() || undefined;
      cfg.model = String(msg.model || '').trim() || undefined;
      cfg.temperature = msg.temperature != null ? +msg.temperature : 0.7;
      cfg.vision = !!msg.vision;
    }
    const reply = { mode: cfg.mode, vision: cfg.vision, token: cfg.token, baseUrl: cfg.baseUrl, model: cfg.model };
    for (const [ws, c] of this.clients) if (c.actorId === a.id) this.send(ws, { type: 'agent_config_ok', cfg: reply });
  }

  onControl(a: Actor, msg: any) {
    if (a.asleep) return;
    if (msg.handover) { a.hosted = true; a.brain.nextThink = 0; return; }
    if (msg.dir && this.clientsByActor(a.id)) {
      a.lastInput = Date.now();
      if (a.hosted) { a.hosted = false; a.brain.cmdQueue = []; }
      this.tryMove(a, msg.dir as Dir);
    }
    if (msg.interact) {
      a.lastInput = Date.now();
      if (a.hosted) { a.hosted = false; a.brain.cmdQueue = []; }
      doInteract(this, a);
    }
  }

  tryMove(a: Actor, dir: Dir) {
    const [dx, dy] = DIR_V[dir];
    const r = this.getRoom(a.sceneId, a.instanceId);
    const nc = a.x + dx, nr = a.y + dy;
    a.dir = dir;
    if (!this.canWalk(r, nc, nr)) { a.moving = false; return; }
    if ([...this.actors.values()].some(o => o !== a && o.sceneId === a.sceneId && o.instanceId === a.instanceId && o.x === nc && o.y === nr && !o.asleep)) { a.moving = false; return; }
    a.x = nc; a.y = nr;
    a.moving = true;
    setTimeout(() => { if (a.moving) a.moving = false; }, 250);
    // 碰传送点 / 门口
    this.checkPortal(a);
  }

  /** 简单传送：村庄(2)↔家门口(1)↔家室内(101)，矿井(8)↔矿洞（仅演示可达性） */
  private portals: { sceneId: number; pos: [number, number]; to: { sceneId: number; instanceId: number; pos: [number, number] } }[] = [];
  private checkPortal(a: Actor) {
    if (a.sceneId === 2 && a.x === 3 && a.y === 3) this.teleport(a, 1, 0, 40, 30);
    else if (a.sceneId === 1 && a.x === 40 && a.y === 30) this.teleport(a, 2, 0, 3, 3);
    else if (a.sceneId === 1 && a.x === 45 && a.y === 30) this.teleport(a, 101, a.instanceId, 15, 10);
    else if (a.sceneId === 101) this.teleport(a, 1, 0, 45, 30);
  }

  teleport(a: Actor, sceneId: number, instanceId: number, x: number, y: number) {
    const room = this.getRoom(sceneId, instanceId);
    this.loadRoomCollide(room);
    const [fx, fy] = this.canWalk(room, x, y) ? [x, y] : this.findSpawn(room);
    a.sceneId = sceneId; a.instanceId = instanceId; a.x = fx; a.y = fy;
    this.broadcast?.({ type: 'toast', text: `${a.name} 来到 ${scenesById[sceneId]?.name || sceneId}`, room });
  }

  private clientsByActor(actorId: string): boolean {
    for (const c of this.clients.values()) if (c.actorId === actorId) return true;
    return false;
  }

  onChat(a: Actor, msg: any, ws: any) {
    const text = String(msg.text || '').slice(0, 200);
    if (!text) return;
    if (text.startsWith('/')) { runCommand(this, a, text); return; }
    const c = this.clients.get(ws);
    if (c) c.actorId = a.id; // 保持绑定
    this.broadcast?.({ type: 'chat', channel: msg.channel || 'player', from: a.name, text });
  }

  onTalk(a: Actor, msg: any) {
    const target = this.actors.get(msg.target || '');
    if (!target) return;
    if (target.isAgent) {
      target.brain.cmdQueue.push({ text: String(msg.text || '').slice(0, 200), by: a.name, t: Date.now() });
      this.broadcast?.({ type: 'chat', channel: 'game', from: a.name, text: `（对 ${target.name} 说：${msg.text}）` });
    } else {
      // 人-人：近距消息走对话（交给 social 下一 tick 生成回应）
      import('./social.ts').then(s => s.pendingTalk(this, a, target, String(msg.text || '')));
    }
  }

  damage(a: Actor, n: number) { a.hp = Math.max(0, a.hp - n); if (a.hp <= 0) this.faint(a); }

  faint(a: Actor) {
    // 昏倒回房：丢 10% 背包，回自家门口
    const room = this.getRoom(1, 0); this.loadRoomCollide(room);
    [a.x, a.y] = this.findSpawn(room);
    a.sceneId = 1; a.instanceId = 0; a.hp = 30; a.hunger = 60;
    for (const k of Object.keys(a.items)) {
      const v = a.items[k];
      if (v > 0) a.items[k] = Math.max(0, Math.floor(v * 0.9));
    }
    this.broadcast?.({ type: 'toast', text: `😵 ${a.name} 昏倒了，被送回门口，损失了 10% 的背包物品` });
  }

  // ===== 主循环 =====
  tick(dtMs: number) {
    const dtSec = dtMs / 1000;
    // 时间：1 真实秒 = 1 游戏分钟
    const prevDay = this.day;
    this.gameAbsMin += dtSec;
    if (this.day !== prevDay) this.onNewDay();

    // 模拟
    for (const a of this.actors.values()) {
      if (a.asleep) continue;
      if (!a.isNpc) {
        // 饱食度衰减
        const loss = 0.06 * dtSec; // /分钟
        a.hunger = Math.max(0, a.hunger - loss);
        if (a.hunger < balance.hunger.slow_loss_below) a.hp = Math.max(0, a.hp - (balance.hunger.slow_hp_per_min * dtSec) / 60);
        if (a.hunger <= 0) a.hp = Math.max(0, a.hp - balance.hunger.zero_hp_per_sec * dtSec);
        if (a.hp <= 0) this.faint(a);
        // 托管超时接管
        if (!a.isAgent && !a.hosted && Date.now() - a.lastInput > 3 * 60 * 1000) {
          a.hosted = true;
          this.broadcast?.({ type: 'toast', text: `🤖 ${a.name} 已由 Agent 托管（3 分钟无操作）` });
        }
      }
      // 动作冷却
      if (a.busy && Date.now() > a.busy.until) a.busy = null;
    }
    // Agent 大脑
    brainTick(this, dtMs);
    // 社交
    socialTick(this, dtMs);
    // 广播（5Hz）
    this.broadcastStates();
  }

  onNewDay() {
    for (const r of this.rooms.values()) {
      for (const p of r.plants) {
        p.grow += 1;
        p.watered = false; p.wateredToday = false;
      }
      // 洒水器自动浇灌（半径读 balance.facilities；buildId = facilities.id）
      const radiusByFac: Record<number, number> = {};
      for (const f of (balance as any).facilities) radiusByFac[f.id] = f.radius ?? 0;
      for (const b of r.buildings) {
        const radius = radiusByFac[b.buildId] ?? 0;
        if (radius > 0) {
          for (const p of r.plants) {
            if (Math.abs(p.grid[0] - b.grid[0]) <= radius && Math.abs(p.grid[1] - b.grid[1]) <= radius) {
              p.watered = true; p.wateredToday = true;
            }
          }
        }
      }
    }
    this.broadcast?.({ type: 'toast', text: `🌅 第 ${this.day} 天开始了` });
  }

  send(ws: any, msg: any) { this.io?.(ws, msg); }
  sayRoom(room: Room, text: string) { for (const ws of this.clients.keys()) { const c = this.clients.get(ws)!; const a = this.actors.get(c.actorId); if (a && a.sceneId === room.sceneId && a.instanceId === room.instanceId) this.send(ws, { type: 'toast', text }); } }

  broadcastStates() {
    const now = Date.now();
    const byActor = new Map<string, { ws: any; client: any }>();
    for (const [ws, c] of this.clients) byActor.set(c.actorId, { ws, client: c });

    for (const [ws, c] of this.clients) {
      const a = this.actors.get(c.actorId); if (!a) continue;
      const room = this.rooms.get(this.roomKey(a.sceneId, a.instanceId))!;
      this.loadRoomCollide(room);
      const list = [...this.actors.values()].filter(o => o.sceneId === a.sceneId && o.instanceId === a.instanceId);
      const spec = c.spectateId ? this.actors.get(c.spectateId) : null;
      const state: any = {
        type: 'state',
        sceneId: a.sceneId, instanceId: a.instanceId, map: room.mapName,
        actors: list.map(o => ({
          id: o.id, name: o.name, color: o.color, isAgent: o.isAgent, isNpc: o.isNpc,
          head: o.head, pathName: o.pathName,
          x: o.x, y: o.y, dir: o.dir, moving: o.moving, sceneId: o.sceneId, instanceId: o.instanceId
        })),
        plants: room.plants.map(p => ({ ...p, stage: Math.min(1, p.grow / Math.max(1, plantGrow(p.plantId))) })),
        buildings: room.buildings,
        you: {
          id: a.id, name: a.name, isAgent: a.isAgent,
          hunger: a.hunger, hp: a.hp, gold: a.gold,
          day: this.day, hour: this.hour, sceneName: scenesById[a.sceneId]?.name || '',
          hosted: a.hosted, items: a.items,
          tasks: a.tasks.completed.length + '/' + Object.keys(data.tasks.tasks).length,
          relations: a.relations
        }
      };
      if (spec) state.specActor = { id: spec.id, name: spec.name, thought: spec.brain.lastThought };
      this.send(ws, state);
    }
  }
}

function plantGrow(plantId: number): number {
  const p = data.plants.find(x => x.id === plantId);
  return p?.grow ?? data.plants.find(x => x.next_id?.includes(plantId))?.grow ?? 3;
}

export const world = new World();