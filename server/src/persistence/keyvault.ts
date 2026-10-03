// persistence/keyvault.ts —— 玩家自带 LLM Key 保管（设计 M7）
// AES-256-GCM 加密落 SQLite；服务端零池化密钥；日志/事件全链路脱敏（只存密文，仅派生子进程时解密到进程内存）。
// 服务端启动密钥：AF_AES_KEY（32 字节 hex 或 base64）；未配置时密钥保管功能禁用（降级运行，不影响游戏）。
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface LlmKeySpec {
  accountUid: string;
  baseUrl: string;
  model: string;
  tierMap?: Record<string, string>;
  priceHintCpm?: number | null;
}

function deriveKey(): Buffer | null {
  const raw = process.env.AF_AES_KEY;
  if (!raw) return null;
  // 接受 64 位 hex（32 字节）或 44 位 base64（32 字节）；其它长度用 SHA-256 派生（不推荐但兼容）
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else if (/^[A-Za-z0-9+/]{44}={0,2}$/.test(raw)) buf = Buffer.from(raw, 'base64');
  else buf = createHash('sha256').update(raw).digest();
  return buf;
}

export function keyvaultAvailable(): boolean {
  return deriveKey() !== null;
}

export function encryptKey(apiKey: string): { cipher: Buffer; iv: Buffer; tag: Buffer } {
  const key = deriveKey();
  if (!key) throw new Error('keyvault 未配置（需 AF_AES_KEY）');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return { cipher: enc, iv, tag: cipher.getAuthTag() };
}

export function decryptKey(cipher: Buffer, iv: Buffer, tag: Buffer): string {
  const key = deriveKey();
  if (!key) throw new Error('keyvault 未配置（需 AF_AES_KEY）');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(cipher), d.final()]).toString('utf8');
}

// ---------- SQLite 存取 ----------
export function upsertLlmKey(db: DatabaseSync, spec: LlmKeySpec, apiKey?: string): 'ok' | 'no-cipher' {
  if (!keyvaultAvailable()) return 'no-cipher';
  let cipher: Buffer; let iv: Buffer; let tag: Buffer;
  if (apiKey) {
    ({ cipher, iv, tag } = encryptKey(apiKey));
  } else {
    // 未带新 key：保留既有密文（仅更新 url/model/tierMap/price）
    const row = db.prepare('SELECT cipher, iv, tag FROM llm_keys WHERE account_uid = ?').get(spec.accountUid) as
      { cipher: Uint8Array | null; iv: Uint8Array | null; tag: Uint8Array | null } | undefined;
    cipher = row?.cipher ? Buffer.from(row.cipher) : Buffer.alloc(0);
    iv = row?.iv ? Buffer.from(row.iv) : Buffer.alloc(0);
    tag = row?.tag ? Buffer.from(row.tag) : Buffer.alloc(0);
  }
  db.prepare(
    `INSERT INTO llm_keys (account_uid, base_url, model, tier_map, price_hint_cpm, cipher, iv, tag, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_uid) DO UPDATE SET
       base_url=excluded.base_url, model=excluded.model, tier_map=excluded.tier_map,
       price_hint_cpm=excluded.price_hint_cpm, cipher=excluded.cipher, iv=excluded.iv, tag=excluded.tag,
       updated_at=excluded.updated_at`,
  ).run(
    spec.accountUid, spec.baseUrl, spec.model,
    spec.tierMap ? JSON.stringify(spec.tierMap) : null,
    spec.priceHintCpm ?? null,
    cipher, iv, tag, Date.now(),
  );
  return 'ok';
}

export interface VaultedKey {
  accountUid: string;
  baseUrl: string;
  model: string;
  tierMap: Record<string, string> | null;
  priceHintCpm: number | null;
  hasCipher: boolean;
}

export function readLlmKey(db: DatabaseSync, accountUid: string): VaultedKey | null {
  const r = db.prepare(
    'SELECT account_uid, base_url, model, tier_map, price_hint_cpm, cipher, iv, tag FROM llm_keys WHERE account_uid = ?',
  ).get(accountUid) as
    | { account_uid: string; base_url: string; model: string; tier_map: string | null; price_hint_cpm: number | null; cipher: Uint8Array | null; iv: Uint8Array | null; tag: Uint8Array | null }
    | undefined;
  if (!r) return null;
  return {
    accountUid: r.account_uid,
    baseUrl: r.base_url,
    model: r.model,
    tierMap: r.tier_map ? (JSON.parse(r.tier_map) as Record<string, string>) : null,
    priceHintCpm: r.price_hint_cpm,
    hasCipher: !!(r.cipher && r.cipher.length > 0),
  };
}

/** 解密玩家 Key（仅在派生 LLM 调用时；返回值立即使用，勿落日志/事件） */
export function getDecryptedKey(db: DatabaseSync, accountUid: string): { baseUrl: string; model: string; key: string; tierMap: Record<string, string> | null } | null {
  const v = readLlmKey(db, accountUid);
  if (!v) return null;
  if (!v.hasCipher) return { baseUrl: v.baseUrl, model: v.model, key: '', tierMap: v.tierMap };
  const row = db.prepare('SELECT cipher, iv, tag FROM llm_keys WHERE account_uid = ?').get(v.accountUid) as { cipher: Uint8Array; iv: Uint8Array; tag: Uint8Array };
  return { baseUrl: v.baseUrl, model: v.model, key: decryptKey(Buffer.from(row.cipher), Buffer.from(row.iv), Buffer.from(row.tag)), tierMap: v.tierMap };
}

// ---------- 计量（M7） ----------
export function recordUsage(db: DatabaseSync, p: {
  accountUid: string; agentUid?: string; taskType: string; tier: string;
  tokensIn?: number; tokensOut?: number; cached?: boolean; usdHint?: number;
}): number {
  const info = db.prepare(
    'INSERT INTO llm_usage (account_uid, agent_uid, task_type, tier, tokens_in, tokens_out, cached, usd_hint, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    p.accountUid, p.agentUid ?? null, p.taskType, p.tier,
    p.tokensIn ?? null, p.tokensOut ?? null, p.cached ? 1 : 0, p.usdHint ?? null, Date.now(),
  );
  return Number(info.lastInsertRowid);
}

export interface UsageSummary {
  accountUid: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  cached: number;
  byTier: Record<string, number>;
  byTask: Record<string, number>;
  usdHint: number;
}

export function usageSummary(db: DatabaseSync, accountUid: string, sinceMs = 0): UsageSummary {
  // 缺表/无行时返回零值（测试里的轻量 mock db 与迁移前旧档都可能命中；熔断闸不能因此崩）
  let r: { calls: number; in_t: number; out_t: number; cached: number; usd: number } = { calls: 0, in_t: 0, out_t: 0, cached: 0, usd: 0 };
  try {
    r = (db.prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(tokens_in),0) AS in_t, COALESCE(SUM(tokens_out),0) AS out_t,
              COALESCE(SUM(cached),0) AS cached, COALESCE(SUM(usd_hint),0) AS usd
       FROM llm_usage WHERE account_uid = ? AND ts >= ?`,
    ).get(accountUid, sinceMs) as typeof r) || r;
  } catch { /* 无 llm_usage 表（轻量 mock db / 旧档）：按零计量 */ }
  const byTier: Record<string, number> = {};
  for (const row of db.prepare('SELECT tier, COUNT(*) AS c FROM llm_usage WHERE account_uid = ? AND ts >= ? GROUP BY tier').all(accountUid, sinceMs) as Array<{ tier: string; c: number }>) {
    byTier[row.tier] = row.c;
  }
  const byTask: Record<string, number> = {};
  for (const row of db.prepare('SELECT task_type AS t, COUNT(*) AS c FROM llm_usage WHERE account_uid = ? AND ts >= ? GROUP BY task_type').all(accountUid, sinceMs) as Array<{ t: string; c: number }>) {
    byTask[row.t] = row.c;
  }
  return { accountUid, calls: r.calls, tokensIn: r.in_t, tokensOut: r.out_t, cached: r.cached, byTier, byTask, usdHint: r.usd };
}
