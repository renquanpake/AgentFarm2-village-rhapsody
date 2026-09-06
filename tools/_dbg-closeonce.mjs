// _dbg-closeonce.mjs —— 点一次 btnClose 后看状态
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'cl' + Date.now().toString(36).slice(-6);
const pwd = 'cl!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_cl' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
// 点开始游戏
await page.evaluate(() => {
  const scene = cc.director.getScene();
  let hit = null;
  scene.walk((n) => { if (!hit && n.activeInHierarchy) { const l = n.getComponent && n.getComponent(cc.Label); if (l && /开始游戏/.test(l.string)) hit = n; } });
  if (hit) { const wp = hit.parent.convertToWorldSpaceAR(hit.position); const x = Math.round(wp.x * 0.75), y = Math.round(900 - wp.y * 0.75); window.__AF_CLICK__ = { x, y }; }
});
const c = await page.evaluate(() => window.__AF_CLICK__);
if (c) { await page.mouse.click(c.x, c.y); console.log('start clicked'); }
await new Promise(r => setTimeout(r, 7000));
// 点 btnClose（场景坐标直接传给页面用 Cocos 事件？不——先 mouse 点击）
const cb = await page.evaluate(() => {
  const scene = cc.director.getScene();
  let hit = null;
  scene.walk((n) => { if (!hit && n.activeInHierarchy) { const b = n.getComponent && n.getComponent(cc.Button); if (b && /^btnClose$/i.test(n.name)) hit = n; } });
  if (!hit) return null;
  const wp = hit.parent.convertToWorldSpaceAR(hit.position);
  return { x: Math.round(wp.x * 0.75), y: Math.round(900 - wp.y * 0.75), parent: hit.parent.name, size: hit.getContentSize ? { w: Math.round(hit.getContentSize().width), h: Math.round(hit.getContentSize().height) } : null };
});
console.log('btnClose:', JSON.stringify(cb));
if (cb) {
  // 直接用 Cocos EventHandler 触发按钮回调（绕开坐标/触摸问题）
  const emitted = await page.evaluate(() => {
    const scene = cc.director.getScene();
    let hit = null;
    scene.walk((n) => { if (!hit && n.activeInHierarchy) { const b = n.getComponent && n.getComponent(cc.Button); if (b && /^btnClose$/i.test(n.name)) hit = n; } });
    if (!hit) return 'no-btn';
    const btnC = hit.getComponent(cc.Button);
    try {
      cc.Component.EventHandler.emitEvents(btnC.clickEvents, hit);
      return 'emitted ' + btnC.clickEvents.length + ' handlers';
    } catch (e) { return 'err: ' + e.message.slice(0, 120); }
  });
  console.log('emit result:', emitted);
}
await new Promise(r => setTimeout(r, 3000));
const after = await page.evaluate(() => {
  const scene = cc.director.getScene();
  let closeStill = false, startStill = false, ins = null;
  scene.walk((n) => {
    if (!n.activeInHierarchy) return;
    const b = n.getComponent && n.getComponent(cc.Button);
    const l = n.getComponent && n.getComponent(cc.Label);
    if (b && /^btnClose$/i.test(n.name)) closeStill = true;
    if (l && /开始游戏/.test(l.string)) startStill = true;
  });
  const app = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
  const pn = app && app.playerNode;
  return { closeStill, startStill, player: pn ? { x: Math.round(pn.x), y: Math.round(pn.y) } : null };
});
console.log('after:', JSON.stringify(after));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_close1.png' });
await browser.close();
