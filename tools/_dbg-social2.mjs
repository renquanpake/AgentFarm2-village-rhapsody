// _dbg-social2.mjs —— 完整社交流程：对话→送礼攒好感→绑定→任务
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function newPlayer(tag) {
  const uname = tag + Date.now().toString(36).slice(-6);
  const pwd = 'soc!2026';
  await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
  const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_dbg_p' + tag + Date.now().toString(36) + Math.floor(Math.random() * 1e6), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const logs = [];
  page.on('console', m => { if (m.type() === 'log' || m.type() === 'warn') logs.push(m.text().slice(0, 250)); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', String(uid)); localStorage.setItem('af_nick', 't'); }, { token: login.token, uid: login.uid });
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
    for (let i = 0; i < 8 && !hasWorld; i++) { await new Promise(r => setTimeout(r, 4000)); hasWorld = await hasWorldNow(); }
  }
  return { page, browser, logs, uname, uid: login.uid, hasWorld };
}
const chat = (P, text) => P.page.evaluate((text) => {
  const input = document.getElementById('af-chat-input');
  if (!input) return 'no input';
  input.style.display = 'block';
  input.value = text;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 'ok';
}, text);
const readChat = (P) => P.page.evaluate(() => { const box = document.getElementById('af-chat'); return box ? box.innerText : ''; });

const A = await newPlayer('alice');
const B = await newPlayer('bob');
if (!A.hasWorld || !B.hasWorld) process.exit(1);
await new Promise(r => setTimeout(r, 3000));
for (const P of [A, B]) await P.page.evaluate(() => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(6800, 10000, 0); });
await new Promise(r => setTimeout(r, 2500));

// 1) 对话
await chat(A, '/talk ' + B.uname + ' 你好呀！');
await new Promise(r => setTimeout(r, 1500));
let ca = await readChat(A), cb = await readChat(B);
console.log('1) 对话:', JSON.stringify(cb.slice(-160)), JSON.stringify(ca.slice(-160)));
// 2) 送礼攒好感（A 送金币 50 三次——id=1 金币，初始 200）
for (let i = 0; i < 3; i++) {
  await chat(A, '/give ' + B.uname + ' 1 50');
  await new Promise(r => setTimeout(r, 1500));
}
ca = await readChat(A);
console.log('2) 送礼×3:', JSON.stringify(ca.slice(-400)));
// 3) 查好感
await chat(A, '/fav ' + B.uname);
await new Promise(r => setTimeout(r, 1200));
ca = await readChat(A);
console.log('3) 好感:', JSON.stringify(ca.slice(-160)));
// 4) 绑定好友
await chat(A, '/bind ' + B.uname + ' friend');
await new Promise(r => setTimeout(r, 1500));
ca = await readChat(A); cb = await readChat(B);
console.log('4) 绑定:', JSON.stringify(ca.slice(-160)), '| B侧:', JSON.stringify(cb.slice(-160)));
// 5) 任务列表
await chat(A, '/task');
await new Promise(r => setTimeout(r, 1500));
const tasks = await A.page.evaluate(() => {
  const panel = document.getElementById('af-task-panel');
  const list = document.getElementById('af-task-list');
  return { panelOpen: panel ? panel.style.display : 'none', text: list ? list.innerText.slice(0, 500) : '' };
});
console.log('5) 任务面板:', JSON.stringify(tasks));
// 6) 数据落盘检查
const w = JSON.parse(readFileSync('D:/agent社区/AgentFarm2/data/world.json', 'utf8'));
const sd = w.datas.find(d => d.key === 'socialData');
console.log('6) socialData 落盘:', sd ? JSON.stringify(sd.val).slice(0, 400) : '(无)');
await A.browser.close(); await B.browser.close();
process.exit(0);
