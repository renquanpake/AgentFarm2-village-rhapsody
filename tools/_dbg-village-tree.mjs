// _dbg-village-tree.mjs —— dump UiMap/pnlContent/village 的完整子树与组件
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
await page.evaluate(() => {
  const scene = cc.director.getScene();
  let btn = null;
  scene.walk((n) => { if (!btn && n.name === 'btnMap' && n.activeInHierarchy) btn = n; });
  if (btn) { const b = btn.getComponent(cc.Button); if (b) { try { cc.Component.EventHandler.emitEvents(b.clickEvents, btn); } catch (e) {} } }
});
await new Promise(r => setTimeout(r, 2500));
const tree = await page.evaluate(() => {
  const scene = cc.director.getScene();
  let uiMap = null;
  scene.walk(n => { if (!uiMap && n.name === 'UiMap') uiMap = n; });
  if (!uiMap) return 'no UiMap';
  const out = [];
  const walk = (n, depth) => {
    const comps = (n.components || []).map(c => c.constructor.name).join(',');
    const s = n.getComponent && n.getComponent(cc.Sprite);
    const sf = s && s.spriteFrame;
    out.push('  '.repeat(depth) + n.name + ' [active=' + n.activeInHierarchy + '] [' + comps + '] size=' + Math.round(n.width) + 'x' + Math.round(n.height) +
      (sf ? ' sfTex=' + (sf._texture ? sf._texture.width + 'x' + sf._texture.height : 'null') : ''));
    for (const c of n.children || []) walk(c, depth + 1);
  };
  walk(uiMap, 0);
  return out.join('\n');
});
console.log(tree);
await browser.close();
