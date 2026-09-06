// _dbg-req404.mjs —— 抓点开始后所有非 200 请求
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_rq' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const bad = [];
page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(BASE.length)); });
page.on('requestfailed', r => bad.push('FAIL ' + r.url().slice(BASE.length)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
const clickLabel = async (pat) => {
  const c = await page.evaluate((pat) => {
    const re = new RegExp(pat);
    const scene = cc.director.getScene();
    let hit = null;
    scene.walk((n) => { if (!hit && n.activeInHierarchy) { const l = n.getComponent && n.getComponent(cc.Label); if (l && re.test(l.string)) hit = n; } });
    if (!hit) return null;
    const wp = hit.parent.convertToWorldSpaceAR(hit.position);
    return { x: Math.round(wp.x * 0.75), y: Math.round(900 - wp.y * 0.75) };
  }, pat);
  if (c) { await page.mouse.click(c.x, c.y); return true; }
  return false;
};
const emitBtn = async (pat) => {
  return page.evaluate((pat) => {
    const re = new RegExp(pat);
    const scene = cc.director.getScene();
    let hit = null;
    scene.walk((n) => { if (!hit && n.activeInHierarchy) { const b = n.getComponent && n.getComponent(cc.Button); if (b && re.test(n.name)) hit = n; } });
    if (!hit) return false;
    try { cc.Component.EventHandler.emitEvents(hit.getComponent(cc.Button).clickEvents, hit); return true; } catch (e) { return false; }
  }, pat);
};
await clickLabel('^开始游戏$');
await new Promise(r => setTimeout(r, 5000));
await emitBtn('^btnNext$');
await new Promise(r => setTimeout(r, 25000));
console.log('--- non-200 requests ---');
for (const b of bad.slice(-40)) console.log(b);
console.log('total bad:', bad.length);
await browser.close();
