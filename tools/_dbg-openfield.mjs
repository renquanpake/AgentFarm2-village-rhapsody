// _dbg-openfield.mjs —— 空旷草地截图，判断亮线是否与房子相关
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_of' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 6000));
await page.evaluate(() => {
  const ins = window.__AF_MODS__.Application.exports.default.getIns();
  ins.playerNode.setPosition(3000, 3000, 0);
});
await new Promise(r => setTimeout(r, 2500));
const pos = await page.evaluate(() => {
  const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode;
  return { x: Math.round(n.x), y: Math.round(n.y) };
});
console.log('player:', JSON.stringify(pos));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_openfield.png' });
await browser.close();
