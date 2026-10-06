// persistence/db.ts —— SQLite（node:sqlite）单例 + WAL + 手写 migrations
// 设计 M6.2/M6.3：events + snapshots 表；WAL 提供并发读与崩溃安全；迁移幂等。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Migration {
  version: number;
  name: string;
  sql: string[];
}

// v1：事件溯源基础表
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'events-snapshots',
    sql: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )`,
      // 事件溯源主表：一切结构化状态变更先落事件再应用
      `CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor TEXT,
        payload TEXT NOT NULL,
        seed INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts)`,
      // 状态快照：定期 + 每游戏日，恢复时 快照 + 其后事件
      `CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day INTEGER,
        seq INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_snapshots_seq ON snapshots(seq)`,
    ],
  },
  {
    version: 2,
    name: 'llm-keys-usage',
    sql: [
      // 玩家自带 LLM Key（M7）：AES-256-GCM 加密保管；服务端零池化密钥
      `CREATE TABLE IF NOT EXISTS llm_keys (
        account_uid TEXT PRIMARY KEY,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        tier_map TEXT,              -- JSON：{"compact":"model-lite","flagship":"model-strong"}（可缺省）
        price_hint_cpm INTEGER,    -- 玩家自报参考价（分/百万 token，计量折算用；可空）
        cipher BLOB,               -- AES-256-GCM 密文（api_key）
        iv BLOB,
        tag BLOB,
        updated_at INTEGER NOT NULL
      )`,
      // LLM 计量（M7）：每次调用记录 {account, agent, task_type, tier, tokens}
      `CREATE TABLE IF NOT EXISTS llm_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_uid TEXT NOT NULL,
        agent_uid TEXT,
        task_type TEXT NOT NULL,
        tier TEXT NOT NULL,
        tokens_in INTEGER,
        tokens_out INTEGER,
        cached INTEGER DEFAULT 0,
        usd_hint REAL,
        ts INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_usage_account_ts ON llm_usage(account_uid, ts)`,
    ],
  },
  {
    version: 3,
    name: 'market-orders-fills',
    sql: [
      // CDA 订单簿（B1.2）：挂单生命周期（id 为引擎订单号，跨重启保留）
      `CREATE TABLE IF NOT EXISTS market_orders (
        id INTEGER PRIMARY KEY,
        item_id INTEGER NOT NULL,
        side TEXT NOT NULL,             -- 'buy' | 'sell'
        price INTEGER NOT NULL,
        qty INTEGER NOT NULL,          -- 剩余（成交扣减）
        owner TEXT NOT NULL,           -- 玩家 uid / 'mm'（做市商虚拟账户）
        status TEXT NOT NULL DEFAULT 'open',  -- open|filled|cancelled
        ts INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_mkt_orders_item_status ON market_orders(item_id, status)`,
      // 成交记录（OHLC/审计/事件溯源旁证）
      `CREATE TABLE IF NOT EXISTS market_fills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        price INTEGER NOT NULL,
        qty INTEGER NOT NULL,
        maker TEXT NOT NULL,
        taker TEXT NOT NULL,
        ts INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_mkt_fills_item_ts ON market_fills(item_id, ts)`,
    ],
  },
  {
    version: 5,
    name: 'market-shadow-fills',
    sql: [
      // B4 影子模式：影子撮合只记账不结算；成交记录供 14 日对比报告（M-B1 验收）
      `CREATE TABLE IF NOT EXISTS market_shadow_fills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        price INTEGER NOT NULL,
        qty INTEGER NOT NULL,
        maker TEXT NOT NULL,
        taker TEXT NOT NULL,
        ts INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_mkt_shadow_fills_item_ts ON market_shadow_fills(item_id, ts)`,
    ],
  },
  {
    version: 6,
    name: 'cognition-memory-facts',
    sql: [
      // C1 L2 情节记忆（M4.1）：agent 记忆条目；vector BLOB 存 embedding（编排层轻量档生成，本地缓存）
      `CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,          -- event/social/task/npc/...
        content TEXT NOT NULL,
        participants TEXT,           -- JSON 数组
        importance REAL NOT NULL DEFAULT 0.5,
        model TEXT,                 -- embedding 模型（缓存键）
        vector BLOB,
        last_recall INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_memory_agent_ts ON memory(agent, ts)`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, tokenize='unicode61')`,
      // C2 L3 时序知识图谱（M4.2）：bi-temporal 三元组
      `CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,            -- 失效时刻（NULL=有效）
        confidence REAL NOT NULL DEFAULT 1,
        superseded_by INTEGER,
        source TEXT,
        ts INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_facts_valid ON facts(subject, predicate, valid_to)`,
      // C4 目标层级（M4.4）：life（persona 派生）/ daily（每晨规划）/ action（当前）
      `CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        tier TEXT NOT NULL,          -- life | daily | action
        parent INTEGER,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',  -- active | done | dropped
        made_at INTEGER NOT NULL,
        done_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_goals_agent_tier ON goals(agent, tier, status)`,
      // C3 OCC 情感（M4.3）：8 主分量持久化（agent 级）
      `CREATE TABLE IF NOT EXISTS agent_mood (
        agent TEXT PRIMARY KEY,
        comps TEXT NOT NULL,   -- JSON：8 分量 0-1
        ts INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: 4,
    name: 'npc-merchants',
    sql: [
      // NPC 商人台账（B2）：cash/inventory 随挂单预留与成交过户更新；策略周期 1 游戏小时
      `CREATE TABLE IF NOT EXISTS merchants (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        home_scene INTEGER NOT NULL,
        risk_appetite REAL NOT NULL,
        cash INTEGER NOT NULL,
        inventory INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        last_cycle INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: 7,
    name: 'market-fills-order-ids',
    sql: [
      // 成交记录补记两侧订单号：全成交的 taker 单从不落 market_orders，
      // 只查 market_orders 的 MAX(id) 会漏掉这段已消耗的 id，重启后序号回绕
      `ALTER TABLE market_fills ADD COLUMN maker_order INTEGER DEFAULT 0`,
      `ALTER TABLE market_fills ADD COLUMN taker_order INTEGER DEFAULT 0`,
    ],
  },
];

export function applyMigrations(db: DatabaseSync): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
  const applied = new Set<number>((db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(r => r.version));
  let maxV = 0;
  for (const m of MIGRATIONS) {
    maxV = Math.max(maxV, m.version);
    if (applied.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      for (const s of m.sql) db.exec(s);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now());
      db.exec('COMMIT');
      console.log(`[db] migration v${m.version} (${m.name}) 已应用`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration v${m.version} 失败：${(e as Error).message}`);
    }
  }
  return maxV;
}

/** 打开数据库（不存在则创建 + WAL + 迁移） */
export function openDb(file: string): DatabaseSync {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  applyMigrations(db);
  return db;
}
