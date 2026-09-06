// _dbg-uimap.mjs —— 村庄里 dump UiMap 节点结构（找地名标记）
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_um' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 6000));
const hasWorld = await page.evaluate(() => { const n = window.__AF_MODS__?.Application?.exports?.default?.getIns()?.playerNode; return !!(n && n.x && n.y); });
console.log('in world:', hasWorld);
if (hasWorld) {
  // 打开小地图（找 UiMap 相关按钮？）先 dump 场景里所有含 Map 的节点树
  const out = await page.evaluate(() => {
    const scene = cc.director.getScene();
    const found = [];
    scene.walk((n, d) => {
      const nm = n.name || '';
      if (/Map|map/.test(nm) && d < 8) {
        const label = n.getComponent && n.getComponent(cc.Label);
        const sp = n.getComponent && n.getComponent(cc.Sprite);
        found.push({ d, n: nm, l: label ? label.string.slice(0, 14) : '', sprite: !!sp, active: n.activeInHierarchy });
      }
    });
    return found.slice(0, 60);
  });
  for (const f of out) console.log('  '.repeat(f.d) + f.n + (f.l ? ' [' + f.l + ']' : '') + (f.sprite ? ' <sprite>' : '') + (f.active ? '' : ' (hidden)'));
}
await browser.close();
