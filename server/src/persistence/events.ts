// persistence/events.ts —— 事件日志服务：append / since / 快照 / 哈希（事件即事实源）
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { z } from 'zod';

export interface GameEvent {
  seq: number;
  ts: number;
  type: string;
  actor: string | null;
  payload: Record<string, unknown>;
  seed: number | null;
}

export interface SnapshotRec {
  id: number;
  day: number | null;
  seq: number;
  state: string;
  createdAt: number;
}

// 事件载荷 schema（zod 定义复用于校验与回放文档；payload 宽松：未知事件重放跳过）
export const EventSchemas: Record<string, z.ZodType<Record<string, unknown>>> = {
  'player.move': z.object({ scene: z.number(), x: z.number(), y: z.number() }),
  'agent.pos': z.object({ x: z.number(), y: z.number(), scene: z.number() }),
  'chat.msg': z.object({ nick: z.string(), text: z.string() }),
  'plant.sown': z.object({ uId: z.number(), plantId: z.number(), x: z.number(), y: z.number(), sownAt: z.number() }),
  'crop.watered': z.object({ uId: z.number(), sownAt: z.number(), growDay: z.number() }),
  'crop.autowatered': z.object({ updates: z.array(z.object({ uId: z.number(), sownAt: z.number(), growDay: z.number() })) }),
  'crop.harvested': z.object({ uId: z.number() }),
  'tree.chopped': z.object({ uId: z.number(), hp: z.number() }),
  'plot.tilled': z.object({ x: z.number(), y: z.number(), owner: z.string() }),
  'sprinkler.placed': z.object({ x: z.number(), y: z.number(), level: z.number(), owner: z.string() }),
  'item.consumed': z.object({ uid: z.string(), itemId: z.number(), num: z.number() }),
  'item.gained': z.object({ uid: z.string(), itemId: z.number(), num: z.number() }),
  'fish.caught': z.object({ uid: z.string(), itemId: z.number(), seed: z.number() }),
  'ore.mined': z.object({ uid: z.string(), itemId: z.number(), seed: z.number() }),
  'social.fav': z.object({ a: z.string(), b: z.string(), delta: z.number() }),
  'social.relation': z.object({ a: z.string(), b: z.string(), relation: z.string(), by: z.string() }),
  'dm.unlocked': z.object({ a: z.string(), b: z.string() }),
  'task.progress': z.object({ uid: z.string(), type: z.string(), n: z.number() }),
  // CDA 市场（B1.2）：资产已在 live 结算，事件为审计/旁证（重放 no-op）
  'order.placed': z.object({ item: z.number(), side: z.string(), price: z.number(), qty: z.number(), orderId: z.number() }),
  'order.cancelled': z.object({ item: z.number(), orderId: z.number() }),
  'trade.filled': z.object({ item: z.number(), price: z.number(), qty: z.number(), maker: z.string(), taker: z.string(), ts: z.number() }),
  // 历法/天气（B8）：日效应已在 live 处理，事件为记录（重放 no-op）
  'calendar.day': z.object({ day: z.number(), season: z.string(), weather: z.string(), festival: z.string().nullable(), rainAccelerated: z.number(), stormDestroyed: z.number() }),
  'crop.stormDamaged': z.object({ uId: z.number(), day: z.number() }),
  'crop.insurance': z.object({ uId: z.number(), amount: z.number(), day: z.number() }),
  // NPC 日程（B7）
  'npc.schedule': z.object({ npc: z.number(), activity: z.string(), scene: z.number(), x: z.number(), y: z.number(), day: z.number(), hour: z.number(), weather: z.string(), festival: z.string().nullable() }),
  // 畜牧 / 烹饪（B9）
  'animal.adopted': z.object({ uid: z.string(), animalId: z.number(), uId: z.number(), x: z.number(), y: z.number() }),
  'animal.fed': z.object({ uid: z.string(), animalUid: z.number(), itemId: z.number().nullable() }),
  'animal.produced': z.object({ uid: z.string(), uId: z.number(), itemId: z.number(), quality: z.string(), qty: z.number() }),
  'item.cooked': z.object({ uid: z.string(), recipe: z.number(), itemId: z.number(), num: z.number() }),
  'facility.built': z.object({ uid: z.string(), type: z.string(), x: z.number(), y: z.number() }),
  // 家具装饰（B10）
  'decor.placed': z.object({ uid: z.string(), houseId: z.number(), decorId: z.number(), x: z.number(), y: z.number() }),
  'decor.removed': z.object({ uid: z.string(), x: z.number(), y: z.number() }),
  'decor.contest': z.object({ uid: z.string(), score: z.number(), complete: z.boolean() }),
  // 节日集市与比赛（B11）
  'festival.result': z.object({ festival: z.string(), winner: z.string(), score: z.number(), prize: z.number(), top: z.array(z.object({ uid: z.string(), score: z.number() })) }),
  'market.stall': z.object({ uid: z.string(), fee: z.number(), festival: z.string() }),
  // N9 内容扩容：季节事件线 / 新手引导 / 任务链推进（记录用，重放 no-op：状态在 world/玩家桶）
  'season.event': z.object({ id: z.string(), season: z.string(), title: z.string(), day: z.number() }),
  'task.chain': z.object({ uid: z.string(), chain: z.string(), stage: z.string(), reward: z.number() }),
  'onboarding.step': z.object({ uid: z.string(), step: z.string(), minutes: z.number() }),
  // C/D 包抢占与租约（2026-10-03 接上事件流：此前 claimsData/leaseData 只在 live 变更，
  // 回放无法重建 —— 事件拥有域不入事件流 = 事实源缺失）
  'claim.granted': z.object({ uid: z.string(), kind: z.string(), ref: z.string(), since: z.number(), expiresAt: z.number().nullable() }),
  'claim.released': z.object({ uid: z.string(), kind: z.string(), ref: z.string() }),
  'lease.opened': z.object({ plot: z.string(), uid: z.string(), startTick: z.number(), leaseMs: z.number() }),
  'lease.cared': z.object({ plot: z.string(), uid: z.string(), lastCareTick: z.number(), leaseMs: z.number(), careCount: z.number() }),
  'lease.regrown': z.object({ plots: z.array(z.string()) }),
};

export interface EventLogOpts {
  /** 每 N 个事件自动快照（设计：每 1 游戏日 + 每 5000 事件） */
  snapshotEvery: number;
  /** 取当前状态用于快照 */
  getState: () => import('./state.ts').WorldState;
  /** 快照所在 slot 的存档路径选项（fromSnapshot 用） */
  stateOpts: import('./state.ts').StateOpts;
  /** 取当前游戏日（playerData.day 的聚合，缺省 0） */
  getDay?: () => number;
}

export class EventLog {
  private db: DatabaseSync;
  private opts: EventLogOpts;
  private lastSeq = 0;
  private stmtAppend: StatementSync | null = null;
  private stmtMaxSeq: StatementSync | null = null;
  private stmtSince: StatementSync | null = null;
  private listeners: Array<(ev: GameEvent) => void> = [];

  constructor(db: DatabaseSync, opts: EventLogOpts) {
    this.db = db;
    this.opts = opts;
  }

  /** 事件订阅（导演镜头/回放等实时管线；append 同步触发） */
  listen(fn: (ev: GameEvent) => void): void {
    this.listeners.push(fn);
  }

  /** 初始化：取最后 seq（崩溃恢复后继续递增） */
  init(): number {
    this.stmtMaxSeq = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM events');
    const row = this.stmtMaxSeq.get() as { m: number };
    this.lastSeq = row.m;
    this.stmtAppend = this.db.prepare('INSERT INTO events (ts, type, actor, payload, seed) VALUES (?, ?, ?, ?, ?)');
    this.stmtSince = this.db.prepare('SELECT seq, ts, type, actor, payload, seed FROM events WHERE seq > ? ORDER BY seq');
    return this.lastSeq;
  }

  get lastEventSeq(): number { return this.lastSeq; }

  /** 追加事件（同事务语义：单行写入即提交；WAL 保证崩溃安全） */
  append(type: string, actor: string | null, payload: Record<string, unknown>, seed: number | null = null): GameEvent {
    const ev: GameEvent = { seq: this.lastSeq + 1, ts: Date.now(), type, actor, payload, seed };
    this.stmtAppend!.run(ev.ts, ev.type, ev.actor, JSON.stringify(ev.payload), seed);
    this.lastSeq = ev.seq;
    // 事件自动快照（每 N 个）
    if (this.opts.snapshotEvery > 0 && ev.seq % this.opts.snapshotEvery === 0) {
      this.takeSnapshot();
    }
    // 实时管线（导演镜头等）：同步触发订阅
    for (const fn of this.listeners) {
      try { fn(ev); } catch (e) { console.warn('[events] listener 异常（已隔离）：', (e as Error)?.message); }
    }
    return ev;
  }

  /** 读取 seq 之后的事件（回放/恢复/校验） */
  since(seq: number, limit?: number): GameEvent[] {
    const stmt = limit ? this.db.prepare('SELECT seq, ts, type, actor, payload, seed FROM events WHERE seq > ? ORDER BY seq LIMIT ?')
      : this.stmtSince!;
    const rows = (limit ? stmt.all(seq, limit) : stmt.all(seq)) as Array<{
      seq: number; ts: number; type: string; actor: string | null; payload: string; seed: number | null;
    }>;
    return rows.map(r => ({
      seq: r.seq, ts: r.ts, type: r.type, actor: r.actor,
      payload: JSON.parse(r.payload) as Record<string, unknown>, seed: r.seed,
    }));
  }

  countSince(seq: number): number {
    const r = this.db.prepare('SELECT COUNT(*) AS c FROM events WHERE seq > ?').get(seq) as { c: number };
    return r.c;
  }

  totalEvents(): number {
    const r = this.db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number };
    return r.c;
  }

  totalSnapshots(): number {
    const r = this.db.prepare('SELECT COUNT(*) AS c FROM snapshots').get() as { c: number };
    return r.c;
  }

  /** 手动/定时快照：状态全量序列化入 snapshots 表 */
  takeSnapshot(): number {
    const day = this.opts.getDay ? this.opts.getDay() : 0;
    const state = this.opts.getState().serialize();
    const info = this.db.prepare('INSERT INTO snapshots (day, seq, state, created_at) VALUES (?, ?, ?, ?)')
      .run(day, this.lastSeq, state, Date.now());
    return Number(info.lastInsertRowid);
  }

  /** 最近快照（恢复起点） */
  lastSnapshot(): SnapshotRec | null {
    const r = this.db.prepare('SELECT id, day, seq, state, created_at FROM snapshots ORDER BY id DESC LIMIT 1').get() as
      { id: number; day: number | null; seq: number; state: string; created_at: number } | undefined;
    if (!r) return null;
    return { id: r.id, day: r.day, seq: r.seq, state: r.state, createdAt: r.created_at };
  }
}
