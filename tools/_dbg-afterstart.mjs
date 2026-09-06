// _dbg-afterstart.mjs —— 点开始游戏后持续观察场景
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'as' + Date.now().toString(36).slice(-6);
const pwd = 'as!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_as' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (/AF|error|Error|warn/i.test(m.text())) console.log('CONSOLE:', m.text().slice(0, 180)); });
page.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 180)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
const btn = await page.evaluate(() => {
  const scene = cc.director.getScene();
  let hit = null;
  scene.walk((n) => {
    if (hit || !n.activeInHierarchy) return;
    const label = n.getComponent && n.getComponent(cc.Label);
    if (label && /开始游戏/.test(label.string)) hit = n;
  });
  if (!hit) return null;
  const wp = hit.parent ? hit.parent.convertToWorldSpaceAR(hit.position) : hit.position;
  return { x: Math.round(wp.x * 0.75), y: Math.round(900 - wp.y * 0.75) };
});
if (btn) { await page.mouse.click(btn.x, btn.y); console.log('clicked start at', btn.x, btn.y); }
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 6000));
  const st = await page.evaluate(() => {
    const scene = cc.director.getScene();
    const nodes = [];
    scene.walk((n, d) => { if (d <= 2) nodes.push(' '.repeat(d) + n.name + (n.activeInHierarchy ? '' : '(隐藏)')); });
    const ins = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
    return { scene: scene.name, nodes: nodes.slice(0, 25), insPlayer: ins?.playerNode ? { x: Math.round(ins.playerNode.x), y: Math.round(ins.playerNode.y) } : null, btnStart: (() => { let f = false; scene.walk(n => { if (!f && n.getComponent && n.getComponent(cc.Label) && /开始游戏/.test(n.getComponent(cc.Label).string) && n.activeInHierarchy) f = true; }); return f; })() };
  });
  console.log('t+' + (i + 1) * 6 + 's', JSON.stringify(st));
  if (st.insPlayer) break;
}
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_afterstart.png' });
await browser.close();
