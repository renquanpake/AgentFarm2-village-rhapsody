// _dbg-final.mjs —— 最终碰撞验证（正确起点：盒外走进盒内）
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

let pass = 0, fail = 0;
const walk = async (name, x, y, dirKey, expect) => {
  const dirMap = { LEFT: 2, RIGHT: 5, UP: 10, DOWN: 11 };
  await page.evaluate(({ x, y }) => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(x, y, 0); }, { x, y });
  await new Promise(r => setTimeout(r, 900));
  const start = await page.evaluate(() => { const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode; return [n.x, n.y]; });
  await page.evaluate(({ dir }) => {
    const mods = window.__AF_MODS__;
    const node = mods.Application.exports.default.getIns().playerNode;
    const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports;
    const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem');
    item.changeDir(dir, false);
  }, { dir: dirMap[dirKey] });
  await new Promise(r => setTimeout(r, 1600));
  const after = await page.evaluate(() => { const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode; return [n.x, n.y]; });
  await page.evaluate(() => { const mods = window.__AF_MODS__; const node = mods.Application.exports.default.getIns().playerNode; const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports; const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem'); item.changeDir(0, false); });
  const dx = Math.round(after[0] - start[0]), dy = Math.round(after[1] - start[1]);
  const dist = Math.round(Math.hypot(dx, dy));
  const ok = expect === 'block' ? dist < 120 : dist >= 120;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${expect}] ${name}: 起(${start.map(Math.round)}) 终(${after.map(Math.round)}) dist=${dist}${dist < 120 ? ' <<挡' : ''}`);
};
// 1) 水面：水盒 x2850-3950@y5850 → 从西侧 2750 向东走进水（应挡）
await walk('水面 33,58 向东入水', 2750, 5850, 'RIGHT', 'block');
// 2) 外圈栅栏 (16,0)：盒 y11550-11700 → 从南 11400 向北撞（应挡）
await walk('外圈栅栏 16,0 向北', 1650, 11400, 'UP', 'block');
// 3) 北门路（x67-69 轴线 = 本地 6700-6950）：栅栏环缺口 → 从南向北穿过（应畅通）
await walk('北门路口 向北通过', 6800, 11000, 'UP', 'free');
// 4) 扩展区道路：向东（应畅通）
await walk('扩展区道路 向东', 4000, 2500, 'RIGHT', 'free');
// 5) 房#2 门向北进房（应挡）
await walk('房#2 门 向北进房', 3750, 9310, 'UP', 'block');
// 6) 旧错误镜像位置（应畅通）
await walk('旧错位点 (4660,1950)', 4660, 1950, 'RIGHT', 'free');
// 7) 原版区域栅栏（不新增阻挡，应畅通）：原版石板广场（TMX y77-79 → 本地 3750-3950）
await walk('原版广场 向东', 6500, 3850, 'RIGHT', 'free');
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
console.log('logs:', logs.filter(l => l.includes('[AF]')).slice(-4).join(' | '));
await browser.close();
process.exit(fail ? 1 : 0);
