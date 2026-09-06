// _dbg-areaname2.mjs —— 复现 injectAreaName 逻辑，输出中间值
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
await new Promise(r => setTimeout(r, 2500));
await page.evaluate(() => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(3500, 10000, 0); });
await new Promise(r => setTimeout(r, 2000));
const dbg = await page.evaluate(() => {
  const out = {};
  const ins = window.__AF_MODS__.Application.exports.default.getIns();
  const node = ins.playerNode;
  const p = node.getPosition();
  out.p = [p.x, p.y];
  // 找 TiledMap
  let tiledNode = null;
  ins.pnlSceneLayer.walk(n => { if (!tiledNode && n.getComponent && n.getComponent(cc.TiledMap)) tiledNode = n; });
  out.tiledFound = !!tiledNode;
  const tm = tiledNode && tiledNode.getComponent(cc.TiledMap);
  const ms = tm.getMapSize();
  out.mapSize = [ms.width, ms.height];
  const gx = Math.floor(p.x / 100), gy = ms.height - 1 - Math.floor(p.y / 100);
  out.gx = gx; out.gy = gy;
  const LEFT = Math.round((ms.width - 77) / 2), TOP = Math.round((ms.height - 61) / 2);
  out.LEFT = LEFT; out.TOP = TOP;
  out.inOrig = gx >= LEFT && gx < LEFT + 77 && gy >= TOP && gy < TOP + 61;
  out.spawnsHouses = (window.__AF_SPAWNS__ && window.__AF_SPAWNS__.houses || []).map(h => ({ id: h.id, rect: h.rect }));
  const near = (window.__AF_SPAWNS__ && window.__AF_SPAWNS__.houses || []).find(h => {
    const r = h.rect;
    return gx >= r.x - 3 && gx < r.x + r.w + 3 && gy >= r.y - 3 && gy < r.y + r.h + 3;
  });
  out.near = near ? near.id + ':' + near.type : null;
  // lbName 现状
  const scene = cc.director.getScene();
  let lb = null;
  scene.walk((n) => { if (!lb && n.name === 'lbName' && n.parent && n.parent.name === 'pnlTime') lb = n; });
  out.lb = lb && lb.getComponent(cc.Label) ? lb.getComponent(cc.Label).string : '(none)';
  return out;
});
console.log(JSON.stringify(dbg, null, 1));
await browser.close();
