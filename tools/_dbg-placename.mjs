// _dbg-placename.mjs —— 找左上角地名 Label 和它的更新逻辑
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_pn2' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
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
  const labels = [];
  scene.walk((n) => {
    if (!n.activeInHierarchy) return;
    const l = n.getComponent && n.getComponent(cc.Label);
    if (l && l.string) {
      const wp = n.parent ? n.parent.convertToWorldSpaceAR(n.position) : null;
      labels.push({ n: n.name, s: l.string.slice(0, 12), p: n.parent ? n.parent.name : '', wp: wp ? { x: Math.round(wp.x), y: Math.round(wp.y) } : null });
    }
  });
  return labels.filter(x => /河边|村庄|田野|区域|位置/.test(x.s) || (x.wp && x.wp.y > 700)).slice(0, 25);
});
for (const l of out) console.log(JSON.stringify(l));
await browser.close();
