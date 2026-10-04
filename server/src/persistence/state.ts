// persistence/state.ts —— 世界状态容器 + 存档桶路由 + 存档位（slot）管理
// 等价 legacy afserver.mjs 的 world/globals/playersDb/bucketOf/persist/switch-slot 段。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import type WebSocket from 'ws';
import type {
  BucketKind, OnlinePlayer, AgentPos, SaveDoc, SpawnDef, SocialPair,
} from '../types.ts';
import { slotPaths } from '../config.ts';
import { runMigrations, saveVersionOf, SAVE_VERSION, SAVE_VERSION_KEY } from './save-version.ts';
export { SAVE_VERSION, SAVE_VERSION_KEY, saveVersionOf };

// livestockData/sprinklerData 是 world 桶（farm.ts:57、livestock.ts:3 明示），
// 却常年不在集合里，导致这些键在客户端回写时被当作未知键静默丢弃、状态永久丢失。
// 第二批（2026-10-03 存档键审计门发现）：fitnessData/staminaData/facilityData/afStalls/gossipData
// 同为 world 桶，globals 侧的 afDayAnchor/afLastGameDay/afLastStorm 同理 —— 未注册则
// importSave 把它们判成玩家私有键，落进 uid='' 的幽灵桶，每次重启静默丢失（实测存档已中招）。
// 门禁：tools/save-key-audit.mjs 扫源码字面量对照本注册表，有未注册键即判死。
export const WORLD_KEYS = new Set([
  'mapData', 'plantData', 'farmData', 'npcData', 'shopData', 'plotData', 'makeData', 'castingData',
  'socialData', 'livestockData', 'sprinklerData', 'claimsData', 'leaseData', 'delegatedData', 'noticeData',
  'fitnessData', 'staminaData', 'facilityData', 'afStalls', 'gossipData',
  'metricData', 'afSeasonEventFired', 'agentLogData',
]);
export const PLAYER_KEYS = new Set(['playerData', 'knapData', 'taskData', 'attributeData', 'settingData', 'buffData', 'achvData', 'storage', 'afTasks', 'afOnboarding', 'afAgentMail', 'afAgentAsk', 'afTutorial']);
export const GLOBAL_KEYS = new Set([
  'audioData', 'gameData', 'afSpawnCount', 'afCoordMigrated', 'afPlantBucketVillage', 'afStrayBucketRepaired',
  'afDayAnchor', 'afLastGameDay', 'afLastStorm', 'afSaveVersion', 'afPlayerIdx',
]);

const SEED_PLAYER_UID = '100001';
const MIGRATED_KEY = 'afCoordMigrated';
const PLANT_BUCKET_KEY = 'afPlantBucketVillage';
const STRAY_BUCKET_KEY = 'afStrayBucketRepaired';

export function loadJson<T>(p: string, fallback: T): T {
  try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return fallback; }
}

/** key 形如 "name_12345" 或 "name" -> 桶路由；未注册的 key 按玩家私有处理（文档既定语义）。
 *  曾因未知 key 返回 null，导致客户端回写的未注册键进不了任何桶、被静默丢弃。 */
export function bucketOf(key: string): [BucketKind, string] {
  const i = key.lastIndexOf('_');
  const name = i > 0 ? key.slice(0, i) : key;
  if (WORLD_KEYS.has(name)) return ['world', name];
  if (PLAYER_KEYS.has(name)) return ['player', name];
  if (GLOBAL_KEYS.has(name)) return ['global', name];
  return ['player', name];
}

export interface StateOpts {
  savesDir: string;
  seedFile: string;
  slot: number;
  farmLeft: number;      // MAP_OFFSET：原版存档格 -> 世界格 偏移
  spawns: SpawnDef | null;
  growDayMs: number;
  /** 完整初始化（读存档/seed、主角模板、坐标迁移）；快照重建时为 false */
  init?: boolean;
  /** 禁止落盘（回放/校验用的重建态：persist/schedulePersist 为 no-op，防止重建态写进生产存档） */
  noPersist?: boolean;
}

/** D1 执行确认闭环：活动路线（航点抽稀 + 盲推兜底指针 + 实际位置跟踪） */
export interface AgentRoute {
  waypoints: Array<{ scene: number; x: number; y: number; cellI: number }>; // cellI = 该航点在 path 中的格序
  i: number;
  misses: number;
  totalMisses: number;
  target: { scene: number; x: number; y: number };
  actual: { scene: number; x: number; y: number };
  path: Array<[number, number]> | null; // 逐格路径（跨场景路线为 null：盲推段粗步）
  pathI: number;
}

/** D4 打断硬停：移动任务句柄（AbortController 模式） */
export interface AgentMoveTask {
  promise: Promise<unknown>;
  abort: () => void;
}

export class WorldState {
  world = new Map<string, unknown>();      // 世界共享桶
  globals = new Map<string, unknown>();    // 全局桶
  playersDb = new Map<string, Map<string, unknown>>(); // uid -> 玩家私有桶（含在线/离线）
  online = new Map<string, OnlinePlayer>();

  // 出生/宅地
  spawnCount = 0;
  houseAssign = new Map<string, number>(); // uid -> house id
  /** 加入序号（uid -> 1..N）：场景 1 槽位归属（B4）与出生序号复用 */
  playerIdx = new Map<string, number>();
  heroTemplate: Map<string, unknown> | null = null;

  // 社交/DM 运行时（slot 级：switch-slot 时重置）
  sceneTogether = new Map<string, Map<string, { scene: number; since: number }>>();
  lastMeetBroadcast = new Map<string, number>();
  playerOps = new Map<string, Array<{ at: number; kind: string; text: string }>>();
  lastOpPush = new Map<string, number>();
  actState = new Map<string, { at: number; text: string }>();

  // 托管 agent 运行时（slot 级）
  agentMoves = new Map<string, AgentMoveTask>();
  agentPos = new Map<string, AgentPos>();
  // D1 执行确认闭环运行时（slot 级）：uid -> 活动路线（航点 + 进度 + 偏差计数 + 实际位置）
  agentRoutes = new Map<string, AgentRoute>();
  // D1：uid -> 待确认 arrive 消费者（客户端/agent 上报实际落点）
  agentArrives = new Map<string, (v: { index: number; x: number; y: number }) => void>();
  // CI 旁路观察者（slot 级）：uid -> 观察连接集合。验收工具以同 uid 直连 /ws 旁观自己的 agent，
  // 走旁路可跳过单点登录踢人、不写 online、不广播 player_join，只收 agent 自身视角消息。
  ciObs = new Map<string, Set<WebSocket>>();
  // B7 NPC 日程运行时（slot 级）：npcId -> 最近一次广播位置（幂等去重用；NPC 位置可重算，不落盘）
  npcSched = new Map<string, { x: number; y: number; scene: number; activity: string }>();

  // slot 文件
  currentSlot: number;
  slotDir: string;
  saveFile: string;
  slotMetaFile: string;
  private farmLeft: number;
  private spawns: SpawnDef | null;
  private growDayMs: number;

  // save 广播合并（500ms 窗口同 key 取最新）
  private savePending = new Map<string, Map<string, unknown>>();
  private savePendingBy = new Map<string, string>();
  private saveFlushTimer: NodeJS.Timeout | null = null;
  // 防抖落盘
  private persistTimer: NodeJS.Timeout | null = null;
  // 回放/校验用重建态：persist/schedulePersist 全部 no-op（绝不写生产存档）
  private noPersist = false;

  constructor(opts: StateOpts) {
    this.currentSlot = opts.slot;
    this.farmLeft = opts.farmLeft;
    this.spawns = opts.spawns;
    this.growDayMs = opts.growDayMs;
    const p = slotPaths(opts.savesDir, opts.slot);
    this.slotDir = p.slotDir;
    this.saveFile = p.saveFile;
    this.slotMetaFile = p.metaFile;
    this.noPersist = opts.noPersist === true;

    if (opts.init === false) return; // 快照重建：字段由调用方填充，不碰文件/迁移

    // 初始化：优先本 slot 存档，否则 seed（原版存档格式，拆桶）
    const doc = existsSync(this.saveFile) ? loadJson<SaveDoc | null>(this.saveFile, null)
      : (existsSync(opts.seedFile) ? loadJson<SaveDoc | null>(opts.seedFile, null) : null);
    if (doc) this.importSave(doc);

    // 主角初始档模板：seed 里 uid=100001 的玩家私有数据（新玩家继承主角初始状态）
    if (this.playersDb.has(SEED_PLAYER_UID)) {
      this.heroTemplate = new Map();
      for (const [name, val] of this.playersDb.get(SEED_PLAYER_UID)!) {
        this.heroTemplate.set(name, structuredClone(val));
      }
    }

    // N11 迁移注册表：按存档版本有序补齐（含历史上的坐标/作物桶/幽灵桶三条），
    // 幂等由各迁移自己的 global 标志保证；版本号回写 globals.afSaveVersion。
    runMigrations(this, saveVersionOf(this, doc?.version));

    this.spawnCount = Number((this.globals.get('afSpawnCount') as { val?: number } | undefined)?.val || 0);
    const idxMap = (this.globals.get('afPlayerIdx') as { val?: Record<string, number> } | undefined)?.val || {};
    for (const [k, v] of Object.entries(idxMap)) if (Number.isFinite(Number(v))) this.playerIdx.set(k, Number(v));
  }

  importSave(s: SaveDoc | null | undefined): void {
    for (const d of (s?.datas || [])) {
      const b = bucketOf(d.key);
      if (!b) continue;
      const [kind, name] = b;
      if (kind === 'world') this.world.set(name, d.val);
      else if (kind === 'global') this.globals.set(name, d.val);
      else {
        const uid = d.key.slice(name.length + 1);
        // 无 uid 后缀的键不可能是玩家私有键（persist 对私有键一律写 `${name}_${uid}`）：
        // 按注册表归位 world/global；两边都没有 = 未登记的服务端桶，打日志丢弃，
        // 杜绝落进 uid='' 幽灵桶（那会让每次重启静默丢数据且多一个假玩家）。
        if (!uid) {
          if (WORLD_KEYS.has(name)) this.world.set(name, d.val);
          else if (GLOBAL_KEYS.has(name)) this.globals.set(name, d.val);
          else console.warn(`[import] 未注册的无主键 ${name}，已丢弃（登记 WORLD_KEYS/GLOBAL_KEYS 或补迁移）`);
          continue;
        }
        if (!this.playersDb.has(uid)) this.playersDb.set(uid, new Map());
        this.playersDb.get(uid)!.set(name, d.val);
      }
    }
  }

  migrateWorldCoords(): void {
    const pd = this.world.get('plantData') as { datas?: Array<{ sceneType: number; plants?: Array<{ x: number; y: number }> }> } | undefined;
    if (pd) for (const sc of (pd.datas || [])) for (const p of (sc.plants || [])) { p.x += this.farmLeft; p.y += this.farmLeft; }
    const fd = this.world.get('farmData') as { plotDatas?: Array<{ sceneType: number; plots?: Array<{ x: number; y: number }> }> } | undefined;
    if (fd) for (const sc of (fd.plotDatas || [])) for (const pl of (sc.plots || [])) { pl.x += this.farmLeft; pl.y += this.farmLeft; }
    this.globals.set(MIGRATED_KEY, { val: 1 });
    this.persist();
    console.log(`[migrate] 世界坐标已迁移（植物/农田 +${this.farmLeft} 格）`);
  }

  /**
   * 世界植物桶归位：原版 HOME_MAP(1) 桶 -> VILLAGE_MAP(2) 桶。
   * 只搬玩家作物（farmType=1）；场景装饰（farmType=2）留在原桶不动。
   * 搬运会重发 uId：旧桶 uId 与村庄桶数值域重叠（slot94 实测 1365 两桶皆有），
   * 直接搬会造成同 uId 两株，地块 plantUID 引用随之改写。
   */
  migratePlantBucket(): void {
    const pd = this.world.get('plantData') as { datas?: Array<{ sceneType: number; plants?: Array<{ uId: number; farmType: number }> }> } | undefined;
    let moved = 0;
    if (pd) {
      const datas = pd.datas || [];
      const home = datas.find(d => d.sceneType === 1);
      const vil = datas.find(d => d.sceneType === 2);
      if (home && vil && home.plants && vil.plants) {
        const crops = home.plants.filter(p => p.farmType === 1);
        if (crops.length) {
          const used = new Set(vil.plants.map(p => p.uId));
          let next = vil.plants.reduce((m, p) => Math.max(m, p.uId), 0);
          const fd = this.world.get('farmData') as { plotDatas?: Array<{ plots?: Array<{ plantUID?: number }> }> } | undefined;
          for (const c of crops) {
            next++;
            while (used.has(next)) next++;
            used.add(next);
            const old = c.uId;
            c.uId = next;
            for (const sc of (fd?.plotDatas || [])) for (const pl of (sc.plots || [])) if (pl.plantUID === old) pl.plantUID = next;
          }
          vil.plants.push(...crops);
          home.plants = home.plants.filter(p => p.farmType !== 1);
          moved = crops.length;
        }
      }
    }
    this.globals.set(PLANT_BUCKET_KEY, { val: 1 });
    this.persist();
    console.log(`[migrate] 玩家作物桶归位 VILLAGE_MAP：${moved} 株`);
  }

  /**
   * 幽灵桶修复：未注册键（afDayAnchor/fitnessData/staminaData/facilityData/afStalls/gossipData
   * /afLastGameDay/afLastStorm）曾被 importSave 判成玩家私有键，uid 被切成空串，
   * 于是这些世界级数据每次重启都从 world/globals 消失（slot94/96/97/98/99 实测中招）。
   * 按注册表搬回正确桶，幂等（afStrayBucketRepaired 标志），修完即删幽灵桶。
   */
  repairStrayBuckets(): void {
    const stray = this.playersDb.get('');
    if (!stray || stray.size === 0) {
      if (!stray) this.playersDb.delete('');
      if (!(this.globals.get(STRAY_BUCKET_KEY) as { val?: number } | undefined)?.val) this.globals.set(STRAY_BUCKET_KEY, { val: 1 });
      return;
    }
    let moved = 0;
    for (const [name, val] of [...stray]) {
      if (WORLD_KEYS.has(name)) { this.world.set(name, val); moved++; }
      else if (GLOBAL_KEYS.has(name)) { this.globals.set(name, val); moved++; }
    }
    this.playersDb.delete('');
    this.globals.set(STRAY_BUCKET_KEY, { val: 1 });
    this.persist();
    if (moved) console.log(`[migrate] 幽灵桶数据归位 ${moved} 项（未注册键曾致重启丢失）`);
  }

  /** 出生点表：新玩家按加入顺序分配到村扩展区宅基地 */
  private assignHouse(uid: string, idx: number): number | null {
    if (!this.spawns || !this.spawns.houses || !this.spawns.houses.length) return null;
    const h = this.spawns.houses[(idx - 2) % this.spawns.houses.length]; // 第 2 个玩家 -> houses[0]
    if (!h) return null;
    this.houseAssign.set(uid, h.id);
    const pm = this.playersDb.get(uid);
    if (pm) {
      const pd = pm.get('playerData') as { houseId?: number } | undefined;
      if (pd) pd.houseId = h.id;
    }
    return h.id;
  }

  ensurePlayerData(uid: string): Map<string, unknown> {
    if (!this.playersDb.has(uid)) this.playersDb.set(uid, new Map());
    const pm = this.playersDb.get(uid)!;
    if (pm.size === 0 && this.heroTemplate) {
      for (const [name, val] of this.heroTemplate) pm.set(name, structuredClone(val));
      const pd = pm.get('playerData') as { uID?: unknown; nickName?: string; sceneType?: number; posSceneType?: number; playerPos?: unknown; playerPlace?: number; houseId?: number } | undefined;
      if (pd) {
        pd.uID = uid;
        pd.nickName = pd.nickName || ('玩家' + String(uid).slice(-4));
      }
      if (this.spawnCount === 0) {
        this.spawnCount = 1;
        this.globals.set('afSpawnCount', { val: 1 });
        this.playerIdx.set(uid, 1);
        console.log('[spawn] 首位玩家保留原版家门口 (scene1)');
      } else {
        this.spawnCount++;
        this.globals.set('afSpawnCount', { val: this.spawnCount });
        const houseId = this.assignHouse(uid, this.spawnCount);
        if (houseId && this.spawns && pd) {
          const h = this.spawns.houses.find(x => x.id === houseId);
          if (h) {
            pd.sceneType = this.spawns.scene || 2;
            pd.posSceneType = this.spawns.scene || 2;
            pd.playerPos = { x: h.door.x, y: h.door.y, z: 0 };
            pd.playerPlace = 1;
            console.log(`[spawn] 玩家 ${uid} (#${this.spawnCount}) 出生在 ${h.type} 门口 (${h.door.x},${h.door.y})`);
          }
        }
      }
      // 出生落盘走防抖（2026-10-03）：同步 persist 会把整份 world.json（>1MB）写进事件循环，
      // 批量注册（灰度/压测）时表现为客户端 ECONNRESET —— 实测 30 并发必现、12 并发正常
      this.schedulePersist();
      console.log(`[hero] 新玩家 ${uid} 继承主角初始档`);
    }
    const pd = pm.get('playerData') as { houseId?: number } | undefined;
    if (pd && pd.houseId && !this.houseAssign.has(uid)) this.houseAssign.set(uid, pd.houseId);
    // 加入序号（B4 槽位归属用；持久化到 globals.afPlayerIdx，重启不丢）
    if (!this.playerIdx.has(uid)) {
      const nextIdx = Math.max(0, ...this.playerIdx.values()) + 1;
      this.playerIdx.set(uid, nextIdx);
      this.globals.set('afPlayerIdx', { val: Object.fromEntries(this.playerIdx) });
      this.schedulePersist();
    }
    return pm;
  }

  // ---------- 落盘 ----------
  persist(): void {
    if (this.noPersist) return; // 重建态绝不写盘
    mkdirSync(this.slotDir, { recursive: true });
    const datas: Array<{ key: string; val: unknown }> = [];
    for (const [name, val] of this.world) datas.push({ key: name, val });
    for (const [name, val] of this.globals) datas.push({ key: name, val });
    for (const [uid, m] of this.playersDb) for (const [name, val] of m) datas.push({ key: `${name}_${uid}`, val });
    writeFileSync(this.saveFile, JSON.stringify({ version: SAVE_VERSION, datas }, null, 1));
    const meta = loadJson<{ lastPlayed?: number; createdAt?: number }>(this.slotMetaFile, {});
    meta.lastPlayed = Date.now();
    meta.createdAt = meta.createdAt || Date.now();
    writeFileSync(this.slotMetaFile, JSON.stringify(meta, null, 1));
  }

  /** save 等高频写操作走 500ms 防抖合并落盘 */
  schedulePersist(): void {
    if (this.noPersist) return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try { this.persist(); } catch (e) { console.log('[persist] 落盘失败', (e as Error)?.message); }
    }, 500);
  }

  /** 进程退出时刷盘未落的防抖存档 */
  flushPendingPersist(): void {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; try { this.persist(); } catch { /* ignore */ } }
  }

  // ---------- save 广播合并（500ms 窗口，同 key 取最新值） ----------
  /** E 包：广播队列深度（管理端点可观测） */
  broadcastQueueDepth(): number { return this.savePending.size; }

  queueSaveBroadcast(targetUid: string, kvPairs: Array<[string, unknown]>, byUid: string): void {
    let m = this.savePending.get(targetUid);
    if (!m) { m = new Map(); this.savePending.set(targetUid, m); }
    for (const [key, value] of kvPairs) m.set(key, value);
    this.savePendingBy.set(targetUid, byUid);
    if (!this.saveFlushTimer) this.saveFlushTimer = setTimeout(() => this.flushSavePending(), 500);
  }

  flushSavePending(): void {
    this.saveFlushTimer = null;
    for (const k of [...this.savePending.keys()]) {
      const m = this.savePending.get(k)!;
      const p = this.online.get(k);
      if (p) {
        // 与 legacy 一致：kv 为原始 [key, 字符串值] 对（客户端存档回推的原文），直接透传
        p.ws.send(JSON.stringify({ t: 'save_broadcast', kv: [...m.entries()], by: this.savePendingBy.get(k) }));
      }
      this.savePending.delete(k);
      this.savePendingBy.delete(k);
    }
  }

  // 社交数据（world 桶 socialData）
  socialDataObj(): { pairs: Record<string, SocialPair> } {
    let s = this.world.get('socialData') as { pairs: Record<string, SocialPair> } | undefined;
    if (!s) { s = { pairs: {} }; this.world.set('socialData', s); return s; }
    if (!s.pairs) s.pairs = {};
    return s;
  }

  growDayMsValue(): number { return this.growDayMs; }

  // ---------- 快照序列化（事件溯源：快照 + 其后事件 = 完整状态） ----------
  serialize(): string {
    const m2a = (m: Map<string, unknown>): Array<[string, unknown]> => [...m.entries()];
    const p2a = (m: Map<string, Map<string, unknown>>): Array<[string, Array<[string, unknown]>]> =>
      [...m.entries()].map(([uid, inner]) => [uid, m2a(inner)] as [string, Array<[string, unknown]>]);
    return JSON.stringify({
      world: m2a(this.world),
      globals: m2a(this.globals),
      playersDb: p2a(this.playersDb),
      agentPos: [...this.agentPos.entries()],
      spawnCount: this.spawnCount,
    });
  }

  /** 从快照重建（不读存档文件；结构化域随后由事件重放补齐） */
  static fromSnapshot(json: string, opts: StateOpts): WorldState {
    const s = JSON.parse(json) as {
      world: Array<[string, unknown]>;
      globals: Array<[string, unknown]>;
      playersDb: Array<[string, Array<[string, unknown]>]>;
      agentPos: Array<[string, AgentPos]>;
      spawnCount: number;
    };
    // 空 state（init=false：不读文件、不迁移、不建主角模板；noPersist=true：绝不写生产存档）
    const st = new WorldState({ ...opts, init: false, noPersist: true });
    st.world = new Map(s.world);
    st.globals = new Map(s.globals);
    st.playersDb = new Map(s.playersDb.map(([uid, arr]) => [uid, new Map(arr)] as [string, Map<string, unknown>]));
    st.agentPos = new Map(s.agentPos);
    st.spawnCount = s.spawnCount;
    return st;
  }
}
