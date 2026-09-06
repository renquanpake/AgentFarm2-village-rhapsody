// _dbg-collide2.mjs —— 第二轮：sceneSize/地图尺寸/全量碰撞体/世界坐标核对
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
page.on('pageerror', e => logs.push(e.message.slice(0, 200)));
page.on('console', m => { if (m.type() === 'log') logs.push(m.text().slice(0, 200)); });
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
const diag = await page.evaluate(() => {
  const out = {};
  const ins = window.__AF_MODS__.Application.exports.default.getIns();
  out.sceneSize = ins.sceneSize ? [ins.sceneSize.width, ins.sceneSize.height] : null;
  // pnlAdapter 与 player 父链
  const layer = ins.pnlSceneLayer;
  out.layerWorld = layer ? [layer.convertToWorldSpaceAR(cc.v2(0, 0)).x, layer.convertToWorldSpaceAR(cc.v2(0, 0)).y] : null;
  const pn = ins.playerNode;
  out.playerLocal = pn ? [pn.x, pn.y] : null;
  out.playerWorld = pn ? [pn.convertToWorldSpaceAR(cc.v2(0, 0)).x, pn.convertToWorldSpaceAR(cc.v2(0, 0)).y] : null;
  let pp = pn && pn.parent, chain = [];
  while (pp) { chain.push(pp.name + '@' + [Math.round(pp.x), Math.round(pp.y)] + 's' + pp.scaleX); pp = pp.parent; }
  out.playerChain = chain;
  // 找 pnlTiledMap 与地图尺寸
  const scene = cc.director.getScene();
  let tiled = null, mapInfo = null;
  scene.walk((n) => { if (!tiled && n.getComponent && n.getComponent(cc.TiledMap)) tiled = n; });
  if (tiled) {
    const tm = tiled.getComponent(cc.TiledMap);
    const ms = tm.getMapSize ? tm.getMapSize() : null;
    mapInfo = { node: tiled.name, pos: [tiled.x, tiled.y], scale: [tiled.scaleX, tiled.scaleY], mapSize: ms ? [ms.width, ms.height] : null, tileSize: tm.getTileSize ? [tm.getTileSize().width, tm.getTileSize().height] : null };
  }
  out.tiledMap = mapInfo;
  // 全量（含 inactive）碰撞体
  const colls = [];
  scene.walk((n) => {
    const comps = n.components || [];
    for (const c of comps) {
      if (c instanceof cc.PhysicsBoxCollider || c instanceof cc.PhysicsPolygonCollider || c instanceof cc.BoxCollider) {
        const wp = n.parent ? n.parent.convertToWorldSpaceAR(n.position) : n.position;
        let size = null, pts = null, off = null;
        if (c instanceof cc.PhysicsBoxCollider || c instanceof cc.BoxCollider) size = [Math.round(c.size.width), Math.round(c.size.height)];
        if (c instanceof cc.PhysicsPolygonCollider) pts = c.points ? c.points.length : null;
        if (c.offset) off = [Math.round(c.offset.x), Math.round(c.offset.y)];
        const rbc = n.getComponent(cc.RigidBody);
        colls.push({ name: n.name, pos: [Math.round(wp.x), Math.round(wp.y)], size, pts, off, group: n.groupIndex, rb: rbc ? rbc.type : null, active: n.activeInHierarchy, type: c.constructor.name });
      }
    }
  });
  out.collidersAll = colls;
  return out;
});
console.log(JSON.stringify(diag, null, 1));
console.log('logs:', logs.slice(-8).join(' | '));
await browser.close();
