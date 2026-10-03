// tools/migration-rehearse.mjs —— N11 迁移升级演练
//
// 手法：把仓库里的真实存档复制到临时目录，逐个版本「降级重演」——
//   1) 读出当前存档里的关键数据指纹（世界桶计数 / 玩家桶计数 / 若干具名键）
//   2) 抹掉 afSaveVersion 与迁移 flag（模拟老版本档），跑 runMigrations
//   3) 断言：版本号升到 SAVE_VERSION、flag 全部置位、指纹里的世界数据没丢
// 迁移只允许「搬数据」不允许「删数据」，任何一步数据减少即判死。
// 用法：node tools/migration-rehearse.mjs [--slot N]（默认遍历有存档的 slot）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { WorldState } = await import(`${repo}/server/src/persistence/state.ts`);
const { runMigrations, saveVersionOf, SAVE_VERSION, SAVE_VERSION_KEY, MIGRATIONS } = await import(`${repo}/server/src/persistence/save-version.ts`);

const argSlot = (() => {
  const i = process.argv.indexOf('--slot');
  return i > 0 ? Number(process.argv[i + 1]) : null;
})();

const savesDir = `${repo}/data/saves`;
if (!fs.existsSync(savesDir)) { console.error('[migration-rehearse] 无 data/saves 目录，跳过'); process.exit(0); }
const slots = fs.readdirSync(savesDir)
  .filter(d => fs.existsSync(path.join(savesDir, d, 'world.json')))
  .filter(d => argSlot === null || Number(d.replace('slot', '')) === argSlot);
if (!slots.length) { console.error('[migration-rehearse] 没有可演练的存档'); process.exit(1); }

/** 存档指纹：世界/全局键数 + 玩家桶数 + 具名键存在性（迁移只搬不删） */
function fingerprint(st) {
  return {
    worldKeys: st.world.size,
    globalKeys: st.globals.size,
    playerBuckets: st.playersDb.size,
    named: [...st.world.keys()].filter(k => ['plantData', 'farmData', 'socialData', 'claimsData'].includes(k)).sort(),
  };
}

let fails = 0;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'af-migrate-'));
for (const slot of slots) {
  const dir = path.join(tmpRoot, `run-${slot}`); // slotPaths 会再拼 slot< n > 子目录
  fs.cpSync(path.join(savesDir, slot), path.join(dir, slot), { recursive: true });
  const st = new WorldState({ savesDir: dir, seedFile: '', slot: Number(slot.replace('slot', '')), farmLeft: 0, spawns: null, growDayMs: 600000 });
  const before = fingerprint(st);
  const startVersion = saveVersionOf(st);

  // 模拟老版本档：抹掉版本号与全部迁移 flag，再跑一遍注册表
  st.globals.delete(SAVE_VERSION_KEY);
  for (const m of MIGRATIONS) st.globals.delete(m.flag);
  const r = runMigrations(st, 1, () => {});
  const after = fingerprint(st);

  const lost = [];
  for (const k of before.named) if (!st.world.has(k)) lost.push(k);
  const ok = after.worldKeys >= before.worldKeys && after.playerBuckets >= before.playerBuckets && lost.length === 0
    && saveVersionOf(st) === SAVE_VERSION;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${slot}：v${startVersion} -> v${SAVE_VERSION}，应用 [${r.applied.join(',') || '无'}]；`
    + `世界键 ${before.worldKeys}->${after.worldKeys}，玩家桶 ${before.playerBuckets}->${after.playerBuckets}`
    + `${lost.length ? `；丢失具名键 ${lost.join(',')}` : ''}`);
}

// 幂等复演：同一目录再跑一次，必须零应用
{
  const slot = slots[0];
  const dir = path.join(tmpRoot, `idem-${slot}`);
  fs.cpSync(path.join(savesDir, slot), path.join(dir, slot), { recursive: true });
  const st = new WorldState({ savesDir: dir, seedFile: '', slot: Number(slot.replace('slot', '')), farmLeft: 0, spawns: null, growDayMs: 600000 });
  st.globals.delete(SAVE_VERSION_KEY);
  for (const m of MIGRATIONS) st.globals.delete(m.flag);
  runMigrations(st, 1, () => {});
  const second = runMigrations(st, 1, () => {});
  const ok = second.applied.length === 0;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} 幂等复演：二次运行应用 [${second.applied.join(',') || '无'}]（应为无）`);
}

if (fails) { console.error(`\n[migration-rehearse] ${fails} 项失败 —— 迁移会丢数据，禁止上线`); process.exit(1); }
console.log(`\n[migration-rehearse] ${slots.length} 个存档位演练通过（目标版本 v${SAVE_VERSION}，迁移 ${MIGRATIONS.length} 条）`);