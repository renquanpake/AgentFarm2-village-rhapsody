// _dbg-auth-flow.mjs —— 观察登录表单提交全过程
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'flow' + Date.now().toString(36).slice(-6);
const pwd = 'flow!2026';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_f' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('response', r => { if (/\/af\//.test(r.url())) console.log('RESP', r.status(), r.url().replace(BASE, '')); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 8000));
const hs = await page.$$('input');
let u = null, p = null;
for (const h of hs) { const t = await h.evaluate(el => el.type); if (t === 'text') u = h; if (t === 'password') p = h; }
console.log('found inputs:', !!u, !!p);
await u.type(uname);
await p.type(pwd);
const filled = await page.evaluate(() => [...document.querySelectorAll('input')].map(i => i.type + '=' + i.value));
console.log('filled:', JSON.stringify(filled));
const btn = await page.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(b => /登录|注册/.test(b.innerText || ''));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
await page.mouse.click(btn.x, btn.y);
for (let i = 0; i < 8; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const st = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 150).replace(/\n/g, ' '), inputs: [...document.querySelectorAll('input')].map(i => i.type + '=' + i.value) }));
  console.log('t+' + (i + 1) * 3 + 's', JSON.stringify(st));
}
await browser.close();
