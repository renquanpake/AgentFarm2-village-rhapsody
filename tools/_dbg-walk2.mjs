// _dbg-walk2.mjs —— 精确轨迹：走路撞栅栏盒（每 100ms 采样）
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
page.on('console', m => { if (m.type() === 'log') logs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => logs.push('PAGEERR: ' + e.message.slice(0, 200)));
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

const run = async (name, x, y, dirKey) => {
  const dirMap = { LEFT: 2, RIGHT: 5, UP: 10, DOWN: 11 };
  await page.evaluate(({ x, y }) => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(x, y, 0); }, { x, y });
  await new Promise(r => setTimeout(r, 900)); // 等回滚把玩家稳定下来（若起点在盒内会被弹出）
  const start = await page.evaluate(() => { const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode; return [n.x, n.y]; });
  await page.evaluate(({ dir }) => {
    const mods = window.__AF_MODS__;
    const node = mods.Application.exports.default.getIns().playerNode;
    const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports;
    const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem');
    item.changeDir(dir, false);
  }, { dir: dirMap[dirKey] });
  const traj = [];
  for (let i = 0; i < 16; i++) {
    await new Promise(r => setTimeout(r, 120));
    const p = await page.evaluate(() => { const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode; return [Math.round(n.x), Math.round(n.y)]; });
    traj.push(p.join(','));
  }
  await page.evaluate(() => { const mods = window.__AF_MODS__; const node = mods.Application.exports.default.getIns().playerNode; const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports; const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem'); item.changeDir(0, false); });
  console.log(`\n[${name}] 起点(传送) (${x},${y}) → 稳定后 (${start.map(Math.round).join(',')})`);
  console.log('轨迹:', traj.join(' → '));
};
// 栅栏 (16,0)：盒 (1700,11650) 100x100 → 从南向北走
await run('栅栏(16,0) 向北', 1650, 11490, 'UP');
// 水面：从水盒西侧向东走 —— 起点选在盒外西 300
await run('水面 向东', 3000, 5850, 'RIGHT');
// 房子#2：门 (37,25) 向北
await run('房#2 向北', 3750, 9310, 'UP');
console.log('logs:', logs.filter(l => l.includes('[AF]') || l.includes('PAGEERR')).slice(-8).join(' | '));
await browser.close();
