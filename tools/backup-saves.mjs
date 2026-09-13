#!/usr/bin/env node
// 存档自动备份：把 data/saves/ 提交到本地 git 并 push 到远端
// 无 token / push 失败时只 commit 不 push（本地始终有最新存档，不阻塞游戏）
// 用法：node tools/backup-saves.mjs [--push]  由 afserver.mjs 定时或手动调用
// 本仓库是 sparse-checkout，git add 必须带 --sparse
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// 返回 { ok, out }：execSync 成功时 stdout 在 e.stdout（catch 分支），统一从 out 取
function sh(cmd) {
  try {
    const out = execSync(cmd, { cwd: ROOT, stdio: 'pipe', timeout: 90000 }).toString();
    return { ok: true, out };
  } catch (e) {
    const out = ((e.stdout && e.stdout.toString()) || '') + ((e.stderr && e.stderr.toString()) || '');
    return { ok: false, out };
  }
}

// 凭据探测：直接试 push --dry-run，能通才算有凭据（避免 credential helper 异常时误判）
function hasPushCredential() {
  const test = sh('git push origin HEAD --dry-run 2>&1');
  // 成功或 up-to-date 都算有凭据；500/auth 失败算没有
  return test.ok || /up-to-date|Everything up-to-date/i.test(test.out);
}

const doPush = process.argv.includes('--push') || hasPushCredential();

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
  // push 成功时 git 输出 "-> origin/HEAD (up-to-date)" 或 "<sha1>.. <sha1>  HEAD -> master"
  if (!push.ok) {
    console.warn('[backup] push 失败（不影响游戏，存档已在本地）:', push.out.slice(0, 300));
  } else {
    console.log('[backup] 已推送到远端');
  }
} else {
  console.log('[backup] 无 push 凭据，仅本地 commit（配置 GitHub token 后自动推送）');
}
process.exit(0);
