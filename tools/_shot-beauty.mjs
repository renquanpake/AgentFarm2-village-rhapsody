// _shot-beauty.mjs —— 新地图实机截图（白天），8 个关键点位
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/agent社区/AgentFarm2/_v3_';
const uname = 'beauty' + Date.now().toString(36).slice(-6);
const pwd = 'b3auty!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
if (!login.ok) throw new Error('login: ' + JSON.stringify(login));
console.log('account:', uname, 'uid:', login.uid);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_p' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('pageerror', e => logs.push(e.message.slice(0, 200)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', String(uid)); localStorage.setItem('af_nick', 'beauty'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 10000));
// 白天：找 playerData_* 存档键（登录后已进入游戏页）
const timeSet = await page.evaluate(() => {
  const k = Object.keys(localStorage).find(x => x.startsWith('playerData_'));
  if (!k) return null;
  const v = JSON.parse(localStorage.getItem(k));
  v.time = 100; v.timeNode = 0;
  localStorage.setItem(k, JSON.stringify(v));
  return k;
});
console.log('daytime key:', timeSet);
if (timeSet) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 10000));
}
// 进入世界：主菜单用经典点击流 (720,468)+(720,252) 进入村庄；若弹回忆录/图鉴用 Cocos 回调关闭
const hasWorldNow = () => page.evaluate(() => {
  const ins = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
  const n = ins?.playerNode;
  return !!(n && n.x && n.y);
});
let hasWorld = false;
for (let attempt = 0; attempt < 6 && !hasWorld; attempt++) {
  // 若主菜单可见：经典点击流
  const onMenu = await page.evaluate(() => {
    const scene = cc.director.getScene();
    let f = false;
    scene.walk((n) => { if (!f && n.activeInHierarchy) { const l = n.getComponent && n.getComponent(cc.Label); if (l && /^开始游戏$/.test(l.string)) f = true; } });
    return f;
  });
  if (onMenu) {
    await page.mouse.click(720, 468);
    await new Promise(r => setTimeout(r, 5000));
    await page.mouse.click(720, 252);
    await new Promise(r => setTimeout(r, 5000));
    console.log('menu clicks done');
  }
  // 关闭可能出现的回忆录/图鉴弹窗
  const closed = await page.evaluate(() => {
    const scene = cc.director.getScene();
    let hit = null;
    scene.walk((n) => {
      if (hit || !n.activeInHierarchy) return;
      const btnC = n.getComponent && n.getComponent(cc.Button);
      if (btnC && /^btnClose$/i.test(n.name)) hit = n;
    });
    if (!hit) return false;
    try { cc.Component.EventHandler.emitEvents(hit.getComponent(cc.Button).clickEvents, hit); return true; } catch (e) { return false; }
  });
  if (closed) {
    console.log('closed popup via emitEvents');
    await new Promise(r => setTimeout(r, 4000));
  }
  for (let i = 0; i < 6 && !hasWorld; i++) {
    await new Promise(r => setTimeout(r, 4000));
    hasWorld = await hasWorldNow();
  }
  if (!hasWorld) console.log('world attempt', attempt, 'failed; screen:', (await page.evaluate(() => document.body.innerText.slice(0, 120).replace(/\n/g, ' '))));
}
console.log('in world:', hasWorld);
if (!hasWorld) { console.log('logs:', logs.slice(-10).join(' | ')); await browser.close(); process.exit(1); }
const shots = [
  ['center', 3900, 8600],
  ['north_gate', 6800, 11200],
  ['north_field', 2200, 11000],
  ['east_gate', 13000, 3850],
  ['west_gate', 1500, 3850],
  ['lot6', 10750, 9050],
  ['lot2', 3250, 10150],
  ['lot8', 1650, 7850],
  ['south_gate', 6800, 1500],
  ['south_field', 5000, 800],
  ['se_corner', 12800, 600],
  ['nw_corner', 600, 600],
];
for (const [name, x, y] of shots) {
  await page.evaluate(({ x, y }) => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(x, y, 0); }, { x, y });
  await new Promise(r => setTimeout(r, 1800));
  await page.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 82 });
  console.log('shot', name, '@', x, y);
}
console.log('logs:', logs.slice(-6).join(' | ') || 'clean');
await browser.close();
