// _dbg-ux.mjs —— 验证新体验：登录界面服务器地址 / 模型配置面板 / 弹窗自动关闭
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const uname = 'dbg' + Date.now().toString(36).slice(-6);
const pwd = 'dbg!2026';
await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_dbg_p' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', m => { if (m.type() === 'log' || m.type() === 'warn') logs.push(m.text().slice(0, 250)); });
// 1) 未登录时：检查登录界面有服务器地址输入框
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 4000));
const loginUI = await page.evaluate(() => {
  const srv = document.getElementById('af-server');
  return { hasServerInput: !!srv, serverValue: srv ? srv.value : null, hasUser: !!document.getElementById('af-user') };
});
console.log('登录界面:', JSON.stringify(loginUI));
// 2) 登录
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', String(uid)); localStorage.setItem('af_nick', 'dbg'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 10000));
const hasWorldNow = () => page.evaluate(() => { const ins = window.__AF_MODS__?.Application?.exports?.default?.getIns?.(); const n = ins?.playerNode; return !!(n && n.x && n.y); });
let hasWorld = false;
for (let attempt = 0; attempt < 6 && !hasWorld; attempt++) {
  const onMenu = await page.evaluate(() => { const scene = cc.director.getScene(); let f = false; scene.walk((n) => { if (!f && n.activeInHierarchy) { const l = n.getComponent && n.getComponent(cc.Label); if (l && /^开始游戏$/.test(l.string)) f = true; } }); return f; });
  if (onMenu) {
    await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
    await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 5000));
  }
  // 不手动关弹窗 —— 测试 mod 自动关
  for (let i = 0; i < 8 && !hasWorld; i++) { await new Promise(r => setTimeout(r, 4000)); hasWorld = await hasWorldNow(); }
  if (!hasWorld) console.log('attempt', attempt, '仍在等（弹窗应被自动关闭）');
}
console.log('in world:', hasWorld);
if (!hasWorld) { console.log('logs:', logs.slice(-10).join('\n')); await browser.close(); process.exit(1); }
await new Promise(r => setTimeout(r, 3000));
// 3) 模型配置面板：打开 📮
const panel = await page.evaluate(() => {
  const btn = document.getElementById('af-agent-btn');
  if (!btn) return { err: 'no agent btn' };
  btn.click();
  return { opened: true };
});
await new Promise(r => setTimeout(r, 1500));
const modelUI = await page.evaluate(() => {
  const state = document.getElementById('af-agent-model-state');
  const modelBtn = document.getElementById('af-agent-model-btn');
  return { hasModelBtn: !!modelBtn, stateText: state ? state.textContent : null };
});
console.log('模型面板:', JSON.stringify(modelUI));
// 4) 欢迎语检查
const chat = await page.evaluate(() => {
  const box = document.getElementById('af-chat');
  return box ? box.innerText.slice(0, 200) : '(无聊天框)';
});
console.log('欢迎语:', JSON.stringify(chat));
console.log('logs:', logs.filter(l => l.includes('[AF]')).slice(-8).join(' | '));
await browser.close();
