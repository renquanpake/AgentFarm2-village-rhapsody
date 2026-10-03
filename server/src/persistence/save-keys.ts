// persistence/save-keys.ts —— 存档键注册表审计（进化书 §3.1「存档键审计门」唯一实现）
//
// 事故模型：world/globals 桶里的键在 importSave 时走 bucketOf；未注册的键被判成
// 玩家私有键，uid 被切成空串 → 落进 uid='' 幽灵桶 → 世界级数据每次重启静默丢失。
// 历史上已因此丢过 afDayAnchor/afLastGameDay/fitnessData/staminaData/facilityData/
// afStalls/gossipData/afLastStorm（2026-10-03 修复 + 迁移回收）。
//
// 门禁：源码里任何 world.set/globals.set 的字面量键必须登记在 WORLD_KEYS/GLOBAL_KEYS，
// 未登记即判死。单测（test/unit/save-key-registry.test.ts）与 tools/save-key-audit.mjs 共用本实现。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WORLD_KEYS, GLOBAL_KEYS } from './state.ts';

export interface BucketKeyHit {
  bucket: 'world' | 'global';
  key: string;
  at: string; // 相对 src 的文件:行
}

export interface SaveKeyAuditResult {
  hits: BucketKeyHit[];
  missing: BucketKeyHit[];   // 源码用到但注册表缺失
  unused: string[];          // 注册了但源码未直接引用（客户端/legacy 键，仅供参考）
}

/** 递归列出 .ts 源文件（跳过 node_modules 与 .d.ts） */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      out.push(...tsFiles(p));
    } else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const RE_WORLD_SET = /\bworld\.set\(\s*'([A-Za-z_][A-Za-z0-9_]*)'/g;
const RE_GLOBAL_SET = /\bglobals\.set\(\s*'([A-Za-z_][A-Za-z0-9_]*)'/g;
const RE_KEY_CONST = /\b(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*_KEY|KEY)\b(?:\s*:[^=]+)?\s*=\s*'([A-Za-z_][A-Za-z0-9_]*)'/g;

function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split('\n').length;
}

/** 去注释（保留换行以维持行号）：注释里的示例字面量不该算写入点 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1);
}

/**
 * 扫出所有「服务端写入 world/globals 桶」的键字面量。
 * 两种写法都覆盖：直接字面量（world.set('afStalls', ...)）与常量间接
 * （const KEY = 'fitnessData' 且同文件 world.set(KEY, ...)）。
 */
export function scanBucketKeys(srcDir: string): BucketKeyHit[] {
  const hits = new Map<string, BucketKeyHit>();
  const push = (bucket: 'world' | 'global', key: string, at: string) => {
    if (!hits.has(`${bucket}:${key}`)) hits.set(`${bucket}:${key}`, { bucket, key, at });
  };
  for (const file of tsFiles(srcDir)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(RE_WORLD_SET)) push('world', m[1], `${file}:${lineOf(src, m.index!)}`);
    for (const m of src.matchAll(RE_GLOBAL_SET)) push('global', m[1], `${file}:${lineOf(src, m.index!)}`);
    RE_KEY_CONST.lastIndex = 0;
    for (const m of src.matchAll(RE_KEY_CONST)) {
      const [, ident, key] = m;
      if (new RegExp(`\\bworld\\.set\\(\\s*${ident}\\b`).test(src)) push('world', key, `${file}:${lineOf(src, m.index!)}`);
      else if (new RegExp(`\\bglobals\\.set\\(\\s*${ident}\\b`).test(src)) push('global', key, `${file}:${lineOf(src, m.index!)}`);
    }
  }
  return [...hits.values()].sort((a, b) => a.at.localeCompare(b.at));
}

/** 对照注册表；missing 非空 = 有未登记的世界桶键 = 判死 */
export function auditSaveKeys(srcDir: string): SaveKeyAuditResult {
  const hits = scanBucketKeys(srcDir);
  const missing: BucketKeyHit[] = [];
  const used = new Set<string>();
  for (const h of hits) {
    used.add(h.key);
    const reg = h.bucket === 'world' ? WORLD_KEYS : GLOBAL_KEYS;
    if (!reg.has(h.key)) missing.push(h);
  }
  const unused = [...WORLD_KEYS, ...GLOBAL_KEYS].filter(k => !used.has(k)).sort();
  return { hits, missing, unused };
}