// _dbg-visibles.mjs —— 可见节点 + 截图
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'vs' + Date.now().toString(36).slice(-6);
const pwd = 'vs!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_vs' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 20000));
const out = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const vis = [];
  scene.walk((n) => {
    if (!n.activeInHierarchy) return;
    const label = n.getComponent && n.getComponent(cc.Label);
    const btn = n.getComponent && n.getComponent(cc.Button);
    if (label || btn) {
      const wp = n.parent ? n.parent.convertToWorldSpaceAR(n.position) : null;
      vis.push({ n: n.name, l: label ? label.string.slice(0, 24) : '', b: !!btn, wp: wp ? { x: Math.round(wp.x), y: Math.round(wp.y) } : null });
    }
  });
  return vis.slice(0, 60);
});
console.log(JSON.stringify(out, null, 1));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_now.png' });
console.log('screenshot saved');
await browser.close();
