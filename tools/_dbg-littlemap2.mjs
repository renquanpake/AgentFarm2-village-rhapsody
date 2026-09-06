// _dbg-littlemap2.mjs —— 点 btnMap 打开小地图，确认 LittleMap 节点结构
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
const logs = [];
page.on('console', m => { if (m.type() === 'log' || m.type() === 'warn') logs.push(m.text().slice(0, 250)); });
page.on('pageerror', e => logs.push('PAGEERR: ' + e.message.slice(0, 250)));
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
// 点 btnMap
await page.evaluate(() => {
  const scene = cc.director.getScene();
  let btn = null;
  scene.walk((n) => { if (!btn && n.name === 'btnMap' && n.activeInHierarchy) btn = n; });
  if (!btn) return 'no btnMap';
  const b = btn.getComponent(cc.Button);
  if (b) { try { cc.Component.EventHandler.emitEvents(b.clickEvents, btn); return 'clicked via events'; } catch (e) { return 'click fail: ' + e.message; } }
  return 'no button comp';
});
await new Promise(r => setTimeout(r, 2500));
// 检查 village spriteFrame 状态
const sfInfo = await page.evaluate(() => {
  const scene = cc.director.getScene();
  let village = null;
  scene.walk(n => { if (!village && n.name === 'village' && n.parent && n.parent.name === 'pnlContent') village = n; });
  if (!village) return { found: false };
  const s = village.getComponent(cc.Sprite);
  const sf = s && s.spriteFrame;
  return { found: true,
    sfTex: sf && sf._texture ? [sf._texture.width, sf._texture.height] : null,
    sfRect: sf && sf._rect ? [sf._rect.width, sf._rect.height] : null,
    nodeSize: [Math.round(village.width), Math.round(village.height)],
    mapImgDone: !!window.__AF_MAPIMG__ };
});
const info = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const out = [];
  scene.walk((n) => {
    const nm = n.name || '';
    if (/little|Little/.test(nm) || nm === 'village') {
      const s = n.getComponent && n.getComponent(cc.Sprite);
      out.push({ name: nm, parent: n.parent ? n.parent.name : '?', active: n.activeInHierarchy,
        size: s && s.spriteFrame ? [Math.round(s.spriteFrame._rect ? s.spriteFrame._rect.width : 0), Math.round(s.spriteFrame._rect ? s.spriteFrame._rect.height : 0)] : null,
        nodeSize: [Math.round(n.width), Math.round(n.height)] });
    }
  });
  return out;
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_littlemap.png', type: 'png' });
console.log('sfInfo:', JSON.stringify(sfInfo));
console.log('screenshot saved');
console.log('\nlogs:', logs.slice(-15).join('\n'));
await browser.close();
