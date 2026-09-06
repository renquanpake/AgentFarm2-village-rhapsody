// _dbg-longload.mjs —— 点开始/next 后长时间观察资源加载
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_ll' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', m => { const t = m.text(); logs.push(t.slice(0, 180)); });
page.on('pageerror', e => logs.push('PAGEERR: ' + e.message.slice(0, 200)));
page.on('requestfailed', r => logs.push('REQFAIL: ' + r.url().slice(0, 140) + ' ' + (r.failure()?.errorText || '')));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
const clickLabel = async (pat) => {
  const c = await page.evaluate((pat) => {
    const re = new RegExp(pat);
    const scene = cc.director.getScene();
    let hit = null;
    scene.walk((n) => { if (!hit && n.activeInHierarchy) { const l = n.getComponent && n.getComponent(cc.Label); if (l && re.test(l.string)) hit = n; } });
    if (!hit) return null;
    const wp = hit.parent.convertToWorldSpaceAR(hit.position);
    return { x: Math.round(wp.x * 0.75), y: Math.round(900 - wp.y * 0.75) };
  }, pat);
  if (c) { await page.mouse.click(c.x, c.y); return true; }
  return false;
};
const emitBtn = async (pat) => {
  return page.evaluate((pat) => {
    const re = new RegExp(pat);
    const scene = cc.director.getScene();
    let hit = null;
    scene.walk((n) => { if (!hit && n.activeInHierarchy) { const b = n.getComponent && n.getComponent(cc.Button); if (b && re.test(n.name)) hit = n; } });
    if (!hit) return false;
    try { cc.Component.EventHandler.emitEvents(hit.getComponent(cc.Button).clickEvents, hit); return true; } catch (e) { return false; }
  }, pat);
};
await clickLabel('^开始游戏$');
await new Promise(r => setTimeout(r, 5000));
await emitBtn('^btnNext$');
console.log('next emitted');
for (let i = 0; i < 12; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const st = await page.evaluate(() => {
    const scene = cc.director.getScene();
    const app = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
    const pn = app && app.playerNode;
    let memoir = false, start = false;
    scene.walk((n) => { if (!n.activeInHierarchy) return; const b = n.getComponent && n.getComponent(cc.Button); if (b && /^btnClose$/.test(n.name)) memoir = true; const l = n.getComponent && n.getComponent(cc.Label); if (l && /^开始游戏$/.test(l.string)) start = true; });
    return { memoir, start, player: pn ? { x: Math.round(pn.x), y: Math.round(pn.y) } : null };
  });
  console.log('t+' + (i + 1) * 5 + 's', JSON.stringify(st));
  if (st.player) break;
}
console.log('--- logs (last 25) ---');
for (const l of logs.slice(-25)) console.log(l);
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_longload.png' });
await browser.close();
