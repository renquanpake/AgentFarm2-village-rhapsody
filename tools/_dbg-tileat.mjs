// _dbg-tileat.mjs —— 新账号（村庄场景）鼠标位置→世界坐标 + 该格所有层 gid
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'ta' + Date.now().toString(36).slice(-6);
const pwd = 'ta!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_ta' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
// 白天
await page.evaluate(() => {
  const k = Object.keys(localStorage).find(x => x.startsWith('playerData_'));
  if (k) { const v = JSON.parse(localStorage.getItem(k)); v.time = 100; v.timeNode = 0; localStorage.setItem(k, JSON.stringify(v)); }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 14000));
await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 6000));
await page.evaluate(() => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(1200, 2800, 0); });
await new Promise(r => setTimeout(r, 2500));
await page.mouse.move(540, 300);
await new Promise(r => setTimeout(r, 1500));
const out = await page.evaluate(() => {
  const scene = cc.director.getScene();
  // 找 TiledMap 组件
  let tm = null;
  scene.walk((n) => { if (!tm) { const c = n.getComponent && n.getComponent(cc.TiledMap); if (c) tm = c; } });
  if (!tm) return 'no TiledMap component';
  const res = { mapSize: { w: tm.getMapSize().width, h: tm.getMapSize().height } };
  // 玩家位置
  const pn = window.__AF_MODS__.Application.exports.default.getIns().playerNode;
  res.player = { x: Math.round(pn.x), y: Math.round(pn.y) };
  // 鼠标世界坐标：用 cc 事件系统的鼠标位置
  try {
    const mp = cc.inputManager.getMousePosition();
    res.mouseScreen = mp ? { x: Math.round(mp.x), y: Math.round(mp.y) } : null;
  } catch (e) { res.mouseErr = e.message.slice(0, 60); }
  // 玩家附近几个格的 fanzi gid（tiledmap 层）
  const px = Math.floor(pn.x / 100), py = Math.floor(pn.y / 100);
  const layers = {};
  for (const ln of ['diji', 'caodi', 'fanzi', 'shilu', 'mulan', 'caoduo1']) {
    const L = tm.getLayer(ln);
    if (L) {
      const t = L.getTiledTileAt(px, py, true);
      layers[ln] = t ? t.gid : 'no-tile';
    }
  }
  res.playerTile = { x: px, y: py, layers };
  // 尝试 screenToWorld（MapCamera 的 Camera 组件）
  const camNode = scene.getChildByName('MapCamera');
  if (camNode) {
    const cc2 = camNode.getComponent(cc.Camera);
    if (cc2) {
      const w = cc2.screenToWorld(new cc.Vec2(540, 300));
      res.x540World = { x: Math.round(w.x), y: Math.round(w.y) };
    } else res.camComp = camNode.components.map(c => c.constructor.name);
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
