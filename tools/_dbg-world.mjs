// _dbg-world.mjs —— 登录后观察游戏场景加载状态
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'wd' + Date.now().toString(36).slice(-6);
const pwd = 'wd!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_wd' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (/AF|error|Error/i.test(m.text())) console.log('CONSOLE:', m.text().slice(0, 160)); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
for (let i = 0; i < 12; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const st = await page.evaluate(() => {
    const mods = window.__AF_MODS__ || {};
    const app = mods.Application?.exports?.default;
    const ins = app?.getIns ? app.getIns() : null;
    const scene = window.cc?.director?.getScene?.();
    return {
      loginUI: !!document.getElementById('af-login'),
      mods: Object.keys(mods).length,
      ins: !!ins,
      playerNode: !!ins?.playerNode,
      scene: scene ? scene.name : null,
      sceneKids: scene ? scene.children.length : 0,
      canvas: !!document.querySelector('canvas'),
    };
  });
  console.log(JSON.stringify(st));
  if (st.playerNode) break;
}
await browser.close();
