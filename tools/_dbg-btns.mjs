// _dbg-btns.mjs —— dump 开始游戏/图鉴按钮的回调链
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_bt' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
const dump = () => page.evaluate(() => {
  const scene = cc.director.getScene();
  const out = [];
  scene.walk((n) => {
    if (!n.activeInHierarchy) return;
    const b = n.getComponent && n.getComponent(cc.Button);
    if (!b) return;
    let chain = [];
    let p = n;
    while (p && chain.length < 6) { chain.push(p.name); p = p.parent; }
    out.push({
      name: n.name,
      chain: chain.join('/'),
      handlers: (b.clickEvents || []).map(ev => (ev.target ? ev.target.name : '?') + '.' + (ev.component || '?') + '#' + (ev.handler || '?')),
    });
  });
  return out;
});
console.log('=== 主菜单按钮 ===');
for (const b of await dump()) console.log(JSON.stringify(b));
// 点开始游戏
await page.evaluate(() => {
  const scene = cc.director.getScene();
  let hit = null;
  scene.walk((n) => { if (!hit && n.activeInHierarchy) { const l = n.getComponent && n.getComponent(cc.Label); if (l && /^开始游戏$/.test(l.string)) hit = n; } });
  if (hit) { const wp = hit.parent.convertToWorldSpaceAR(hit.position); window.__AF_CLICK__ = { x: Math.round(wp.x * 0.75), y: Math.round(900 - wp.y * 0.75) }; }
});
const c = await page.evaluate(() => window.__AF_CLICK__);
if (c) await page.mouse.click(c.x, c.y);
await new Promise(r => setTimeout(r, 6000));
console.log('=== 图鉴弹窗按钮 ===');
for (const b of await dump()) console.log(JSON.stringify(b));
await browser.close();
