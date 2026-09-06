// _shot-orig.mjs —— 纯原版地图截图（白天）：村中心 / 石板广场
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const uname = 'origs' + Date.now().toString(36).slice(-6);
const pwd = 'orig!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
if (!reg.ok) throw new Error('register: ' + JSON.stringify(reg));
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_o' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('pageerror', e => logs.push(e.message.slice(0, 150)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', String(uid)); localStorage.setItem('af_nick', 'orig'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 10000));
const timeSet = await page.evaluate(() => {
  const k = Object.keys(localStorage).find(x => x.startsWith('playerData_'));
  if (!k) return null;
  const v = JSON.parse(localStorage.getItem(k));
  v.time = 100; v.timeNode = 0;
  localStorage.setItem(k, JSON.stringify(v));
  return k;
});
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 10000));
await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 3500));
await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 10000));
const hasWorld = await page.evaluate(() => !!(window.__AF_MODS__?.Application?.exports?.default?.getIns()?.playerNode));
console.log('in world:', hasWorld, 'timeKey:', timeSet);
if (!hasWorld) { console.log('logs:', logs.slice(-8).join(' | ')); await browser.close(); process.exit(1); }
for (const [name, x, y] of [['orig_center', 3850, 3050], ['orig_plaza', 4000, 5200], ['orig_houses', 2500, 500]]) {
  await page.evaluate(({ x, y }) => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(x, y, 0); }, { x, y });
  await new Promise(r => setTimeout(r, 1800));
  await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_v3_' + name + '.jpg', type: 'jpeg', quality: 82 });
  console.log('shot', name);
}
console.log('logs:', logs.slice(-5).join(' | ') || 'clean');
await browser.close();
