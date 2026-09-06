// _dbg-save-size.mjs —— 在浏览器里复现存档同步，测量真实大小与异常点
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'ss' + Date.now().toString(36).slice(-6);
const pwd = 'ss!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_ss' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
// 在页面里用同步 XHR 复刻 loadWorldFromServer，逐步测大小
const out = await page.evaluate(async ({ token, uid }) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'http://127.0.0.1:8080/af/save?uid=' + encodeURIComponent(uid) + '&token=' + encodeURIComponent(token), false);
  xhr.send();
  const text = xhr.responseText;
  let info = { status: xhr.status, respLen: text.length, respKB: (text.length / 1024).toFixed(0) };
  try {
    const data = JSON.parse(text);
    info.datas = data.datas.length;
    const big = data.datas.map(d => ({ k: d.key, len: JSON.stringify(d.val).length })).sort((a, b) => b.len - a.len).slice(0, 5);
    info.big = big;
    info.totalVal = data.datas.reduce((a, d) => a + JSON.stringify(d.val).length, 0);
    // 模拟逐 key 写入 + villagedb_10000
    let wrote = 0, failed = '';
    try {
      for (const d of data.datas) {
        const ck = d.key.replace(/_\w+$/, '_100001');
        localStorage.setItem(ck, typeof d.val === 'string' ? d.val : JSON.stringify(d.val));
        wrote++;
      }
    } catch (e) { failed = 'per-key: ' + e.name; }
    if (!failed) {
      try { localStorage.setItem('villagedb_10000', JSON.stringify({ version: 4, datas: data.datas })); }
      catch (e) { failed = 'villagedb: ' + e.name + ' used=' + (JSON.stringify(localStorage).length / 1048576).toFixed(1) + 'MB'; }
    }
    info.wrote = wrote; info.failed = failed;
  } catch (e) { info.parseErr = e.message.slice(0, 80); }
  return info;
}, { token: reg.token, uid: reg.uid });
console.log(JSON.stringify(out, null, 1));
await browser.close();
