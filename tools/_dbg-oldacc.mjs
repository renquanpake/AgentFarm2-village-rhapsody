// _dbg-oldacc.mjs —— 用老账号 test3 进村庄
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
console.log('login:', JSON.stringify(login).slice(0, 120));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_oa' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (/AF|error|Error/i.test(m.text())) console.log('C:', m.text().slice(0, 160)); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
const state = () => page.evaluate(() => {
  const scene = cc.director.getScene();
  const btns = [];
  scene.walk((n) => {
    if (!n.activeInHierarchy) return;
    const b = n.getComponent && n.getComponent(cc.Button);
    const l = n.getComponent && n.getComponent(cc.Label);
    if (b && /btn|Btn/.test(n.name)) btns.push(n.name);
    if (l && /(开始游戏|回忆录|新游戏|继续)/.test(l.string)) btns.push('L:' + l.string.slice(0, 8));
  });
  const app = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
  const pn = app && app.playerNode;
  return { btns: [...new Set(btns)].slice(0, 16), player: pn ? { x: Math.round(pn.x), y: Math.round(pn.y) } : null };
});
const clickLabel = async (pat) => {
  const c = await page.evaluate((pat) => {
    const re = new RegExp(pat);
    const scene = cc.director.getScene();
    let hit = null;
    scene.walk((n) => { if (!hit && n.activeInHierarchy) { const l = n.getComponent && n.getComponent(cc.Label); if (l && re.test(l.string)) hit = n; } });
    if (!hit) return null;
    const wp = hit.parent.convertToWorldSpaceAR(hit.position);
    return { x: Math.round(wp.x * 0.75), y: Math.round(900 - wp.y * 0.75), t: (hit.getComponent(cc.Label)?.string || '').slice(0, 8) };
  }, pat);
  if (c) { await page.mouse.click(c.x, c.y); return c.t; }
  return null;
};
const emitBtn = async (pat) => {
  return page.evaluate((pat) => {
    const re = new RegExp(pat);
    const scene = cc.director.getScene();
    let hit = null;
    scene.walk((n) => { if (!hit && n.activeInHierarchy) { const b = n.getComponent && n.getComponent(cc.Button); if (b && re.test(n.name)) hit = n; } });
    if (!hit) return null;
    try { cc.Component.EventHandler.emitEvents(hit.getComponent(cc.Button).clickEvents, hit); return hit.name; } catch (e) { return 'err'; }
  }, pat);
};
console.log('initial:', JSON.stringify(await state()));
let t = await clickLabel('^(开始游戏|回忆录)'); console.log('click:', t);
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const s = await state();
  console.log('t+' + (i + 1) * 5 + 's', JSON.stringify(s));
  if (s.player) break;
  if (!s.player) {
    const close = await emitBtn('^btnClose$');
    const next = await emitBtn('^btnNext$');
    if (close || next) console.log('  emitted:', close || next);
    else { const a = await clickLabel('^(开始游戏|回忆录|继续)'); if (a) console.log('  re-click:', a); }
  }
}
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_oldacc.png' });
await browser.close();
