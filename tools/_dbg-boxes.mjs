// _dbg-boxes.mjs —— 实机检查注入的阻挡盒 vs 预期位置（水 33,58 / 栅栏 16,0 / 房2）
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
page.on('console', m => { if (m.type() === 'log') logs.push(m.text().slice(0, 300)); });
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
await new Promise(r => setTimeout(r, 2500)); // 等阻挡注入跑一轮

const diag = await page.evaluate(() => {
  const out = {};
  const ins = window.__AF_MODS__.Application.exports.default.getIns();
  out.sceneSize = ins.sceneSize ? [ins.sceneSize.width, ins.sceneSize.height] : null;
  // 找 TiledMap
  let tiledNode = null;
  ins.pnlSceneLayer.walk(n => { if (!tiledNode && n.getComponent && n.getComponent(cc.TiledMap)) tiledNode = n; });
  const tm = tiledNode && tiledNode.getComponent(cc.TiledMap);
  const ms = tm.getMapSize();
  out.mapSize = [ms.width, ms.height];
  // 图层读取测试
  const read = (name, x, y) => { try { const L = tm.getLayer(name); return L ? (L.getTiledTileAt(x, y, true).gid || 0) : -1; } catch (e) { return -2; } };
  out.shuich3358 = read('shuich', 33, 58);
  out.mulan160 = read('mulan', 16, 0);
  out.mulan1058 = read('mulan', 105, 8);
  out.caodi160 = read('caodi', 16, 0);
  // 阻挡盒
  const boxes = window.__AF_BLOCK_BOXES__ || [];
  out.boxCount = boxes.length;
  out.nearWater = boxes.filter(b => Math.abs(b.y - 5850) < 60 && b.x > 3000 && b.x < 3600).map(b => b);
  out.nearFence0 = boxes.filter(b => Math.abs(b.y - 11650) < 60 && b.x > 1500 && b.x < 1800).map(b => b);
  out.nearFence8 = boxes.filter(b => Math.abs(b.y - 10850) < 60 && b.x > 10400 && b.x < 10700).map(b => b);
  out.anyRow0 = boxes.filter(b => Math.abs(b.y - 11650) < 200).map(b => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }));
  return out;
});
console.log(JSON.stringify(diag, null, 1));
console.log('logs:', logs.filter(l => l.includes('[AF]')).slice(-6).join(' | '));
await browser.close();
