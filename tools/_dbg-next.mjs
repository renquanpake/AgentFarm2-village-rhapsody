// _dbg-next.mjs —— 点 btnNext 后观察场景结构变化
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_nx' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { const t = m.text(); if (/AF|Error|error|warn|load|fail/i.test(t)) console.log('C:', t.slice(0, 200)); });
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
const top = () => page.evaluate(() => {
  const scene = cc.director.getScene();
  const kids = [];
  scene.children.forEach((n, i) => { kids.push(n.name + (n.activeInHierarchy ? '' : '(隐藏)')); });
  const app = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
  const pn = app && app.playerNode;
  return { scene: scene.name, kids: kids.slice(0, 20), player: pn ? { x: Math.round(pn.x), y: Math.round(pn.y) } : null };
});
await clickLabel('^开始游戏$');
await new Promise(r => setTimeout(r, 5000));
console.log('after start:', JSON.stringify(await top()));
await emitBtn('^btnNext$');
await new Promise(r => setTimeout(r, 3000));
console.log('after next:', JSON.stringify(await top()));
await emitBtn('^btnNext$');
await new Promise(r => setTimeout(r, 5000));
console.log('after next2:', JSON.stringify(await top()));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_next.png' });
await browser.close();
