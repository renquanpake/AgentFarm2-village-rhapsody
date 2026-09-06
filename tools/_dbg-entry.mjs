// _dbg-entry.mjs —— 诊断：水塘截图 + 村庄场景入口(map_passage)节点位置
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const BASE = 'http://127.0.0.1:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const KEY = Buffer.from('qingyoo0316', 'utf8');
const dec = (p) => {
  const buf = readFileSync(p);
  const o = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < o.length; i++) o[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return JSON.parse(o.toString('utf8'));
};
function loadMap(p) {
  const s = JSON.stringify(dec(p));
  let i = s.indexOf('"daditu"') + 8; while (s[i] !== '"') i++;
  let j = ++i; while (j < s.length) { if (s[j] === '\\') j += 2; else if (s[j++] === '"') break; }
  const xml = JSON.parse(s.slice(i - 1, j));
  const layers = {};
  for (const m of xml.matchAll(/<layer[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g))
    layers[m[1]] = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer)).map(v => v & 0x0fffffff);
  return { W: +xml.match(/width="(\d+)"/)[1], H: +xml.match(/height="(\d+)"/)[1], layers };
}
const M = loadMap('client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const { W, H } = M;
// 水塘格子：按连通块分组找中心
const water = M.layers.shuich;
const seen = new Set();
const ponds = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!water[y * W + x] || seen.has(y * W + x)) continue;
  const cells = [];
  const q = [[x, y]];
  seen.add(y * W + x);
  while (q.length) {
    const [cx, cy] = q.pop();
    cells.push([cx, cy]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && water[ny * W + nx] && !seen.has(ny * W + nx)) {
        seen.add(ny * W + nx); q.push([nx, ny]);
      }
    }
  }
  if (cells.length >= 4) {
    const cx = Math.round(cells.reduce((s, c) => s + c[0], 0) / cells.length);
    const cy = Math.round(cells.reduce((s, c) => s + c[1], 0) / cells.length);
    ponds.push({ size: cells.length, cx, cy, local: [(cx + 0.5) * 100, (H - cy) * 100 - 50] });
  }
}
console.log('水塘:', JSON.stringify(ponds));
// 原版水塘 gid
const gids = {};
for (const v of water) if (v) gids[v] = (gids[v] || 0) + 1;
console.log('shuich gids:', JSON.stringify(gids));

const uname = 'dbg' + Date.now().toString(36).slice(-6);
const pwd = 'dbg!2026';
await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_dbg_p' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', m => { if (m.type() === 'log') logs.push(m.text().slice(0, 200)); });
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
// 1) 入口节点 dump
const entries = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const out = [];
  scene.walk((n) => {
    if (n.group === 'map_passage' || n.name.toLowerCase().includes('passage')) {
      const comps = (n.components || []).map(c => c.constructor.name);
      out.push({ name: n.name, group: n.group, pos: [Math.round(n.x), Math.round(n.y)], parent: n.parent ? n.parent.name : '?', active: n.activeInHierarchy, comps: comps.join(',') });
    }
  });
  return out;
});
console.log('入口节点:', JSON.stringify(entries, null, 1));
// 2) 水塘截图（第一个水塘）
if (ponds.length) {
  const p = ponds[0];
  await page.evaluate(({ x, y }) => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(x, y, 0); }, { x: p.local[0], y: p.local[1] });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_pond.png', type: 'png' });
  console.log('pond screenshot saved @', p.local);
}
console.log('logs:', logs.filter(l => l.includes('[AF]')).slice(-5).join(' | '));
await browser.close();
