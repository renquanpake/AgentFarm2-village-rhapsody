// _dbg-tiledmap.mjs —— dump pnlTiledMap 子树（大地图 UI）
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_tm' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 6000));
const out = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const root = null;
  let tm = null;
  scene.walk((n) => { if (!tm && n.name === 'pnlTiledMap') tm = n; });
  if (!tm) return 'no pnlTiledMap';
  const lines = [];
  tm.walk((n, d) => {
    const l = n.getComponent && n.getComponent(cc.Label);
    const sp = n.getComponent && n.getComponent(cc.Sprite);
    const wp = n.parent ? (() => { try { return n.parent.convertToWorldSpaceAR(n.position); } catch (e) { return null; } })() : null;
    lines.push('  '.repeat(d) + n.name + (l && l.string ? ' [' + l.string.slice(0, 14) + ']' : '') + (sp ? ' <sprite>' : '') + (wp && d <= 2 ? ' @' + Math.round(wp.x) + ',' + Math.round(wp.y) : '') + (n.activeInHierarchy ? '' : ' (hidden)'));
  });
  return lines;
});
for (const t of out) console.log(t);
await browser.close();
