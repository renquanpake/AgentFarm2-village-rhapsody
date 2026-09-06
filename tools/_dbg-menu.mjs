// _dbg-menu.mjs —— 登录后 dump 主菜单场景树
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'mn' + Date.now().toString(36).slice(-6);
const pwd = 'mn!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_mn' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 15000));
const tree = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const out = [];
  scene.walk((n, depth) => {
    const c = n.getComponent ? n.getComponentsInChildren ? null : null : null;
    const label = n.getComponent && n.getComponent(cc.Label) ? n.getComponent(cc.Label).string : '';
    const btn = n.getComponent && n.getComponent(cc.Button) ? 'BTN' : '';
    const pos = n.position ? { x: Math.round(n.position.x), y: Math.round(n.position.y) } : null;
    const size = n.getContentSize ? n.getContentSize() : null;
    out.push({ d: depth, n: n.name, l: label.slice(0, 20), btn, pos, s: size ? { w: Math.round(size.width), h: Math.round(size.height) } : null });
  });
  return out.slice(0, 120);
});
for (const t of tree) console.log('  '.repeat(t.d) + t.n + (t.l ? ' [' + t.l + ']' : '') + (t.btn ? ' <<BTN' : '') + (t.pos ? ' @' + JSON.stringify(t.pos) : '') + (t.s ? ' ' + JSON.stringify(t.s) : ''));
await browser.close();
