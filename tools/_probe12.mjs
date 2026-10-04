import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const L = (s) => appendFileSync('/tmp/probe12.log', s + '\n');
const CHROME = process.env.AF_CHROME || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:8097';
const j = async (p, b) => { const r = await fetch(BASE + p, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {}); const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t.slice(0, 80) }; } };
const U = 'probe12_' + (Date.now() % 1e6);
let acc = await j('/af/register', { username: U, password: 'probe123' });
if (!acc.token) acc = await j('/af/login', { username: U, password: 'probe123' });
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1440,900'] });
const page = await b.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCacheEnabled(false);
await page.evaluateOnNewDocument((c) => { try { localStorage.setItem('af_token', c.token); localStorage.setItem('af_uid', c.uid); localStorage.setItem('af_nick', c.nick); localStorage.setItem('af.test', '1'); } catch (e) {} }, { token: acc.token, uid: acc.uid, nick: U });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => L('goto warn'));
await new Promise((r) => setTimeout(r, 40000));
await page.evaluate(() => { const el = [...document.querySelectorAll('button')].find((e) => (e.innerText || '').trim() === '稍后再说' && e.offsetParent !== null); if (el) el.click(); }).catch(() => {});
await new Promise((r) => setTimeout(r, 1000));

// 直接触发 Button 组件 clickEvents（绕过坐标）
const FIRE = function (name) {
  try {
    const scene = cc.director.getScene();
    let hit = null;
    scene.walk((n) => { if (!hit && n.activeInHierarchy && n.name === name) hit = n; });
    if (!hit) return 'node-not-found';
    const btn = hit.getComponent(cc.Button);
    if (!btn) return 'no-Button-comp children=' + hit.children.map((c) => c.name).join(',');
    const evs = btn.clickEvents || [];
    if (!evs.length) return 'no-clickEvents';
    let fired = 0;
    for (const ce of evs) {
      try { ce.emit([btn]); fired++; } catch (e) { return 'emit-err ' + String(e.message).slice(0, 60); }
    }
    return 'fired=' + fired + ' of ' + evs.length;
  } catch (e) { return 'err ' + String(e.message).slice(0, 60); }
};
L('btnStart: ' + await page.evaluate(FIRE, 'btnStart'));
await new Promise((r) => setTimeout(r, 5000));
L('btnClose: ' + await page.evaluate(FIRE, 'btnClose'));
await new Promise((r) => setTimeout(r, 3000));
L('start2: ' + await page.evaluate(FIRE, 'btnStart'));
await new Promise((r) => setTimeout(r, 8000));
L('close2: ' + await page.evaluate(FIRE, 'btnClose'));
L('btnClose visible? ' + await page.evaluate(() => { try { let vis = false; cc.director.getScene().walk((n) => { if (n.name === 'btnClose' && n.activeInHierarchy) vis = true; }); return vis; } catch (e) { return 'err'; } }));
for (const t of [30, 60, 90]) {
  await new Promise((r) => setTimeout(r, 30000));
  const st = await page.evaluate(() => { try { const m = window.__AF_MODS__; const A = m && m['Application'] && m['Application'].exports; const i = A && A.default && A.default.getIns && A.default.getIns(); return { pn: i && i.playerNode ? 'SET' : 'null' }; } catch (e) { return { err: String(e.message).slice(0, 50) }; } });
  await page.screenshot({ path: '/tmp/probe12-' + t + '.png' }).catch(() => {});
  L(`t=${t}s ${JSON.stringify(st)}`);
  if (st.pn === 'SET') break;
}
await b.close().catch(() => {});
L('done');
