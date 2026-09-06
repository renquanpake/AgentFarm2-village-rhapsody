// _dbg-login.mjs —— 打印登录页 DOM
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_dbg' + Date.now().toString(36), args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 8000));
const info = await p.evaluate(() => {
  const els = [...document.querySelectorAll('button, input, [onclick], a')].map(el => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, type: el.type || '', text: (el.innerText || el.value || '').slice(0, 40), cls: (el.className || '').toString().slice(0, 40), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
  });
  return { keys: Object.keys(localStorage), els: els.slice(0, 30) };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
