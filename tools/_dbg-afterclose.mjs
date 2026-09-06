// _dbg-afterclose.mjs —— 关闭图鉴弹窗后的画面状态
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'ac' + Date.now().toString(36).slice(-6);
const pwd = 'ac!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_ac' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
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
  if (hit) { const wp = hit.parent.convertToWorldSpaceAR(hit.position); window.__AF_CLICK__ = { x: Math.round(wp.x * 0.75), y: Math.round(900 - wp.y * 0.75) }; }
});
const c = await page.evaluate(() => window.__AF_CLICK__);
await page.mouse.click(c.x, c.y);
await new Promise(r => setTimeout(r, 6000));
// 关闭弹窗
await page.evaluate(() => {
  const scene = cc.director.getScene();
  let hit = null;
  scene.walk((n) => { if (!hit && n.activeInHierarchy) { const b = n.getComponent && n.getComponent(cc.Button); if (b && /^btnClose$/i.test(n.name)) hit = n; } });
  if (hit) { const btnC = hit.getComponent(cc.Button); try { cc.Component.EventHandler.emitEvents(btnC.clickEvents, hit); } catch (e) {} }
});
console.log('popup closed');
await new Promise(r => setTimeout(r, 4000));
// 再点一次开始游戏（第一次点击被图鉴弹窗消费）
const c2 = await page.evaluate(() => {
  const scene = cc.director.getScene();
  let hit = null;
  scene.walk((n) => { if (!hit && n.activeInHierarchy) { const l = n.getComponent && n.getComponent(cc.Label); if (l && /开始游戏/.test(l.string)) hit = n; } });
  if (!hit) return null;
  const wp = hit.parent.convertToWorldSpaceAR(hit.position);
  return { x: Math.round(wp.x * 0.75), y: Math.round(900 - wp.y * 0.75) };
});
if (c2) { await page.mouse.click(c2.x, c2.y); console.log('start clicked again'); }
await new Promise(r => setTimeout(r, 8000));
// 若有弹窗再关
await page.evaluate(() => {
  const scene = cc.director.getScene();
  let hit = null;
  scene.walk((n) => { if (!hit && n.activeInHierarchy) { const b = n.getComponent && n.getComponent(cc.Button); if (b && /^btnClose$/i.test(n.name)) hit = n; } });
  if (hit) { try { cc.Component.EventHandler.emitEvents(hit.getComponent(cc.Button).clickEvents, hit); } catch (e) {} }
});
await new Promise(r => setTimeout(r, 6000));
// 状态 + 截图
const st = await page.evaluate(() => {
  const scene = cc.director.getScene();
  let start = false, close = false, next = false;
  scene.walk((n) => {
    if (!n.activeInHierarchy) return;
    const b = n.getComponent && n.getComponent(cc.Button);
    const l = n.getComponent && n.getComponent(cc.Label);
    if (b && /^btnClose$/i.test(n.name)) close = true;
    if (b && /^btnNext$/i.test(n.name)) next = true;
    if (l && /开始游戏/.test(l.string)) start = true;
  });
  const app = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
  const pn = app && app.playerNode;
  return { start, close, next, player: pn ? { x: Math.round(pn.x), y: Math.round(pn.y) } : null };
});
console.log('state:', JSON.stringify(st));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_afterclose.png' });
await browser.close();
