// _dbg-quota.mjs —— 验证 localStorage 配额是否导致登录失败
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'q' + Date.now().toString(36).slice(-6);
const pwd = 'q!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_q' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (/AF|quota|Quota/i.test(m.text())) console.log('CONSOLE:', m.text().slice(0, 200)); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 6000));
const st = await page.evaluate(() => {
  let used = 0, keys = 0;
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); used += (k + localStorage.getItem(k)).length * 2; keys++; }
  let quotaTest = '';
  try { localStorage.setItem('_qtest', 'x'.repeat(2 * 1024 * 1024)); quotaTest = 'set 2MB ok'; localStorage.removeItem('_qtest'); }
  catch (e) { quotaTest = e.name + ': ' + e.message.slice(0, 60); }
  return { loginUI: !!document.getElementById('af-login'), err: document.getElementById('af-err')?.textContent || '', keys, usedMB: (used / 1048576).toFixed(1), quotaTest };
});
console.log(JSON.stringify(st, null, 1));
await browser.close();
