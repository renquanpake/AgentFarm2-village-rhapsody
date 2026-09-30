// app.ts —— 应用组合根：装配七模块 + 共享运行时（聊天日志 / agent 连接 / LLM provider / 房间码）
// 七模块边界：
//   gateway(HTTP/WS/tunnel) · world(状态/农场/任务/社交) · market(商店) · navigation(寻路)
//   cognition(observe/托管) · narrative(预留) · persistence(存档/账号/便签/事件日志)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type WebSocket from 'ws';
import type { ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  DATA_DIR, CLIENT_ROOT, SAVES_DIR, SEED_FILE, ACCOUNTS_FILE, PROVIDER_FILE,
  CURRENT_SLOT, GROW_DAY_MS, WS_HEARTBEAT_MS, DM_SCENE_COOLDOWN_MS, AGENT_MOVE_STEP, BACKUP_SCRIPT, ART_ROOT, REPO_ROOT,
  NAV_ARRIVE_TIMEOUT_MS, NAV_DEBUG_BLIND, slotPaths,
} from './config.ts';
import { WorldState, loadJson } from './persistence/state.ts';
import type { StateOpts } from './persistence/state.ts';
import { AccountStore } from './persistence/accounts.ts';
import { AgentNotes } from './persistence/notes.ts';
import { openDb } from './persistence/db.ts';
import { EventLog } from './persistence/events.ts';
import { Tables } from './world/tables.ts';
import { DmLogStore } from './world/social.ts';
import { ManagedAgentManager, resolveProvider, type Provider } from './cognition/managed.ts';
import { rebuildState, structuredHash } from './world/apply.ts';
import { currentGameDay, ensureDayAnchor } from './world/calendar.ts';
import { log } from './logging.ts';
import { createNarrativeService, type NarrativeService } from './narrative/index.ts';
import { MarketService } from './market/service.ts';
import { ShadowMarket } from './market/shadow.ts';
import { CognitionService } from './cognition/orchestrator.ts';
import type { ChatEntry, InboxEntry } from './types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class App {
  // 各模块实例
  state!: WorldState;
  accounts: AccountStore;
  tables: Tables;
  notes: AgentNotes;
  dm: DmLogStore;
  managed: ManagedAgentManager;
  db!: DatabaseSync;
  log!: EventLog;
  narrative!: NarrativeService;
  market!: MarketService;
  shadow!: ShadowMarket;
  cognition!: CognitionService;
  stateOpts!: StateOpts;

  // 共享运行时（跨 slot 保留，账号级）
  chatLog: ChatEntry[] = [];
  agentSockets = new Map<string, Set<WebSocket>>(); // uid -> Set<ws>（agent 进程连接）
  roomCodes = new Map<string, string>();            // 6位房间码 -> 公网 url
  roomCode: string | null = null;                   // 当前房间码
  tunnelUrl: string | null = null;
  tunnelProc: ChildProcess | null = null;           // cloudflared 子进程
  provider: Provider;

  // 运行参数（便于注入）
  readonly dataDir = DATA_DIR;
  readonly clientRoot = CLIENT_ROOT;
  readonly growDayMs = GROW_DAY_MS;
  readonly wsHeartbeatMs = WS_HEARTBEAT_MS;
  readonly dmCooldownMs = DM_SCENE_COOLDOWN_MS;
  readonly agentMoveStep = AGENT_MOVE_STEP;
  readonly navArriveTimeoutMs = NAV_ARRIVE_TIMEOUT_MS;
  readonly navDebugBlind = NAV_DEBUG_BLIND;
  readonly backupScript = BACKUP_SCRIPT;
  readonly artRoot = ART_ROOT;
  readonly repoRoot = REPO_ROOT;

  constructor(opts?: { slot?: number; noTunnel?: boolean }) {
    this.tables = new Tables(DATA_DIR);
    this.accounts = new AccountStore(ACCOUNTS_FILE);
    this.notes = new AgentNotes(DATA_DIR);
    this.dm = new DmLogStore(DATA_DIR);

    // LLM provider：env 优先，其次 provider 配置文件
    const providerFile = loadJson<{ url?: string; key?: string; model?: string }>(PROVIDER_FILE, {});
    this.provider = resolveProvider(process.env, providerFile);

    this.openSlot(opts?.slot ?? CURRENT_SLOT);
    this.managed = new ManagedAgentManager(this);
  }

  private stateOptsFor(slot: number): StateOpts {
    return {
      savesDir: SAVES_DIR,
      seedFile: SEED_FILE,
      slot,
      farmLeft: this.tables.mapOffset(),
      spawns: this.tables.spawns,
      growDayMs: this.growDayMs,
    };
  }

  private openSlot(slot: number): void {
    this.stateOpts = this.stateOptsFor(slot);
    this.state = new WorldState(this.stateOpts);
    // 每 slot 一个事件库（slot 切换即换库）
    if (this.db) { try { this.db.close(); } catch { /* ignore */ } }
    const p = slotPaths(SAVES_DIR, slot);
    this.db = openDb(path.join(p.slotDir, 'events.db'));
    this.log = new EventLog(this.db, {
      snapshotEvery: 5000, // 设计：每 5000 事件快照（游戏日触发待 B8 历法接入）
      getState: () => this.state,
      stateOpts: this.stateOpts,
      getDay: () => currentGameDay(this.state), // B8：服务器历法权威游戏日（快照按游戏日）
    });
    this.log.init();
    ensureDayAnchor(this.state); // B8：游戏日锚点（新 slot 首次创建）
    // M1 导演镜头：实时管线（事件 -> 观战者镜头；switchSlot 后随新 log 自动重接）
    this.narrative = createNarrativeService(this);
    this.log.listen((ev) => this.narrative.liveDirector.ingest(ev));
    // B1.2 CDA 市场：订单簿 + 挂单/成交恢复（slot 级，随 db）
    this.market = new MarketService(this);
    this.market.load();
    // B4 影子模式：双实例（影子自成流动性、只记账不结算；挂单/撤单镜像进影子簿）
    this.shadow = new ShadowMarket(this);
    this.market.attachShadow(this.shadow);
    this.shadow.load();
    // C 轨认知编排：事件 -> 情节记忆 + 知识图谱 + OCC 情感 + 八卦（M4；LLM 走 M7 路由，无 Key 规则兜底）
    this.cognition = new CognitionService(this);
    this.log.listen((ev) => { try { this.cognition.onEvent(ev); } catch { /* 认知失败不阻断主流程 */ } });
    // 基线快照：首次运行（无快照且无事件）打一个 baseline，使 快照+事件 可完整重建
    if (!this.log.lastSnapshot() && this.log.countSince(0) === 0) {
      this.log.takeSnapshot();
      log.write('info', 'events', '已创建基线快照（无历史事件）', { slot });
    }
    this.verifyReplay();
  }

  /** 启动一致性校验：重放 最近快照+其后事件，与运行状态的结构化域哈希比对（漂移仅告警） */
  verifyReplay(): void {
    try {
      const snap = this.log.lastSnapshot();
      const events = this.log.since(snap?.seq ?? 0);
      const rebuilt = rebuildState(snap?.state ?? null, events, this.stateOpts, this.tables);
      const a = structuredHash(rebuilt);
      const b = structuredHash(this.state);
      if (a !== b) {
        log.write('warn', 'events', '一致性告警：重放哈希 != 运行状态哈希', { replay: a.slice(0, 12), live: b.slice(0, 12), events: events.length });
      } else {
        log.write('info', 'events', '一致性校验通过', { events: events.length, hash: a.slice(0, 12) });
      }
    } catch (e) {
      log.write('warn', 'events', '一致性校验失败（不影响启动）', { error: (e as Error).message });
    }
  }

  /** 切换存档位：重建 slot 级状态 + 事件库（账号/DM 日志/agent 连接保留；在线玩家由调用方踢出重连） */
  switchSlot(slot: number): void {
    this.openSlot(slot);
  }

  usernameOf(uid: string): string {
    const acc = this.accounts.findAccountByUid(uid);
    if (!acc) return 'default';
    return this.accounts.usernameOf(acc);
  }

  /** agent 收件箱（持久化；agent 不在线也不丢） */
  inboxPush(uid: string, from: string, text: string): InboxEntry {
    const username = this.usernameOf(uid);
    return this.notes.pushInbox(username, from, text);
  }

  inboxDrain(uid: string): InboxEntry[] {
    return this.notes.drainInbox(this.usernameOf(uid));
  }

  /** 玩家昵称（welcome / observe 用） */
  accountNick(uid: string): string {
    const acc = this.accounts.findAccountByUid(uid);
    return acc ? (acc.nick || uid) : ('玩家' + uid.slice(-4));
  }

  /** 关闭资源（进程退出时调用） */
  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }
}
