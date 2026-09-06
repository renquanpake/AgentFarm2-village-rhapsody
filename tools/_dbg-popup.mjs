// _dbg-popup.mjs —— 点开始后 dump 弹窗的按钮位置
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'pp' + Date.now().toString(36).slice(-6);
const pwd = 'pp!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_pp' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
const btn = await page.evaluate(() => {
  const scene = cc.director.getScene();
  let hit = null;
  scene.walk((n) => {
    if (hit || !n.activeInHierarchy) return;
    const label = n.getComponent && n.getComponent(cc.Label);
    if (label && /开始游戏/.test(label.string)) hit = n;
  });
  if (!hit) return null;
  const wp = hit.parent ? hit.parent.convertToWorldSpaceAR(hit.position) : hit.position;
  return { x: Math.round(wp.x * 0.75), y: Math.round(900 - wp.y * 0.75) };
});
if (btn) await page.mouse.click(btn.x, btn.y);
await new Promise(r => setTimeout(r, 8000));
const out = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const els = [];
  scene.walk((n) => {
    if (!n.activeInHierarchy) return;
    const btnC = n.getComponent && n.getComponent(cc.Button);
    const label = n.getComponent && n.getComponent(cc.Label);
    const sp = n.getComponent && n.getComponent(cc.Sprite);
    if (btnC || label) {
      let wp = null;
      try { wp = n.parent ? n.parent.convertToWorldSpaceAR(n.position) : null; } catch (e) {}
      els.push({
        n: n.name,
        l: label ? label.string.slice(0, 14) : '',
        b: !!btnC,
        wp: wp ? { x: Math.round(wp.x), y: Math.round(wp.y) } : null,
      });
    }
  });
  return els.slice(0, 80);
});
for (const e of out) console.log(e.n + (e.l ? ' [' + e.l + ']' : '') + (e.b ? ' <BTN>' : '') + (e.wp ? ' @' + JSON.stringify(e.wp) : ''));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_popup.png' });
await browser.close();
