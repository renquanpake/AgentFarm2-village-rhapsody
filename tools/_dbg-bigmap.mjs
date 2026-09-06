// _dbg-bigmap.mjs —— 点 btnMap 打开大地图，dump 结构
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_bm' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 6000));
// 点 btnMap
await page.evaluate(() => {
  const scene = cc.director.getScene();
  let hit = null;
  scene.walk((n) => { if (!hit && n.activeInHierarchy && n.name === 'btnMap') hit = n; });
  if (hit) {
    const wp = hit.parent.convertToWorldSpaceAR(hit.position);
    window.__AF_MAPBTN__ = { x: Math.round(wp.x * 0.75), y: Math.round(900 - wp.y * 0.75) };
  }
});
const b = await page.evaluate(() => window.__AF_MAPBTN__);
if (b) { await page.mouse.click(b.x, b.y); console.log('clicked btnMap at', JSON.stringify(b)); }
await new Promise(r => setTimeout(r, 5000));
const out = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const tree = [];
  scene.walk((n, d) => {
    if (d <= 4 && n.activeInHierarchy) {
      const l = n.getComponent && n.getComponent(cc.Label);
      const sp = n.getComponent && n.getComponent(cc.Sprite);
      tree.push('  '.repeat(d) + n.name + (l ? ' [' + l.string.slice(0, 10) + ']' : '') + (sp ? ' <sprite>' : ''));
    }
  });
  return tree.slice(0, 70);
});
for (const t of out) console.log(t);
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_bigmap.png' });
await browser.close();
