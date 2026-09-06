// _dbg-guide.mjs —— 组合：开始 → 翻页/关闭引导 → 进村
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'gd' + Date.now().toString(36).slice(-6);
const pwd = 'gd!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_gd' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (/AF|error|Error|warn/i.test(m.text())) console.log('C:', m.text().slice(0, 160)); });
page.on('pageerror', e => console.log('P:', e.message.slice(0, 160)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
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
const state = () => page.evaluate(() => {
  const scene = cc.director.getScene();
  const btns = [];
  scene.walk((n) => {
    if (!n.activeInHierarchy) return;
    const b = n.getComponent && n.getComponent(cc.Button);
    const l = n.getComponent && n.getComponent(cc.Label);
    if (b && /btn|Btn/.test(n.name)) btns.push(n.name);
    if (l && /(开始游戏|新游戏|继续|读档|存档)/.test(l.string)) btns.push('L:' + l.string.slice(0, 8));
  });
  const app = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
  const pn = app && app.playerNode;
  return { btns: [...new Set(btns)].slice(0, 20), player: pn ? { x: Math.round(pn.x), y: Math.round(pn.y) } : null };
});
let t = await clickLabel('^(开始游戏|回忆录)'); console.log('click:', t);
for (let i = 0; i < 12; i++) {
  await new Promise(r => setTimeout(r, 4000));
  const s = await state();
  console.log('t+' + (i + 1) * 4 + 's', JSON.stringify(s));
  if (s.player) break;
  if (!s.player) {
    const next = await emitBtn('^btnNext$');
    const close = await emitBtn('^btnClose$');
    if (next || close) console.log('  emitted:', next || close);
    else {
      const again = await clickLabel('^(开始游戏|新游戏|继续)');
      if (again) console.log('  re-click:', again);
    }
  }
}
await browser.close();
