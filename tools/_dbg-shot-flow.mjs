// _dbg-shot-flow.mjs —— 复现 _shot-beauty 的启动流程，观察表单何时出现
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'dbg' + Date.now().toString(36).slice(-6);
const pwd = 'dbg!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
console.log('register:', reg.ok);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_dbg2' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 150)));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 150)); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const st = await page.evaluate(() => ({
    inputs: document.querySelectorAll('input').length,
    text: document.body.innerText.slice(0, 80).replace(/\n/g, ' '),
    url: location.href,
  }));
  console.log('t+', (i + 1) * 2 + 's', JSON.stringify(st));
}
await browser.close();
