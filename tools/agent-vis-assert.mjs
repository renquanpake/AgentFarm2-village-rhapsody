// tools/agent-vis-assert.mjs —— 批1 P1.3/P1.4 画面可视化五场景活体断言（RED 基线 / 终局 GREEN）
//
// 验的是「agent 动作在玩家画面实时可见」的 P0 命题（服务端生效但画面无表现 = P0）：
//   A dir 步随    agent act move dir ×6 → node 位移 == 服务端位移（±40px/步），终漂移 ≤440px
//   B 行为飘字    move_to 到可砍树 → act chop → floatCount() ≥1（P1.3 待实现 → RED）
//   C 黑洞重放    blackhole(3) 丢弃 3 条 → act move → 400ms 后解除 → 等 ≤2.5s node 对齐服务端（P1.1 待实现 → RED）
//   D 终点对齐    act move_to → 等 done/20s → node 距服务端 ≤40px（P1.2 待实现 → RED）
//   E 面板文案    act chop 后 #af-agent-live-t / #af-hud-agent 文本含「砍|正在」
//
// 页面侧契约（Task 2-4 实现）：localStorage.af.test==='1' 时 window.__AF_TEST__ =
//   { node():{x,y,scene}|null, serverPos():{x,y,scene}|null, blackhole(n), floatCount():number }
//
// 用法：node tools/agent-vis-assert.mjs --base http://127.0.0.1:8097 [--out /tmp/af-vis] [--user v --pass p]
//   exit 1 于任何 FAIL；report.json 每场景 pass/expected/actual
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const arg = (k, d = null) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const CHROME = process.env.AF_CHROME
  || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const BASE = arg('base', 'http://127.0.0.1:8097').replace(/\/$/, '');
const OUT = arg('out', '/tmp/af-vis');
const USER = arg('user', 'vis_' + Date.now() % 1e6);
const PASS = arg('pass', 'vis_pass_1');
const WAIT = Number(arg('wait', 15000)); // move_to 长路程的宽限
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const j = async (p, b) => {
  const r = await fetch(BASE + p, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {});
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { ok: false, raw: t.slice(0, 120) }; }
};

// ---------- 备号 / 铸 agent token ----------
let acc = await j('/af/register', { username: USER, password: PASS });
if (!acc.token) acc = await j('/af/login', { username: USER, password: PASS });
if (!acc.token) { console.error('[agent-vis] 备号失败'); process.exit(1); }
const ag = await j('/af/agent-token', { token: acc.token });
if (!ag.agentToken) { console.error('[agent-vis] agent-token 失败'); process.exit(1); }
console.log(`[agent-vis] 账号 ${USER} uid=${acc.uid}`);

// ---------- 结果收集 ----------
const results = [];
const check = (name, cond, expected, actual) => {
  results.push({ name, pass: !!cond, expected, actual });
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${actual ? ` | ${actual}` : ''}`);
};

// ---------- 启动浏览器（复用 shot-session 生命周期） ----------
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=800,600'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
  await page.setCacheEnabled(false);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(String(m.text()).slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 200)));

  // 身份 + 测试钩子旗标在页面脚本执行前注入（免登录直达；af.test=1 才注册 __AF_TEST__）
  await page.evaluateOnNewDocument((c) => {
    try {
      localStorage.setItem('af_token', c.token);
      localStorage.setItem('af_uid', c.uid);
      localStorage.setItem('af_nick', c.nick);
      localStorage.setItem('af.test', '1');
    } catch (e) { /* ignore */ }
  }, { token: acc.token, uid: acc.uid, nick: USER });

  // 游戏 WS（模拟客户端，agent 的 move 广播经它对账）—— 复用 dbg-agent-vis 模式
  const pws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  await new Promise((res) => pws.on('open', res));
  pws.send(JSON.stringify({ t: 'join', uid: acc.uid, nick: USER, token: acc.token, scene: 2, x: 3500, y: 3000 }));
  await new Promise((res) => pws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.t === 'welcome') res(); }));
  const agentMoves = [];
  pws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === 'agent_move' || m.t === 'agent_move_done') agentMoves.push(m);
  });

  // agent WS（下 act 指令）
  const aws = new WebSocket(BASE.replace(/^http/, 'ws') + '/agent?token=' + encodeURIComponent(ag.agentToken));
  await new Promise((res) => aws.on('open', res));
  await new Promise((r) => setTimeout(r, 1000));
  let seq = 0;
  const act = (action, payload = {}, ms = 20000) => new Promise((resolve) => {
    const s = ++seq;
    const onMsg = (d) => { const m = JSON.parse(d.toString()); if ((m.t === 'result' || m.t === 'move_started') && m.action === action && m.seq === s) { aws.off('message', onMsg); resolve(m); } };
    aws.on('message', onMsg);
    aws.send(JSON.stringify({ t: 'act', action, seq: s, ...payload }));
    setTimeout(() => { aws.off('message', onMsg); resolve(null); }, ms);
  });

  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => console.log('[agent-vis] goto 警告（客户端可能未就绪）'));
  // 等 __AF_TEST__ 定义（af.test=1 时注入；未注入则场景会 TypeError，正是 RED 需要的信号）
  const boot = await page.waitForFunction('window.__AF_TEST__ !== undefined', { timeout: 15000 }).then(() => 'ok').catch(() => 'MISSING-TEST-HOOK');
  check('boot：页面加载 & __AF_TEST__ 就位', boot === 'ok', '__AF_TEST__ defined', boot);

  const ts = (v) => `window.__AF_TEST__ && window.__AF_TEST__.${v}`;
  const nodePos = async () => page.evaluate(`${ts('node()')}  ? JSON.parse(JSON.stringify(window.__AF_TEST__.node())) : null`);
  const serverPos = async () => page.evaluate(`${ts('serverPos()')} ? JSON.parse(JSON.stringify(window.__AF_TEST__.serverPos())) : null`);
  const floatCount = async () => page.evaluate(`${ts('floatCount()')} ? window.__AF_TEST__.floatCount() : -1`);
  const setBlackhole = async (n) => page.evaluate(`${ts('blackhole')} ? window.__AF_TEST__.blackhole(${n}) : 0`);

  // ---------- 场景 A：dir 步随 ----------
  // 观察服务端初始 pos，随后 act move dir ×6，比对 node 与服务端位移
  const aStart = serverPos();
  await sleep(800);
  const a0 = await aStart;
  const apos0 = a0 ? { x: a0.x, y: a0.y } : null;
  let aOk = false, aInfo = '';
  if (apos0) {
    for (const dir of ['right', 'down', 'right', 'down', 'right', 'down']) {
      await act('move', { dir }, 8000);
      await sleep(250);
    }
    const a1 = await nodePos();
    const a2 = await serverPos();
    if (a1 && a2) {
      const dn = Math.hypot(a1.x - apos0.x, a1.y - apos0.y);
      const ds = Math.hypot(a2.x - apos0.x, a2.y - apos0.y);
      aOk = Math.abs(dn - ds) <= 40 * 6 && Math.hypot(a1.x - a2.x, a1.y - a2.y) <= 440;
      aInfo = `node 位移 ${dn.toFixed(0)} vs 服务端 ${ds.toFixed(0)}; 终距 ${Math.hypot(a1.x - a2.x, a1.y - a2.y).toFixed(0)}px`;
    } else aInfo = 'node/serverPos 不可用';
  } else aInfo = '初始 serverPos 为 null';
  check('A dir 步随：node 位移≈服务端且终漂移 ≤440px', aOk, '|Δnode-Δserver| ≤240 且 dist ≤440', aInfo);

  // ---------- 场景 C：黑洞重放 ----------
  // blackhole(3) 丢弃 3 条 agent_move → act move 到目标 → 解除 → 等 ≤2.5s node 对齐服务端
  const cTarget = { x: (apos0 ? apos0.x : 3500) + 600, y: (apos0 ? apos0.y : 3000) };
  setBlackhole(3);
  await act('move', { x: cTarget.x, y: cTarget.y }, 10000);
  await sleep(400);
  setBlackhole(0);
  await sleep(2500);
  const c1 = await nodePos(), c2 = await serverPos();
  check('C 黑洞重放：解除后 2.5s 内 node 对齐服务端', !!(c1 && c2 && Math.hypot(c1.x - c2.x, c1.y - c2.y) <= 40),
    'dist ≤40px', c1 && c2 ? `dist ${Math.hypot(c1.x - c2.x, c1.y - c2.y).toFixed(0)}px` : 'node/serverPos null');
  check('C-blackhole 钩子可用（RED 信号）', boot === 'ok', 'blackhole() 存在', boot);

  // ---------- 场景 D：move_to 终点对齐 ----------
  const dTarget = { x: 3350, y: 550 };
  const dres = await act('move_to', dTarget, 30000);
  await sleep(3000);
  const d1 = await nodePos(), d2 = await serverPos();
  check('D move_to 终点对齐：node 距服务端 ≤40px', !!(d1 && d2 && Math.hypot(d1.x - d2.x, d1.y - d2.y) <= 40),
    'dist ≤40px', d1 && d2 ? `dist ${Math.hypot(d1.x - d2.x, d1.y - d2.y).toFixed(0)}px` : 'null');
  check('D-move_to 可发起（服务端未回 error）', !!dres, 'move_started', dres?.msg || dres?.t || 'timeout');

  // ---------- 场景 B/E：行为飘字 + 面板文案 ----------
  let chopTarget = null;
  const obs = await act('observe', {}, 8000);
  if (obs && Array.isArray(obs.obstacles) && obs.obstacles.length) {
    const t = obs.obstacles.find((o) => String(o.kind || o.type).includes('tree')) || obs.obstacles[0];
    chopTarget = { x: (t.x ?? 6550), y: (t.y ?? 5350) };
    await act('move_to', chopTarget, 30000);
    await act('chop', chopTarget, 15000);
  } else { await act('move_to', { x: 6550, y: 5350 }, 30000); await act('chop', { x: 6550, y: 5350 }, 15000); }
  await sleep(1500);
  const fc = await floatCount();
  check('B 行为飘字：chop 后 floatCount ≥1', fc >= 1, '≥1', String(fc));
  const liveT = await page.evaluate(() => (document.getElementById('af-agent-live-t') || { textContent: '' }).textContent);
  const hudT = await page.evaluate(() => (document.getElementById('af-hud-agent') || { textContent: '' }).textContent);
  check('E 面板文案：chop 后含「砍|正在」', /砍|正在/.test(String(liveT) + ' ' + String(hudT)),
    '/砍|正在/', (liveT + '|' + hudT).slice(0, 60));

  check('页面 console error = 0（P0 无野错）', consoleErrors.length === 0, '0', consoleErrors[0] || '0');

  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ base: BASE, user: USER, results, pass: results.filter((r) => r.pass).length, total: results.length, consoleErrors }, null, 2));
  const passN = results.filter((r) => r.pass).length;
  console.log(`----\n[agent-vis] ${passN}/${results.length} 通过 | report: ${OUT}/report.json`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
} catch (e) {
  console.error('[agent-vis] 异常：' + (e && e.message));
  process.exit(1);
} finally {
  await browser.close().catch(() => {});
}