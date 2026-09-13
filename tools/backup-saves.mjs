#!/usr/bin/env node
// 存档自动备份：把 data/saves/ 提交到本地 git 并 push 到远端
// 无 token / push 失败时只 commit 不 push（本地始终有最新存档，不阻塞游戏）
// 用法：node tools/backup-saves.mjs [--push]  由 afserver.mjs 定时或手动调用
// 本仓库是 sparse-checkout，git add 必须带 --sparse
// 容器部署：设置 AF_NO_GIT=1 跳过 git 操作（存档走 Fly.io volume，不依赖 git）
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, unlinkSync, writeFileSync, statSync } from 'node:fs';

if (process.env.AF_NO_GIT) {
  console.log('[backup] AF_NO_GIT=1，跳过 git 备份（容器环境存档走持久卷）');
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// 返回 { ok, out }：execSync 成功时 stdout 在返回值的 out，失败时 catch 拼接 stdout+stderr
// GIT_TERMINAL_PROMPT=0：禁 credential helper 交互，强制走 .netrc 凭据
function sh(cmd) {
  try {
    const out = execSync(cmd, {
      cwd: ROOT, stdio: 'pipe', timeout: 90000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).toString();
    return { ok: true, out };
  } catch (e) {
    const out = ((e.stdout && e.stdout.toString()) || '') + ((e.stderr && e.stderr.toString()) || '');
    return { ok: false, out };
  }
}

// 凭据探测：dry-run push 能通且有实际内容才算有 push 凭据
// 成功 / up-to-date → true；401/403/500/auth 失败/空输出 → false
function hasPushCredential() {
  const test = sh('git push origin HEAD --dry-run 2>&1');
  if (!test.ok) return false;
  if (/401|403|unauthorized|authentication failed|could not read username/i.test(test.out)) return false;
  if (!test.out.trim()) return false; // 空输出（如 helper 500）一律判无凭据
  return true;
}

const doPush = process.argv.includes('--push') || hasPushCredential();

// 幂等锁：防 afserver 定时器与手动调用并发跑（git add/commit/push 非原子）
const LOCK = join(ROOT, '.backup-lock');
if (existsSync(LOCK)) {
  const age = Date.now() - statSync(LOCK).mtimeMs;
  if (age < 10 * 60 * 1000) {
    console.log('[backup] 另一备份进程运行中，本次跳过');
    process.exit(0);
  }
  unlinkSync(LOCK); // 死锁清理
}
writeFileSync(LOCK, String(process.pid));
// process.exit 不触发 finally，须显式挂钩子清锁
process.on('exit', () => { try { unlinkSync(LOCK); } catch {} });

try {
  const status = sh('git status --porcelain data/saves/');
  if (!status.out.trim()) {
    console.log('[backup] 存档无变化，跳过');
    process.exit(0);
  }

  sh('git add --sparse data/saves/');
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const commit = sh(`git commit -m "chore(saves): auto backup ${stamp}"`);
  if (!commit.ok && /nothing to commit/i.test(commit.out)) {
    console.log('[backup] 存档无实际变化，跳过');
    process.exit(0);
  }
  if (!commit.ok) {
    console.warn('[backup] commit 失败:', commit.out.slice(0, 300));
    process.exit(1);
  }
  console.log('[backup] 存档已 commit');

  if (doPush) {
    const push = sh('git push origin HEAD');
    if (!push.ok) {
      console.warn('[backup] push 失败（不影响游戏，存档已在本地）:', push.out.slice(0, 300));
    } else {
      console.log('[backup] 已推送到远端');
    }
  } else {
    console.log('[backup] 无 push 凭据，仅本地 commit（配置 GitHub token 后自动推送）');
  }
  process.exit(0);
} catch {
  // 锁由 process.on('exit') 钩子统一清理
}
