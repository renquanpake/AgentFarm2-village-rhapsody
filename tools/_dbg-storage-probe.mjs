// _dbg-storage-probe.mjs —— 页面加载后各阶段 localStorage 占用
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'sp' + Date.now().toString(36).slice(-6);
const pwd = 'sp!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_sp' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (/AF|Quota|quota|存档/.test(m.text())) console.log('CONSOLE:', m.text().slice(0, 200)); });
const usage = () => page.evaluate(() => {
  let used = 0, keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = localStorage.getItem(k) || '';
    used += (k.length + v.length) * 2;
    if (v.length > 50000) keys.push(k + '=' + (v.length / 1048576).toFixed(1) + 'MB');
  }
  return { n: localStorage.length, usedMB: (used / 1048576).toFixed(1), big: keys.slice(0, 8) };
});
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 5000));
console.log('t+5s (login UI):', JSON.stringify(await usage()));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
console.log('t+3s after reload:', JSON.stringify(await usage()));
await new Promise(r => setTimeout(r, 5000));
console.log('t+8s after reload:', JSON.stringify(await usage()));
await browser.close();
