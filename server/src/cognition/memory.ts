// cognition/memory.ts —— C1 L2 情节记忆（design M4.1）：memory 表 + 三路召回 + FTS5 回落
// 召回分 = 1/3 归一化加权的 recency（指数衰减半衰期 1 游戏日）+ relevance（余弦；无向量走 FTS5）+ importance。
// embedding：编排层轻量档生成（本地缓存 vector BLOB）；无 LLM Key 时用确定性伪向量（哈希 bag）兜底。
import { DatabaseSync } from 'node:sqlite';

export interface MemoryRec {
  id: number;
  agent: string;
  ts: number;
  kind: string;
  content: string;
  participants: string[] | null;
  importance: number;
  model: string | null;
  vector: number[] | null;
}

export interface RecallOpts {
  now?: number;
  halfLifeMs?: number;
  k?: number;
}

// ---------- 纯函数 ----------

/** 指数衰减新近度：半衰期默认 1 游戏日 */
export function recencyScore(ts: number, now: number, halfLifeMs: number): number {
  const age = Math.max(0, now - ts);
  return Math.pow(0.5, age / halfLifeMs);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 归一化到 [0,1]（min-max；全等 -> 1） */
export function normalize(xs: number[]): number[] {
  if (xs.length === 0) return [];
  let mn = Infinity, mx = -Infinity;
  for (const x of xs) { if (x < mn) mn = x; if (x > mx) mx = x; }
  if (mx === mn) return xs.map(() => 1);
  return xs.map(x => (x - mn) / (mx - mn));
}

/** 三路 1/3 加权召回分 */
export function recallScore(r: number, rel: number, imp: number): number {
  return (r + rel + imp) / 3;
}

/** 确定性伪向量（无 LLM embedding 时的兜底：token 哈希 bag，64 维） */
export function pseudoEmbed(text: string, dim = 64): number[] {
  const v = new Array<number>(dim).fill(0);
  const toks = String(text).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
  for (const t of toks) {
    let h = 0;
    for (let i = 0; i < t.length; i++) { h = Math.imul(h ^ t.charCodeAt(i), 0x01000193); h >>>= 0; }
    v[h % dim] += 1;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n ? v.map(x => x / n) : v;
}

/** 把 [0,1] 分映射到 [-1,1]（余弦域），统一召回分尺度 */
export function toCosineDomain(x: number): number { return x * 2 - 1; }

// ---------- 存储 ----------

export class MemoryStore {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  add(agent: string, content: string, opts: { kind?: string; participants?: string[]; importance?: number; model?: string; vector?: number[]; ts?: number } = {}): number {
    const rec: MemoryRec = {
      id: 0, agent, ts: opts.ts ?? Date.now(), kind: opts.kind ?? 'event',
      content, participants: opts.participants ?? null,
      importance: opts.importance ?? 0.5, model: opts.model ?? null,
      vector: opts.vector ?? null,
    };
    const blob = rec.vector ? new Uint8Array(new Float32Array(rec.vector).buffer) : null;
    const info = this.db.prepare(
      'INSERT INTO memory (agent, ts, kind, content, participants, importance, model, vector) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(rec.agent, rec.ts, rec.kind, rec.content, JSON.stringify(rec.participants ?? []), rec.importance, rec.model, blob);
    const id = Number(info.lastInsertRowid);
    try { this.db.prepare('INSERT INTO memory_fts (rowid, content) VALUES (?, ?)').run(id, rec.content); } catch { /* fts 失败不影响主表 */ }
    rec.id = id;
    return id;
  }

  /** 三路召回：FTS5 粗筛候选（含 FTS 命中的全部 + 时间兜底）-> recency/relevance/importance 归一化加权 */
  recall(agent: string, query: string, opts: RecallOpts = {}): MemoryRec[] {
    const now = opts.now ?? Date.now();
    const halfLife = opts.halfLifeMs ?? 86_400_000;
    const k = opts.k ?? 5;
    const rows = this.db.prepare('SELECT * FROM memory WHERE agent = ? ORDER BY ts DESC LIMIT 200').all(agent) as unknown as Array<Record<string, unknown>>;
    const recs: MemoryRec[] = rows.map(r => {
      let vector: number[] | null = null;
      if (r.vector) {
        const bytes = new Uint8Array(r.vector as Uint8Array);
        vector = Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
      }
      return {
        id: Number(r.id), agent: String(r.agent), ts: Number(r.ts), kind: String(r.kind),
        content: String(r.content), participants: r.participants ? JSON.parse(String(r.participants)) as string[] : null,
        importance: Number(r.importance), model: (r.model as string | null) ?? null, vector,
      };
    });
    // FTS5 粗筛
    const ftsHits = this.ftsHitIds(query);
    const cands = recs.filter(r => ftsHits.size > 0 ? ftsHits.has(r.id) : true);
    const pool = cands.length ? cands : recs; // FTS 无命中 -> 全量兜底
    if (!pool.length) return [];
    const qv = pseudoEmbed(query);
    const scored = pool.map(r => {
      const relRaw = r.vector && r.vector.length ? cosine(qv, r.vector) : (ftsHits.has(r.id) ? toCosineDomain(0.6) : 0);
      return { r, s: recallScore(recencyScore(r.ts, now, halfLife), (relRaw + 1) / 2, r.importance) };
    });
    scored.sort((a, b) => b.s - a.s || b.r.ts - a.r.ts);
    const top = scored.slice(0, k);
    for (const t of top) {
      try { this.db.prepare('UPDATE memory SET last_recall = ? WHERE id = ?').run(now, t.r.id); } catch { /* ignore */ }
    }
    return top.map(t => t.r);
  }

  private ftsHitIds(query: string): Set<number> {
    const out = new Set<number>();
    try {
      const terms = String(query).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean).slice(0, 8);
      if (!terms.length) return out;
      const match = terms.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
      for (const row of this.db.prepare('SELECT rowid FROM memory_fts WHERE memory_fts MATCH ? LIMIT 200').all(match) as Array<{ rowid: number }>) out.add(Number(row.rowid));
    } catch { /* FTS 查询语法问题 -> 空集，走全量兜底 */ }
    return out;
  }

  /** 记忆摘要（供日计划/画报；纯聚合） */
  summarize(agent: string, k = 8): Array<{ kind: string; content: string; importance: number }> {
    const rows = this.db.prepare('SELECT kind, content, importance FROM memory WHERE agent = ? ORDER BY importance DESC, ts DESC LIMIT ?').all(agent, k) as Array<{ kind: string; content: string; importance: number }>;
    return rows;
  }
}
