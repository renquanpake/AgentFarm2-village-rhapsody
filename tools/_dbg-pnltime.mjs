// _dbg-pnltime.mjs —— dump pnlTime 子树
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_pt' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
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
  let pt = null;
  scene.walk((n) => { if (!pt && n.name === 'pnlTime') pt = n; });
  if (!pt) return 'no pnlTime';
  const lines = [];
  pt.walk((n, d) => {
    const l = n.getComponent && n.getComponent(cc.Label);
    lines.push('  '.repeat(d) + n.name + (l ? ' [' + l.string.slice(0, 12) + ']' : '') + (n.activeInHierarchy ? '' : ' (hidden)'));
  });
  return lines;
});
for (const t of out) console.log(t);
await browser.close();
