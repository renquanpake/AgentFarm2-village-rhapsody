// _dbg-pond2.mjs —— 站水塘岸边截图 + 检查 shuich 层渲染状态
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
// 检查 shuich 层
const layerInfo = await page.evaluate(() => {
  const ins = window.__AF_MODS__.Application.exports.default.getIns();
  let tiledNode = null;
  ins.pnlSceneLayer.walk(n => { if (!tiledNode && n.getComponent && n.getComponent(cc.TiledMap)) tiledNode = n; });
  const tm = tiledNode.getComponent(cc.TiledMap);
  const out = { layerNames: [], shuich: null };
  const ls = tm.getLayers();
  for (const l of ls) {
    out.layerNames.push(l.node.name + (l.enabled ? '' : '(disabled)'));
    if (l.node.name === 'shuich') {
      out.shuich = {
        enabled: l.enabled,
        visible: l.node.activeInHierarchy,
        gidAt3358: l.getTiledTileAt(33, 58, true).gid & 0x0fffffff,
        opacity: l.node.opacity,
      };
    }
  }
  return out;
});
console.log('layers:', JSON.stringify(layerInfo));
// 站水塘北岸（TMX 33,48 → 本地 3350,6850），水塘在视野内
await page.evaluate(() => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(3350, 6850, 0); });
await new Promise(r => setTimeout(r, 2000));
const pos = await page.evaluate(() => { const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode; return [Math.round(n.x), Math.round(n.y)]; });
console.log('player at:', pos);
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_pond2.png', type: 'png' });
console.log('saved pond2');
await browser.close();
