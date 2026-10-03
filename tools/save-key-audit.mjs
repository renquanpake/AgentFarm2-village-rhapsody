// tools/save-key-audit.mjs —— 存档键审计门（进化书 §3.1：任何新世界桶必须登记）
// 扫 server/src 里所有 world.set/globals.set 的键字面量，对照 persistence/state.ts 的
// WORLD_KEYS/GLOBAL_KEYS 注册表；有未登记键即判死（它们会在 importSave 落进 uid='' 幽灵桶，
// 重启静默丢失 —— 2026-10-03 已中招 8 个键）。
// 用法：node tools/save-key-audit.mjs [--quiet]
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { auditSaveKeys } = await import(`${repo}/server/src/persistence/save-keys.ts`);

const r = auditSaveKeys(`${repo}/server/src`);
const quiet = process.argv.includes('--quiet');

if (!quiet) {
  for (const h of r.hits) console.log(`  ${h.bucket.padEnd(6)} ${h.key.padEnd(24)} ${h.at.replace(`${repo}/`, '')}`);
  console.log(`[save-key-audit] 命中写入点 ${r.hits.length} 个（world ${r.hits.filter(h => h.bucket === 'world').length} / global ${r.hits.filter(h => h.bucket === 'global').length}）`);
}

if (r.missing.length) {
  for (const m of r.missing) console.error(`FAIL ${m.bucket} 未登记键 ${m.key} @ ${m.at.replace(`${repo}/`, '')}`);
  console.error(`\n[save-key-audit] ${r.missing.length} 个服务端桶键未登记 -> 重启会丢数据，请加入 WORLD_KEYS/GLOBAL_KEYS`);
  process.exit(1);
}
console.log(`[save-key-audit] PASS 全部服务端桶键已登记（注册表未引用：${r.unused.length} 个，多为客户端/legacy 键）`);