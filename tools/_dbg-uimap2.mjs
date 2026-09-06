// _dbg-uimap2.mjs —— 进游戏找小地图节点 + 检查重绘日志
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_u2' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', m => { const t = m.text(); if (/AF|map|Map|error/i.test(t)) logs.push(t.slice(0, 160)); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 6000));
await page.evaluate(() => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(1200, 2800, 0); });
await new Promise(r => setTimeout(r, 2000));
// 找 UiMap 相关节点（含 inactive）
const out = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const found = [];
  scene.walk((n, d) => {
    const nm = n.name || '';
    if (/Map|map/.test(nm)) {
      found.push({ d, n: nm, active: n.activeInHierarchy, children: n.children ? n.children.length : 0 });
    }
  });
  return found.slice(0, 40);
});
console.log('Map 节点:', JSON.stringify(out, null, 1));
console.log('--- logs ---');
for (const l of logs.slice(-12)) console.log(l);
await browser.close();
