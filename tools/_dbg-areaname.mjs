// _dbg-areaname.mjs —— 验证区域名注入：扩展区显示"村外田野"/房屋名，原版区不动
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
const readName = () => page.evaluate(() => {
  const scene = cc.director.getScene();
  let lb = null;
  scene.walk((n) => { if (!lb && n.name === 'lbName' && n.parent && n.parent.name === 'pnlTime') lb = n; });
  return lb && lb.getComponent(cc.Label) ? lb.getComponent(cc.Label).string : '(无 lbName)';
});
const tests = [
  ['北带田野', 2200, 11000, /村外田野|田野/],
  ['房#2 门前', 3750, 9200, /树根家·村外/],
  ['房#2 东侧田', 4800, 10000, /村外田野|田野/],
  ['原版中心', 3900, 8600, null], // 原版区不覆盖（原版逻辑显示）
  ['南带田野', 5000, 800, /村外田野|田野/],
  ['东带门路', 12500, 3850, /村外田野|田野/],
];
for (const [name, x, y, re] of tests) {
  await page.evaluate(({ x, y }) => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(x, y, 0); }, { x, y });
  await new Promise(r => setTimeout(r, 1500));
  const label = await readName();
  const ok = re ? re.test(label) : !/村外/.test(label);
  console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] @(${x},${y}) → "${label}"`);
}
await browser.close();
