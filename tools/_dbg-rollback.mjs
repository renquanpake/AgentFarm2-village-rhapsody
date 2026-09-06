// _dbg-rollback.mjs —— 验证回滚 cb 是否注册/运行；把玩家放进盒子里观察是否被推出
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
page.on('console', m => { if (m.type() === 'log' || m.type() === 'warn') logs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => logs.push('PAGEERR: ' + e.message.slice(0, 300)));
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
const r1 = await page.evaluate(() => {
  const out = {};
  out.cbSet = !!window.__AF_BLOCK_CB__;
  out.boxes = (window.__AF_BLOCK_BOXES__ || []).length;
  const ins = window.__AF_MODS__.Application.exports.default.getIns();
  const node = ins.playerNode;
  // 放进水盒内 (3400,5850)
  node.setPosition(3400, 5850, 0);
  return out;
});
console.log('r1:', JSON.stringify(r1));
await new Promise(r => setTimeout(r, 1500));
const r2 = await page.evaluate(() => {
  const ins = window.__AF_MODS__.Application.exports.default.getIns();
  const node = ins.playerNode;
  const p = node.getPosition();
  return { pos: [Math.round(p.x), Math.round(p.y)] };
});
console.log('r2 (放进水盒 1.5s 后):', JSON.stringify(r2), r2.pos[0] === 3400 && Math.abs(r2.pos[1] - 5850) < 50 ? '→ 没被推出（回滚失效）' : '→ 被推出（回滚生效）');
// 再测一次带走路方向
await page.evaluate(() => {
  const mods = window.__AF_MODS__;
  const node = mods.Application.exports.default.getIns().playerNode;
  const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports;
  const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem');
  item.changeDir(5, false); // RIGHT
});
await new Promise(r => setTimeout(r, 1200));
const r3 = await page.evaluate(() => { const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode; return [Math.round(n.x), Math.round(n.y)]; });
console.log('r3 (水里往右走 1.2s 后):', JSON.stringify(r3));
await page.evaluate(() => { const mods = window.__AF_MODS__; const node = mods.Application.exports.default.getIns().playerNode; const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports; const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem'); item.changeDir(0, false); });
console.log('logs:', logs.filter(l => l.includes('[AF]') || l.includes('PAGEERR')).slice(-12).join('\n'));
await browser.close();
