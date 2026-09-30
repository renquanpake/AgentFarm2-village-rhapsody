// world/rng.ts —— 确定性随机与状态哈希（事件溯源回放基石：随机性全部由事件携带的 seed 决定）
import { createHash } from 'node:crypto';

/** mulberry32：32 位确定性 PRNG（同 seed 必同序列） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成 31 位非负随机种子（live 侧写入事件 payload；replay 侧读回重放） */
export function freshSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/** 确定性加权随机（等价 pickWeighted，但结果由 seed 决定） */
export function pickWeightedSeeded(pool: Array<[number, number]>, seed: number): number {
  if (pool.length === 0) return 0;
  let total = 0;
  for (const [, w] of pool) total += w;
  const r = mulberry32(seed)() * total;
  let acc = 0;
  for (const [id, w] of pool) {
    acc += w;
    if (r < acc) return id;
  }
  return pool[pool.length - 1][0];
}

/** 规范化 JSON（键排序）——哈希稳定性的前提 */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
