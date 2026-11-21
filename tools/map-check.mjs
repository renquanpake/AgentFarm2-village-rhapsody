import { chromium } from 'playwright-core';

const BASE = process.env.AF_BASE || 'https://outstanding-spontaneity-production.up.railway.app';
const CHROME = '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const cred = { username: 'deployok01', password: 'pass1234' };
let auth = await fetch(BASE + '/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred) }).then(r => r.json());
if (!auth.token) auth = await fetch(BASE + '/af/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred) }).then(r => r.json());
console.log('auth', auth.ok);

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 160)));

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(a => {
  localStorage.setItem('af_token', a.token);
  localStorage.setItem('af_uid', a.uid);
  localStorage.setItem('af_nick', a.nick || a.username || 'tester');
}, auth);
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 18; i++) {
  await page.waitForTimeout(10000);
  const st = await page.evaluate(() => {
    const out = { scene: '', village: false, pos: null };
    try {
      const sc = cc.director.getScene(); out.scene = sc && sc.name;
      sc.walk(n => { if (n.name === 'village' && n.activeInHierarchy) out.village = true; });
      const M = window.__AF_MODS__ && window.__AF_MODS__['PlayerMoudle'] && window.__AF_MODS__['PlayerMoudle'].exports;
      const pl = M && (M._gPlayer || (M.default && M.default._gPlayer));
      if (pl && pl.getSceneType) out.pos = [pl.getSceneType(), Math.round(pl.node && pl.node.x), Math.round(pl.node && pl.node.y)];
    } catch (e) { out.err = e.message; }
    return out;
  });
  console.log('WAIT', i, JSON.stringify(st));
  if (st.village) break;
}

// 关掉可能自动弹出的 Agent 面板
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

const tree = await page.evaluate(() => {
  const out = [];
  try {
    const scene = window.cc && cc.director.getScene();
    if (!scene) return ['<no-scene>'];
    scene.walk(n => {
      const nm = n.name || '';
      if (/map|Map|pnl|village/i.test(nm)) {
        let p = n, path = [];
        while (p && path.length < 6) { path.unshift(p.name || '?'); p = p.parent; }
        out.push({ name: nm, path: path.join('/'), active: !!n.activeInHierarchy });
      }
    });
  } catch (e) { out.push('ERR ' + e.message); }
  return out.slice(0, 60);
});
console.log('TREE', JSON.stringify(tree));

const clicked = await page.evaluate(() => {
  try {
    const scene = cc.director.getScene();
    let hit = null;
    scene.walk(n => { if (!hit && /^btn_?map$/i.test(n.name || '')) hit = n; });
    if (!hit) return 'no-btn';
    const bg = hit.getComponent(cc.Button);
    if (bg && bg.clickEvents && bg.clickEvents.length) {
      cc.Component.EventHandler.emitEvents(bg.clickEvents, bg);
      return 'emitted:' + hit.name;
    }
    return 'found-no-click:' + hit.name;
  } catch (e) { return 'ERR ' + e.message; }
});
console.log('CLICK', clicked);
if (clicked === 'no-btn' || clicked.startsWith('found')) {
  await page.keyboard.press('m');
  await page.waitForTimeout(1500);
  await page.keyboard.press('M');
}
await page.waitForTimeout(4000);

const state = await page.evaluate(() => {
  const out = {};
  try {
    const scene = cc.director.getScene();
    scene.walk(n => {
      if (n.name === 'village') {
        out.villageActive = !!n.activeInHierarchy;
        out.villageSize = [Math.round(n.width), Math.round(n.height)];
        const bg = n.getChildByName && n.getChildByName('afMapBg');
        out.bg = !!bg;
        if (bg) out.bgSize = [Math.round(bg.width), Math.round(bg.height)];
      }
    });
  } catch (e) { out.err = e.message; }
  out.agentModal = !!document.querySelector('#af-ob-panel, .af-ob-panel');
  return out;
});
await page.screenshot({ path: '/tmp/opencode/map.png' });
console.log('STATE', JSON.stringify(state));
console.log('ERRORS', JSON.stringify(errors.slice(0, 10)));
await browser.close();