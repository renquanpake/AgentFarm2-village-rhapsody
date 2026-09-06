// _dbg-dayhome.mjs —— 验证过夜不回家：村庄里睡到早上，应留在村庄
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
page.on('console', m => { if (m.type() === 'log' || m.type() === 'warn') logs.push(m.text().slice(0, 250)); });
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
const getState = () => page.evaluate(() => {
  const PM = window.__AF_MODS__.PlayerMoudle.exports;
  const player = PM._gPlayer || PM.default._gPlayer;
  const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode;
  return { scene: player.getSceneType(), time: player.getTime(), pos: [Math.round(n.x), Math.round(n.y)] };
});
console.log('睡前:', JSON.stringify(await getState()));
// 把玩家放到村庄田野（北带），然后睡到早上
await page.evaluate(() => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(6800, 11000, 0); });
await new Promise(r => setTimeout(r, 800));
const s0 = await getState();
console.log('放置后:', JSON.stringify(s0));
// 触发睡觉到早上（setTimeNode(MORNNING=1, 模式3=睡觉)）
const fired = await page.evaluate(() => {
  try {
    const PM = window.__AF_MODS__.PlayerMoudle.exports;
    const player = PM._gPlayer || PM.default._gPlayer;
    player.setTimeNode(1, 3); // MORNNING + 睡觉模式
    return 'ok';
  } catch (e) { return 'err: ' + e.message; }
});
console.log('setTimeNode:', fired);
// 睡觉动画 5s + 转场，等 10 秒
await new Promise(r => setTimeout(r, 10000));
const s1 = await getState();
console.log('睡醒后:', JSON.stringify(s1));
const ok = s1.scene === 2 && Math.abs(s1.pos[0] - 6800) < 600 && Math.abs(s1.pos[1] - 11000) < 600;
console.log(ok ? 'PASS 过夜后留在村庄原地（不再自动回家）' : 'FAIL 还是被传送了');
console.log('logs:', logs.filter(l => l.includes('[AF]')).slice(-8).join(' | '));
await browser.close();
