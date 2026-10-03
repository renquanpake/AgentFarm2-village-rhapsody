// persistence/save-version.ts —— N11 存档版本化与迁移注册表
//
// 事故模型：`persist()` 写死 `version: 4`，而 `importSave()` 从不读版本号 —— 版本号是死值，
// 改它不会改变任何加载行为；三个历史迁移（afCoordMigrated / afPlantBucketVillage /
// afStrayBucketRepaired）是构造函数里的散装 `if`，各自靠 global 标志幂等，
// 没有顺序、没有版本区间、没有回归手段。
//
// 本模块给出总政策：
//   1. SAVE_VERSION 单一常量（state.ts 的 persist 与 /af/save-version 共用，杜绝两个魔数）
//   2. 迁移注册表：有序、每条声明 [from, to) 版本区间 + 幂等标志键，runMigrations 按序执行
//   3. 读版本：importSave 记录存档版本，缺失视作 v1（最老档），供 app 启动时补迁移
//   4. 演练：tools/migration-rehearse.mjs 在临时目录复制真实存档、逐版本回放迁移、断言数据仍在
//
// 新增迁移的唯一正确姿势：往 MIGRATIONS 里追加一条（id/区间/幂等键/run），
// 并在 tools/migration-rehearse.mjs 的用例里覆盖它 —— 门11/门12 之外的第三道人工确认。
import type { WorldState } from './state.ts';

export const SAVE_VERSION = 5;

/** 版本记录在 globals 的键（玩家与运维都能在存档里直接看到） */
export const SAVE_VERSION_KEY = 'afSaveVersion';

export interface MigrationDef {
  id: string;
  /** 适用版本区间 [from, to)：存档版本号落在该区间才执行 */
  from: number;
  to: number;
  /** 幂等标志键（写进 globals；已置位则跳过 —— 迁移可重复调用） */
  flag: string;
  describe: string;
  run(state: WorldState): void;
}

/** 迁移注册表（顺序即执行顺序；追加只能加在末尾） */
export const MIGRATIONS: MigrationDef[] = [
  {
    id: 'coord-shift',
    from: 1, to: 3, flag: 'afCoordMigrated',
    describe: '世界坐标迁移：旧档植物/农田 +farmLeft 格（地图扩展 14 格）',
    run: (s) => s.migrateWorldCoords(),
  },
  {
    id: 'plant-bucket-village',
    from: 3, to: 4, flag: 'afPlantBucketVillage',
    describe: '玩家作物从 HOME_MAP(1) 桶归位 VILLAGE_MAP(2)（含 uId 重发与 plantUID 改写）',
    run: (s) => s.migratePlantBucket(),
  },
  {
    id: 'stray-bucket-repair',
    from: 4, to: 5, flag: 'afStrayBucketRepaired',
    describe: '幽灵桶修复：未注册 world/global 键曾落进 uid="" 玩家桶，每次重启丢失',
    run: (s) => s.repairStrayBuckets(),
  },
];

/** 存档里读到的版本（无 afSaveVersion 时按 data.version 判定，缺失视作 1 = 最老档） */
export function saveVersionOf(state: WorldState, docVersion?: number): number {
  const g = state.globals.get(SAVE_VERSION_KEY) as { val?: number } | undefined;
  if (g && typeof g.val === 'number' && g.val > 0) return g.val;
  if (typeof docVersion === 'number' && docVersion > 0) return docVersion;
  return 1;
}

export interface MigrationRun {
  from: number;
  to: number;
  applied: string[];
  skipped: string[];
}

/**
 * 补齐迁移：把存档从 fromVersion 升到 SAVE_VERSION。
 * 幂等（靠每条迁移自己的 flag），可重复调用；版本已达标时只回写版本号。
 */
export function runMigrations(state: WorldState, fromVersion: number, log: (msg: string) => void = console.log): MigrationRun {
  const applied: string[] = [];
  const skipped: string[] = [];
  let v = Math.max(1, Math.floor(fromVersion));
  for (const m of MIGRATIONS) {
    if (v >= m.to) continue;                 // 版本已越过该迁移区间
    if (v < m.from) { skipped.push(`${m.id}(版本 ${v} 未达 ${m.from})`); continue; }
    const flagVal = (state.globals.get(m.flag) as { val?: number } | undefined)?.val;
    if (flagVal) { skipped.push(`${m.id}(已迁移)`); v = Math.max(v, m.to); continue; }
    m.run(state);
    state.globals.set(m.flag, { val: 1 });
    applied.push(m.id);
    v = Math.max(v, m.to);
  }
  state.globals.set(SAVE_VERSION_KEY, { val: SAVE_VERSION });
  if (applied.length) {
    state.persist();
    log(`[migrate] 存档 v${fromVersion} -> v${SAVE_VERSION}：应用 ${applied.join(', ')}${skipped.length ? `；跳过 ${skipped.join(', ')}` : ''}`);
  }
  return { from: fromVersion, to: SAVE_VERSION, applied, skipped };
}

/** 版本差异报告（/af/save-version 与演练工具用）
 *  needed 判据 = 存档版本 < 该迁移的目标版本（版本号会沿途爬升，越早的档要补的迁移越多） */
export function migrationPlan(fromVersion: number): Array<{ id: string; from: number; to: number; describe: string; needed: boolean }> {
  const v = Math.max(1, Math.floor(fromVersion));
  return MIGRATIONS.map(m => ({ id: m.id, from: m.from, to: m.to, describe: m.describe, needed: v < m.to }));
}