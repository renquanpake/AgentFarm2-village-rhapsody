#!/usr/bin/env node
// tools/dev-env-check.mjs —— 接手环境自检（一条命令验证「能不能直接开工」）
//
// 背景：仓库本身能跑起来的前提散落在多处（依赖、puppeteer-core、chrome 二进制、
// 稀疏检出、测试实例），缺一项的表现往往是「跑十分钟后报一个看不懂的错」。
// 本脚本把这些前提逐条验完并给出修复命令，不改任何文件。
//
// 用法：
//   node tools/dev-env-check.mjs                  # 全量自检
//   node tools/dev-env-check.mjs --base http://127.0.0.1:8097   # 追加服务端连通性
//   node tools/dev-env-check.mjs --quick          # 跳过耗时的哈希/UI 门禁
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const QUICK = process.argv.includes('--quick');
const argOf = (k) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : null; };
const BASE = argOf('base');

let fails = 0, warns = 0;
const ok = (m) => console.log(`  [OK]   ${m}`);
const bad = (m, fix) => { fails++; console.log(`  [FAIL] ${m}`); if (fix) console.log(`         修复：${fix}`); };
const warn = (m, fix) => { warns++; console.log(`  [WARN] ${m}`); if (fix) console.log(`         建议：${fix}`); };
const head = (t) => console.log(`\n== ${t} ==`);
const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

console.log('AgentFarm2 接手环境自检');
console.log(`仓库根：${ROOT}`);

// ---------- 1. 仓库状态 ----------
head('1. 仓库');
const branch = sh('git rev-parse --abbrev-ref HEAD');
const remote = sh('git remote get-url origin');
const dirty = sh('git status --porcelain | wc -l');
ok(`分支 ${branch}｜remote ${(remote || '').replace(/https:\/\/[^@]+@/, 'https://***@')}`);
if (!remote) bad('没有 origin 远端', 'git remote add origin <仓库地址>');
else if (!/agent-farm/i.test(remote)) warn(`远端名不含 agent-farm，确认是不是本项目：${remote}`);
const ahead = sh('git rev-list --count @{u}..HEAD 2>/dev/null || echo 0');
const behind = sh('git rev-list --count HEAD..@{u} 2>/dev/null || echo 0');
if (Number(ahead) > 0) warn(`本地领先远端 ${ahead} 个提交（尚未推送）`, 'git push origin ' + branch);
if (Number(behind) > 0) warn(`本地落后远端 ${behind} 个提交`, 'git pull');
if (Number(dirty) > 0) warn(`工作区有 ${dirty} 处未提交改动`);

// ---------- 2. 稀疏检出完整性 ----------
head('2. 关键路径（门禁与活体断言的输入）');
const NEED = [
  ['client/index.html', '客户端外壳'],
  ['client/mod/agentfarm.js', '注入层（agent 画面可视化在此）'],
  ['client/mod/ci-headless.js', 'CI 无渲染模式'],
  ['client/original-hash.json', '原版哈希基线'],
  ['server/package.json', '服务端包配置'],
  ['server/package-lock.json', '服务端锁文件（npm ci 必需）'],
  ['server/ws-test.mjs', '门3 协议回归'],
  ['server/src/gateway/ws.ts', 'WS 网关'],
  ['tools/agent-vis-assert.mjs', 'P1 活体断言'],
  ['tools/package.json', '工具依赖声明'],
  ['data/nav', '导航数据（门6）'],
  ['data/village-collision.json', '碰撞网格（门6）'],
  ['server/public/client/maps', '场景地图（门6 gen-nav）'],
];
let missing = 0;
for (const [rel, why] of NEED) {
  if (existsSync(path.join(ROOT, rel))) ok(`${rel}（${why}）`);
  else { missing++; bad(`缺 ${rel}（${why}）`, '若是稀疏检出：git sparse-checkout add ' + rel); }
}
if (missing === 0) ok('门禁所需路径齐全（非稀疏检出或稀疏规则完整）');

// ---------- 3. 服务端依赖 ----------
head('3. 服务端依赖');
const hasServerMods = existsSync(path.join(ROOT, 'server/node_modules/typescript'));
if (hasServerMods) ok('server/node_modules 就绪');
else bad('server/node_modules 缺失或不全', 'cd server && npm ci --no-audit --no-fund');

// ---------- 4. 工具依赖：puppeteer-core ----------
head('4. 工具依赖（puppeteer-core）');
try {
  const req = createRequire(path.join(ROOT, 'tools', 'agent-vis-assert.mjs'));
  const resolved = req.resolve('puppeteer-core');
  ok(`puppeteer-core 可解析：${path.relative(ROOT, resolved).split(path.sep).slice(0, 3).join('/')}`);
  const declared = readFileSync(path.join(ROOT, 'tools/package.json'), 'utf8');
  if (/puppeteer/.test(declared)) ok('tools/package.json 已声明 puppeteer 依赖');
  else warn('tools/package.json 未声明 puppeteer 依赖', 'cd tools && npm i');
  // 导入名与依赖名是否一致（历史坑：声明 core 但 import 'puppeteer'）
  const badImport = [];
  for (const f of readdirSync(path.join(ROOT, 'tools'))) {
    if (!f.endsWith('.mjs')) continue;
    const src = readFileSync(path.join(ROOT, 'tools', f), 'utf8');
    if (/from ['"]puppeteer['"]/.test(src)) badImport.push(f);
  }
  if (badImport.length) bad(`${badImport.length} 个工具 import 'puppeteer' 但依赖是 puppeteer-core：${badImport.join(', ')}`, "改成 import puppeteer from 'puppeteer-core'");
  else ok('tools 下无残留 import \'puppeteer\'');
} catch (e) {
  bad(`puppeteer-core 解析失败（${String(e.message).slice(0, 60)}）`, 'cd tools && npm i --no-audit --no-fund');
}

// ---------- 5. chrome 二进制 ----------
head('5. chrome 二进制（活体断言 / shot-* 需要）');
const cacheRoot = path.join(process.env.HOME || '/root', '.cache/puppeteer/chrome');
let found = [];
if (existsSync(cacheRoot)) {
  for (const d of readdirSync(cacheRoot)) {
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = path.join(cacheRoot, d, rel);
      if (existsSync(p)) found.push(p);
    }
  }
}
if (found.length) {
  for (const p of found) ok(`发现 ${p}`);
  const newest = found[found.length - 1];
  console.log(`\n  工具里的 AF_CHROME 默认值写的是 chrome-154，本机未必存在。用这个：`);
  console.log(`  export AF_CHROME=${newest}`);
  const defaults = ['tools/agent-vis-assert.mjs', 'tools/shot-client.mjs', 'tools/shot-dm.mjs', 'tools/shot-session.mjs'];
  const stale = defaults.filter((f) => {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    const m = src.match(/AF_CHROME[^\n]*'([^']+)'/);
    return m && !existsSync(m[1]);
  });
  if (stale.length) warn(`${stale.length} 个工具的 AF_CHROME 默认路径在本机不存在`, '设好 AF_CHROME 环境变量，或改默认值');
} else {
  bad('本机没有 chrome 二进制', 'npx puppeteer browsers install chrome（会把 300MB+ 浏览器下到 ~/.cache/puppeteer）');
}

// ---------- 6. 孤儿进程 / 内存 ----------
head('6. 运行环境');
try {
  const free = sh("free -m | awk '/^Mem:/{print $2\" \"$7}'");
  if (free) {
    const [total, avail] = free.split(/\s+/).map(Number);
    ok(`内存总量 ${total}MB / 可用 ${avail}MB`);
    if (avail < 800) warn(`可用内存仅 ${avail}MB：headless Chrome 大概率起不来（经验值 800MB）`, '先清掉上一轮遗留的 chrome 进程');
  }
} catch { warn('读不到内存信息'); }
const chromeProcs = sh("ps -eo comm | grep -c chrome || true");
if (chromeProcs && Number(chromeProcs) > 0) warn(`当前有 ${chromeProcs} 个 chrome 相关进程`, '上一轮遗留的 Chrome 约 900MB，会让下一次 puppeteer.launch 30s 超时；按 PID 精确 kill');
else ok('没有残留 chrome 进程');

// ---------- 7. 服务端连通性 ----------
head('7. 测试实例连通性');
if (!BASE) {
  warn('未指定 --base，跳过', '起实例见 docs/接手与验证指南.md 第三节');
} else {
  try {
    const ctl = AbortSignal.timeout(8000);
    const r = await fetch(BASE + '/', { signal: ctl });
    ok(`${BASE} 可达（HTTP ${r.status}）`);
  } catch (e) {
    bad(`${BASE} 不可达（${String(e.message).slice(0, 50)}）`, '按 docs/接手与验证指南.md 第三节起隔离实例');
  }
}

// ---------- 8. 门禁（可选） ----------
if (!QUICK) {
  head('8. 门禁抽样（typecheck / 壳哈希 / ui-lint / security-check）');
  const gates = [
    ['门1 typecheck', 'cd server && npx tsc --noEmit'],
    ['门5 原版哈希', 'node tools/hash-manifest.mjs --check'],
    ['门8 ui-lint', 'node tools/ui-lint.mjs'],
    ['门4 security-check', 'node tools/security-check.mjs --all'],
  ];
  for (const [name, cmd] of gates) {
    const t0 = Date.now();
    const r = sh(cmd);
    const dt = Math.round((Date.now() - t0) / 1000);
    if (r === null) bad(`${name} 未通过（${dt}s）`, cmd);
    else ok(`${name} 通过（${dt}s）${r ? '｜' + r.split('\n').pop().slice(0, 60) : ''}`);
  }
} else {
  head('8. 门禁');
  warn('--quick：已跳过', 'node tools/dev-env-check.mjs');
}

// ---------- 汇总 ----------
console.log(`\n${'='.repeat(46)}`);
if (fails === 0) console.log(`自检通过${warns ? `（${warns} 条建议）` : ''}——可以开工。`);
else console.log(`自检未通过：${fails} 项 FAIL${warns ? `、${warns} 项 WARN` : ''}，按上面的修复命令处理后重跑。`);
console.log(`下一步读 .monkeycode/docs/HANDOFF-agent-visual-on-screen.md（活体断言 7/9，余 D/E）。`);
process.exit(fails === 0 ? 0 : 1);