// 登录流程验证：登录框 → 注册 → 游戏启动
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(4000);

// 1. 登录框出现？
const loginShown = await page.evaluate(() => !!document.getElementById('af-login'));
console.log('登录框出现:', loginShown);

if (loginShown) {
  // 2. 输入账号密码（随机账号避免冲突）
  const uname = 'user' + Date.now().toString(36).slice(-6);
  await page.type('#af-user', uname);
  await page.type('#af-pass', 'pass1234');
  await page.click('#af-login-btn');
  console.log('提交注册:', uname);
  await wait(8000); // 等注册 + 拉存档 + boot
}

// 3. 检查状态
const state = await page.evaluate(() => ({
  loginGone: !document.getElementById('af-login'),
  afUid: window.__AF__ ? window.__AF__.uid : null,
  hasToken: !!localStorage.getItem('af_token'),
  keys: (() => { const k = []; for (let i = 0; i < localStorage.length; i++) k.push(localStorage.key(i)); return k.filter(x => !x.startsWith('af_')); })(),
}));
console.log('状态:', JSON.stringify(state));

// 4. 进游戏流程
await page.mouse.click(640, 416); await wait(5000);
await page.mouse.click(640, 224); await wait(12000);
const world = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  if (!m || !m.Application) return { inWorld: false };
  const node = m.Application.exports.default.getIns().playerNode;
  return { inWorld: true, pos: { x: Math.round(node.x), y: Math.round(node.y) } };
});
console.log('进世界:', JSON.stringify(world));
await page.screenshot({ path: 'D:\\agent社区\\AgentFarm2\\_login_world.png' });
console.log('--- logs tail ---');
logs.slice(-25).forEach(l => console.log(l));
await browser.close();
