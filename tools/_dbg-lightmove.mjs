// _dbg-lightmove.mjs —— 新账号村庄场景，同一位置两次截图对比光斑
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'lm' + Date.now().toString(36).slice(-6);
const pwd = 'lm!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_lm' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
await page.evaluate(() => {
  const k = Object.keys(localStorage).find(x => x.startsWith('playerData_'));
  if (k) { const v = JSON.parse(localStorage.getItem(k)); v.time = 100; v.timeNode = 0; localStorage.setItem(k, JSON.stringify(v)); }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 14000));
await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 6000));
await page.evaluate(() => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(1200, 2800, 0); });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_lm1.png' });
await new Promise(r => setTimeout(r, 20000));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_lm2.png' });
await browser.close();
console.log('done');
