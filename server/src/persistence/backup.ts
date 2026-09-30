// persistence/backup.ts —— 本地备份（设计 M6.3）：每日备份 存档+事件库 到 data/backups/，保留 30 天
// 一致性：先 WAL checkpoint(TRUNCATE) 再把事件库落定，快照内容取自 events.db 的 snapshots 表。
import { copyFileSync, mkdirSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export const BACKUP_RETENTION_DAYS = 30;

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface BackupResult { dir: string; files: string[]; }

/** 备份当前 slot 的 world.json/meta.json/events.db（含 WAL 定容） */
export function runLocalBackup(dataDir: string, savesDir: string, slot: number, db?: DatabaseSync | null): BackupResult {
  const dest = path.join(dataDir, 'backups', `slot${slot}-${stamp()}`);
  mkdirSync(dest, { recursive: true });
  const files: string[] = [];
  const srcDir = path.join(savesDir, `slot${slot}`);
  // WAL 定容：把事件库内容写入主文件（checkpoint 后拷贝主文件即完整）
  try { db?.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ignore */ }
  for (const name of ['world.json', 'meta.json', 'events.db']) {
    const src = path.join(srcDir, name);
    if (existsSync(src)) {
      copyFileSync(src, path.join(dest, name));
      files.push(name);
    }
  }
  pruneOldBackups(path.join(dataDir, 'backups'));
  console.log(`[backup] slot${slot} 已备份到 ${dest}（${files.length} 个文件）`);
  return { dir: dest, files };
}

/** 清理超过保留期的备份目录（目录名 slotN-YYYYMMDD-HHMMSS） */
export function pruneOldBackups(backupsRoot: string): number {
  if (!existsSync(backupsRoot)) return 0;
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 86400_000;
  let pruned = 0;
  for (const entry of readdirSync(backupsRoot)) {
    const m = entry.match(/^slot\d+-(\d{8})-(\d{6})$/);
    if (!m) continue;
    const t = Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8), +m[2].slice(0, 2), +m[2].slice(2, 4), +m[2].slice(4, 6));
    if (t < cutoff) {
      try {
        rmSync(path.join(backupsRoot, entry), { recursive: true, force: true });
        pruned++;
      } catch { /* ignore */ }
    }
  }
  if (pruned > 0) console.log(`[backup] 已清理 ${pruned} 个超过 ${BACKUP_RETENTION_DAYS} 天的备份`);
  return pruned;
}

/** 是否需要备份（最近一次备份超过 maxAgeMs） */
export function needsBackup(backupsRoot: string, maxAgeMs: number): boolean {
  if (!existsSync(backupsRoot)) return true;
  const dirs = readdirSync(backupsRoot).filter(e => e.startsWith('slot'));
  if (!dirs.length) return true;
  let newest = 0;
  for (const d of dirs) {
    try { newest = Math.max(newest, statSync(path.join(backupsRoot, d)).mtimeMs); } catch { /* ignore */ }
  }
  return Date.now() - newest > maxAgeMs;
}
