// _dbg-dayhome2.mjs —— 诊断 installDayHomeBlock 为何没生效
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const uname = 'dbg' + Date.now().toString(36).slice(-6);
const pwd = 'dbg!2026';
await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_dbg_p' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', m => { if (m.type() === 'log' || m.type() === 'warn') logs.push(m.text().slice(0, 200)); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', String(uid)); localStorage.setItem('af_nick', 'dbg'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 10000));
const hasWorldNow = () => page.evaluate(() => { const ins = window.__AF_MODS__?.Application?.exports?.default?.getIns?.(); const n = ins?.playerNode; return !!(n && n.x && n.y); });
let hasWorld = false;
for (let attempt = 0; attempt < 6 && !hasWorld; attempt++) {
  const onMenu = await page.evaluate(() => { const scene = cc.director.getScene(); let f = false; scene.walk((n) => { if (!f && n.activeInHierarchy) { const l = n.getComponent && n.getComponent(cc.Label); if (l && /^开始游戏$/.test(l.string)) f = true; } }); return f; });
  if (onMenu) {
    await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
    await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 5000));
  }
  const closed = await page.evaluate(() => { const scene = cc.director.getScene(); let hit = null; scene.walk((n) => { if (hit || !n.activeInHierarchy) return; const btnC = n.getComponent && n.getComponent(cc.Button); if (btnC && /^btnClose$/i.test(n.name)) hit = n; }); if (!hit) return false; try { cc.Component.EventHandler.emitEvents(hit.getComponent(cc.Button).clickEvents, hit); return true; } catch (e) { return false; } });
  if (closed) await new Promise(r => setTimeout(r, 4000));
  for (let i = 0; i < 6 && !hasWorld; i++) { await new Promise(r => setTimeout(r, 4000)); hasWorld = await hasWorldNow(); }
}
console.log('in world:', hasWorld);
if (!hasWorld) { await browser.close(); process.exit(1); }
await new Promise(r => setTimeout(r, 3000));
const dbg = await page.evaluate(() => {
  const mods = window.__AF_MODS__;
  const out = { modNames: Object.keys(mods || {}).filter(k => /Game|Applic|Player|Scene|Role/.test(k)).slice(0, 30) };
  const GD = mods['GameDefine'] && mods['GameDefine'].exports;
  out.hasGD = !!GD;
  if (GD) {
    out.sceneTypeKeys = Object.keys(GD.SceneType || {}).slice(0, 10);
    out.PLAYER_HOUSE = GD.SceneType && GD.SceneType.PLAYER_HOUSE;
    out.DAY_AND_PLAYER_HOUSE = GD.ScenePassageType && GD.ScenePassageType.DAY_AND_PLAYER_HOUSE;
    out.gdKeys = Object.keys(GD).slice(0, 12);
  }
  const AppMod = mods['Application'] && mods['Application'].exports;
  const AppClass = AppMod && (AppMod.default || AppMod);
  out.hasApp = !!AppClass;
  out.cseType = AppClass && AppClass.prototype ? typeof AppClass.prototype.changeSceneEasy : 'no-proto';
  out.hooked = !!(AppClass && AppClass.prototype && AppClass.prototype.changeSceneEasy && AppClass.prototype.changeSceneEasy.__afNoDayHome);
  out.blockedFlag = !!window.__AF_DAY_HOME_BLOCKED__;
  return out;
});
console.log(JSON.stringify(dbg, null, 1));
console.log('logs:', logs.filter(l => l.includes('[AF]')).slice(-6).join(' | '));
await browser.close();
