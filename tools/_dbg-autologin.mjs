// _dbg-autologin.mjs —— 最小化验证浏览器自动登录
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'al' + Date.now().toString(36).slice(-6);
const pwd = 'al!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
console.log('token:', reg.token);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_al' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (/AF|Quota|quota|存档|登录/i.test(m.text())) console.log('CONSOLE:', m.text().slice(0, 250)); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 4000));
console.log('login UI at t+4s:', await page.evaluate(() => !!document.getElementById('af-login')));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
console.log('localStorage after set:', await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('af_')))));
await page.reload({ waitUntil: 'domcontentloaded' });
for (let i = 0; i < 6; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const st = await page.evaluate(() => ({
    loginUI: !!document.getElementById('af-login'),
    err: document.getElementById('af-err')?.textContent || '',
    afToken: (localStorage.getItem('af_token') || '').slice(0, 12),
    world: !!(window.__AF_MODS__?.Application?.exports?.default?.getIns()?.playerNode),
  }));
  console.log('t+' + (i + 1) * 2 + 's', JSON.stringify(st));
}
await browser.close();
