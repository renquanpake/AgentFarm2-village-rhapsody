// persistence/seed.ts —— 首次启动把镜像内种子数据铺进持久卷（Railway/Fly/HF 通用）
// 为什么不只靠 Docker CMD：平台可能用 dashboard 的 startCommand 覆盖 CMD，
// 导致铺种命令被绕过。放到 Node 启动路径里，任何启动方式都绕不开。
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, REPO_ROOT } from '../config.ts';
import { log } from '../logging.ts';

// 运行时数据：绝不能用镜像里的旧副本覆盖玩家真实数据
const SKIP_TOP = new Set([
  'saves', 'backups', 'accounts.json', 'accounts.json.bak', 'agent-provider.json',
  'agent-notes', 'dm-logs', 'screenshots',
]);
const SKIP_REL = new Set([path.normalize('art/raw')]);

export interface SeedStats {
  seedDir: string;
  copied: number;
  skipped: number;
}

function candidateSeedDirs(): string[] {
  const out: string[] = [];
  const env = process.env.AF_SEED_DIR;
  if (env) out.push(env);
  out.push(path.join(REPO_ROOT, 'seed-data'));
  out.push('/app/seed-data');
  return out;
}

/** 把 seedDir 内缺失的文件补到 dataDir；已存在的文件一律不覆盖。返回 null 表示没有可用种子目录。 */
export function ensureSeedData(dataDir: string = DATA_DIR, seedDirOverride?: string): SeedStats | null {
  const seedDir = seedDirOverride
    || candidateSeedDirs().find(d => existsSync(path.join(d, 'seed-villagedb.json')))
    || candidateSeedDirs().find(d => existsSync(d));
  if (!seedDir || !existsSync(seedDir)) {
    log.write('warn', 'seed', '[seed] 未找到种子数据目录（AF_SEED_DIR/seed-data），跳过铺设');
    return null;
  }
  if (path.resolve(seedDir) === path.resolve(dataDir)) return null;

  mkdirSync(dataDir, { recursive: true });
  const stats: SeedStats = { seedDir, copied: 0, skipped: 0 };

  const walk = (rel: string): void => {
    for (const ent of readdirSync(path.join(seedDir, rel), { withFileTypes: true })) {
      const child = rel ? path.join(rel, ent.name) : ent.name;
      if (!rel && SKIP_TOP.has(ent.name)) continue;
      if (SKIP_REL.has(path.normalize(child))) continue;
      const src = path.join(seedDir, child);
      const dest = path.join(dataDir, child);
      if (ent.isDirectory()) {
        mkdirSync(dest, { recursive: true });
        walk(child);
      } else if (ent.isFile()) {
        if (existsSync(dest)) { stats.skipped++; continue; }
        mkdirSync(path.dirname(dest), { recursive: true });
        copyFileSync(src, dest);
        stats.copied++;
      }
    }
  };
  walk('');

  if (stats.copied > 0) {
    log.write('info', 'seed', `[seed] 已从 ${seedDir} 铺设 ${stats.copied} 个文件（已存在跳过 ${stats.skipped} 个）`);
  } else {
    log.write('info', 'seed', `[seed] 种子数据已齐全（跳过 ${stats.skipped} 个已存在文件）`);
  }
  return stats;
}