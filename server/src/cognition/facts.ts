// cognition/facts.ts —— C2 L3 时序知识图谱（design M4.2）：bi-temporal 三元组
// facts(subject, predicate, object, valid_from, valid_to, confidence)；每事件最多 3 三元组（规则抽取；
// LLM 抽取走 M7 轻量档）；"当前有效事实" = valid_to IS NULL；睡眠期批量修订失效事实。
import { DatabaseSync } from 'node:sqlite';
import type { GameEvent } from '../persistence/events.ts';

export interface FactRec {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  valid_from: number;
  valid_to: number | null;
  confidence: number;
  superseded_by: number | null;
  source: string | null;
}

export class FactStore {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  add(subject: string, predicate: string, object: string, validFrom: number, confidence = 1, source?: string): number {
    const info = this.db.prepare(
      'INSERT INTO facts (subject, predicate, object, valid_from, valid_to, confidence, superseded_by, source, ts) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?)'
    ).run(subject, predicate, object, validFrom, confidence, source ?? null, validFrom);
    return Number(info.lastInsertRowid);
  }

  /** 失效（修订）：设 valid_to + 降低置信 */
  invalidate(id: number, validTo: number, supersededBy?: number): void {
    this.db.prepare('UPDATE facts SET valid_to = ?, superseded_by = ?, confidence = confidence * 0.5 WHERE id = ? AND valid_to IS NULL').run(validTo, supersededBy ?? null, id);
  }

  /** 当前有效事实（valid_to IS NULL） */
  current(subject?: string): FactRec[] {
    const q = subject
      ? 'SELECT * FROM facts WHERE valid_to IS NULL AND subject = ? ORDER BY valid_from DESC LIMIT 200'
      : 'SELECT * FROM facts WHERE valid_to IS NULL ORDER BY valid_from DESC LIMIT 200';
    const rows = (subject ? this.db.prepare(q).all(subject) : this.db.prepare(q).all()) as unknown as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToRec(r));
  }

  private rowToRec(r: Record<string, unknown>): FactRec {
    return {
      id: Number(r.id), subject: String(r.subject), predicate: String(r.predicate), object: String(r.object),
      valid_from: Number(r.valid_from), valid_to: r.valid_to ? Number(r.valid_to) : null,
      confidence: Number(r.confidence), superseded_by: r.superseded_by ? Number(r.superseded_by) : null,
      source: (r.source as string | null) ?? null,
    };
  }

  /** 事件 -> 三元组（规则抽取，每事件 <= 3；LLM 抽取失败回落此表） */
  extractFromEvent(ev: GameEvent): Array<{ s: string; p: string; o: string; conf: number }> {
    const out: Array<{ s: string; p: string; o: string; conf: number }> = [];
    const a = ev.actor ?? 'system';
    const P = ev.payload;
    switch (ev.type) {
      case 'crop.harvested': out.push({ s: a, p: 'harvested', o: String(P.uId), conf: 0.9 }); break;
      case 'plant.sown': out.push({ s: a, p: 'planted', o: String(P.uId), conf: 0.9 }); break;
      case 'social.fav': out.push({ s: String(P.a), p: 'favors', o: String(P.b), conf: 0.8 }); break;
      case 'social.relation': out.push({ s: String(P.a), p: 'related_to:' + String(P.relation), o: String(P.b), conf: 0.7 }); break;
      case 'dm.unlocked': out.push({ s: String(P.a), p: 'deep_friend', o: String(P.b), conf: 0.9 }); break;
      case 'trade.filled': out.push({ s: String(P.maker), p: 'sold_to', o: String(P.taker), conf: 0.9 }); break;
      case 'fish.caught': out.push({ s: String(P.uid), p: 'caught', o: String(P.itemId), conf: 0.8 }); break;
      case 'npc.schedule': out.push({ s: 'npc:' + String(P.npc), p: 'was_at', o: String(P.activity), conf: 0.6 }); break;
    }
    return out.slice(0, 3);
  }

  /** 入库抽取（幂等由调用方控频） */
  commitExtraction(ev: GameEvent): number {
    const trs = this.extractFromEvent(ev);
    for (const t of trs) this.add(t.s, t.p, t.o, ev.ts, t.conf, ev.type);
    return trs.length;
  }

  /** 睡眠期修订：低置信 + 长期未再证实的事实降级失效（批量，返回失效数） */
  sleepRevision(now: number, { minConfidence = 0.5, maxAgeMs = 7 * 86_400_000 } = {}): number {
    const stale = this.db.prepare('SELECT id FROM facts WHERE valid_to IS NULL AND confidence < ? AND valid_from < ?').all(minConfidence, now - maxAgeMs) as Array<{ id: number }>;
    for (const r of stale) this.invalidate(r.id, now);
    return stale.length;
  }
}
