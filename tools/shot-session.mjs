// tools/shot-session.mjs —— 视觉验收会话：一条命令跑完「登录 → 进村 → 指挥面板 → 他做了什么」
//
// 解决 shot-client.mjs 的两个短板：
//   1) 身份注入靠页面加载后再写 localStorage + reload —— 截图会撞上导航（Protocol error）。
//      本工具用 evaluateOnNewDocument 在页面脚本执行前注入身份，无需 reload。
//   2) 只能截一张图 —— 验收需要一条时间线上的多张（登录/村景/聊天/指挥面板/流水面板）。
//
// 用法：
//   node tools/shot-session.mjs --base http://127.0.0.1:8197 --out-dir /tmp/shots/run1 \
//        --user visual --pass visual_pw_1 [--wait 8000] [--only village,panel]
// 输出：每步一张 PNG + run-report.json（含每步的控制台错误、页面内可见文本要点）
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.AF_CHROME
  || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const base = arg('base', 'http://127.0.0.1:8097').replace(/\/$/, '');
const outDir = resolve(arg('out-dir', '/tmp/shots/session'));
const user = arg('user', 'visual');
const pass = arg('pass', 'visual_pw_1');
const waitMs = Number(arg('wait', 8000));
const W = Number(arg('w', 1440)), H = Number(arg('h', 900));
const only = String(arg('only', '')).split(',').filter(Boolean);

mkdirSync(outDir, { recursive: true });

// 1) 先通过 HTTP 备号（拿到 token/uid），注入 localStorage 免登录直达游戏
const j = async (p, b) => {
  const r = await fetch(base + p, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {});
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { ok: false, raw: t.slice(0, 120) }; }
};
let acc = await j('/af/register', { username: user, password: pass });
if (!acc.token) acc = await j('/af/login', { username: user, password: pass });
if (!acc.token) { console.error('[shot-session] 备号失败（注册/登录都失败）'); process.exit(1); }
const ag = await j('/af/agent-token', { token: acc.token });
writeFileSync(resolve(outDir, 'cred.json'), JSON.stringify({ uid: acc.uid, token: acc.token, agentToken: ag.agentToken, nick: user }, null, 1));
console.log(`[shot-session] 账号 ${user} uid=${acc.uid}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--window-size=${W},${H}`],
});
const report = { base, user, steps: [], consoleErrors: [] };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  // 必须关缓存：浏览器会把 mod/agentfarm.js 缓存住，改了代码重截还是旧界面（踩过一次）
  await page.setCacheEnabled(false);
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(String(m.text()).slice(0, 200)); });
  page.on('pageerror', (e) => report.consoleErrors.push('pageerror: ' + String(e.message).slice(0, 200)));

  // 身份在页面脚本执行前注入（无需 reload，也不会撞截图）
  // 注意：登录界面那张图必须用「另一个 page」去拍 —— 同一 page 上再注册一个
  // 去掉 token 的注入会覆盖掉带身份的注入（踩过一次：六张图全拍成登录页）。
  await page.evaluateOnNewDocument((c) => {
    try {
      localStorage.setItem('af_token', c.token);
      localStorage.setItem('af_uid', c.uid);
      localStorage.setItem('af_nick', c.nick);
    } catch (e) { /* ignore */ }
  }, { token: acc.token, uid: acc.uid, nick: user });

  const shot = async (name, note) => {
    const file = resolve(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    const txt = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('#af-chat .af-line, #af-agent, #af-npc-ticker, #af-status, .box')]
        .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12);
      return { visibleText: vis, hasCanvas: !!document.querySelector('canvas'), title: document.title };
    }).catch(() => ({ visibleText: [], hasCanvas: false }));
    report.steps.push({ name, file, note, ...txt });
    console.log(`[shot-session] ${name}: ${file}（canvas=${txt.hasCanvas}，可见文本 ${txt.visibleText.length} 段）`);
    return txt;
  };

  const want = (n) => !only.length || only.includes(n);

  // 0) 登录界面：独立 page + 独立 context（无痕，不带身份）
  if (want('login')) {
    const anonCtx = await browser.createBrowserContext();
    const anon = await anonCtx.newPage();
    await anon.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await anon.setCacheEnabled(false);
    await anon.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => console.log('goto-login:', e.message));
    await new Promise(r => setTimeout(r, 4500));
    const file = resolve(outDir, '01-login.png');
    await anon.screenshot({ path: file });
    const t = await anon.evaluate(() => ({ visibleText: [...document.querySelectorAll('.box, #af-login')].map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6), hasCanvas: !!document.querySelector('canvas') }));
    report.steps.push({ name: '01-login', file, note: '登录界面（无痕 context）', ...t });
    console.log(`[shot-session] 01-login: ${file}（canvas=${t.hasCanvas}）`);
    await anonCtx.close();
  }

  // 1) 带身份重进（这次身份在文档脚本前注入，直接进游戏）
  await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => console.log('goto2:', e.message));
  await new Promise(r => setTimeout(r, waitMs));
  if (want('village')) await shot('02-village', '进村后主画面');

  // 1.5) 关掉可能挡住后续点击的弹层（首次进入的「连接你的 Agent」引导 / 模型设置 / 登录框）
  const dismissed = await page.evaluate(() => {
    const texts = ['稍后再说', '✕', '关闭', '返回'];
    let hit = [];
    for (const t of texts) {
      const el = [...document.querySelectorAll('button, .x, [data-act="back"]')].find(e => (e.innerText || '').trim() === t && e.offsetParent !== null);
      if (el) { el.click(); hit.push(t); break; }
    }
    return hit;
  });
  if (dismissed.length) { console.log('[shot-session] 已关弹层:', dismissed.join(',')); await new Promise(r => setTimeout(r, 1200)); }

  // 1.6) 可选：点「启动托管」让 Agent 真的上线（后面才有流水/回话可看）
  if (argv.includes('--start-agent')) {
    const started = await page.evaluate(async () => {
      const panel = document.getElementById('af-agent');
      if (panel && panel.style.display === 'none') { const b = document.getElementById('af-agent-btn'); if (b) b.click(); }
      await new Promise(r => setTimeout(r, 600));
      const b = document.getElementById('af-agent-toggle');
      if (!b || !/启动/.test(b.textContent || '')) return 'already-on';
      b.click();
      return 'clicked';
    });
    console.log('[shot-session] 启动托管:', started);
    await new Promise(r => setTimeout(r, Number(arg('agent-wait', 45000))));
    await page.evaluate(() => { const x = document.getElementById('af-agent-x'); if (x) x.click(); });
    await new Promise(r => setTimeout(r, 800));
  }

  // 2) 打开聊天框
  if (want('chat')) {
    await page.evaluate(() => { const b = document.getElementById('af-chat-btn'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 1200));
    await shot('03-chat', '聊天框');
  }

  // 3) 打开指挥面板（玩家↔Agent 对话入口）
  if (want('panel')) {
    await page.evaluate(() => { const b = document.getElementById('af-agent-btn'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 1500));
    await shot('04-agent-panel', '指挥我的 Agent 面板');
  }

  // 4) 点「他做了什么」读行为流水
  if (want('recap')) {
    const r = await page.evaluate(async () => {
      if (window.__AF_LOAD_RECAP__) { await window.__AF_LOAD_RECAP__(); return { called: true }; }
      const b = document.getElementById('af-agent-recap-btn');
      if (b) { b.click(); return { clicked: true }; }
      return { none: true };
    });
    await new Promise(r2 => setTimeout(r2, 2500));
    const st = await shot('05-recap', `「他做了什么」行为流水（${JSON.stringify(r)}）`);
    console.log('[shot-session] 流水面板可见文本:', JSON.stringify(st.visibleText).slice(0, 400));
  }

  // 5) 玩家发一句问话，看回执
  if (want('ask')) {
    const r = await page.evaluate(async (text) => {
      const input = document.getElementById('af-agent-input');
      const btn = document.getElementById('af-agent-send');
      if (!input || !btn) return { none: true };
      input.value = text;
      btn.click();
      return { sent: text };
    }, '你刚才干了什么？');
    await new Promise(r2 => setTimeout(r2, 2500));
    await shot('06-ask-ack', `发问回执（${JSON.stringify(r)}）`);
  }

  report.consoleErrors = [...new Set(report.consoleErrors)].slice(0, 20);
  writeFileSync(resolve(outDir, 'run-report.json'), JSON.stringify(report, null, 1));
  console.log(`\n[shot-session] 完成：${report.steps.length} 张截图 -> ${outDir}`);
  console.log(`[shot-session] 控制台错误 ${report.consoleErrors.length} 条${report.consoleErrors.length ? '：' + report.consoleErrors.slice(0, 5).join(' | ') : ''}`);
} finally {
  await browser.close();
}
if (!existsSync(resolve(outDir, 'run-report.json'))) process.exit(1);