// _dbg-final2.mjs —— 第二轮综合验证：入口对齐/全图栅栏/水塘沙岸/原版区走动
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
const L = 28, T = 28;
const lx = tx => tx * 100 + 50, ly = ty => (H - ty) * 100 - 50;
// 原版区栅栏格（非路上）
const origFence = [];
for (let y = T; y < T + 61; y++) for (let x = L; x < L + 77; x++) {
  if ((M.layers.mulan[y * W + x] || M.layers.mulan2[y * W + x]) && M.layers.caodi[y * W + x] !== 0 && !M.layers.shilu[y * W + x]) origFence.push([x, y]);
}
console.log(`原版区栅栏(非路) ${origFence.length} 格`);

const uname = 'dbg' + Date.now().toString(36).slice(-6);
const pwd = 'dbg!2026';
await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_dbg_p' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', m => { if (m.type() === 'log' || m.type() === 'warn') logs.push(m.text().slice(0, 200)); });
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
await new Promise(r => setTimeout(r, 3000));

// 1) 入口对齐检查
const entries = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const out = [];
  scene.walk((n) => {
    if (n.group === 'map_passage' && n.parent && n.parent.name === 'passage') out.push([n.name, Math.round(n.x), Math.round(n.y)]);
  });
  return out;
});
console.log('入口节点(修正后):', JSON.stringify(entries));
const shifted = entries.every(([, x, y]) => x >= 2800 || y >= 2800);
console.log(shifted ? 'PASS 入口已全部平移对齐' : 'FAIL 入口未对齐');

// 2) 原版区栅栏阻挡测试
const walk = async (name, x, y, dirKey, expect) => {
  const dirMap = { LEFT: 2, RIGHT: 5, UP: 10, DOWN: 11 };
  await page.evaluate(({ x, y }) => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(x, y, 0); }, { x, y });
  await new Promise(r => setTimeout(r, 900));
  const start = await page.evaluate(() => { const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode; return [n.x, n.y]; });
  await page.evaluate(({ dir }) => {
    const mods = window.__AF_MODS__;
    const node = mods.Application.exports.default.getIns().playerNode;
    const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports;
    const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem');
    item.changeDir(dir, false);
  }, { dir: dirMap[dirKey] });
  await new Promise(r => setTimeout(r, 1600));
  const after = await page.evaluate(() => { const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode; return [n.x, n.y]; });
  await page.evaluate(() => { const mods = window.__AF_MODS__; const node = mods.Application.exports.default.getIns().playerNode; const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports; const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem'); item.changeDir(0, false); });
  const dist = Math.round(Math.hypot(after[0] - start[0], after[1] - start[1]));
  const ok = expect === 'block' ? dist < 120 : dist >= 120;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${expect}] ${name}: dist=${dist}${dist < 120 ? ' <<挡' : ''}`);
};
if (origFence.length) {
  const [fx, fy] = origFence[Math.floor(origFence.length / 2)];
  // 从栅栏南侧往北撞（栅栏在南→选北侧往南撞? 通用：从西往东撞）
  await walk(`原版区栅栏 ${fx},${fy} 向西撞`, lx(fx) + 160, ly(fy), 'LEFT', 'block');
}
// 原版区自由走动（广场东行）
await walk('原版广场 向东', 6500, 3850, 'RIGHT', 'free');
// 原版区田野（非栅栏处）
await walk('原版区田野 向东', 6000, 3000, 'RIGHT', 'free');

// 3) 水塘沙岸截图（站北岸）
await page.evaluate(() => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(3350, 6850, 0); });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_pond3.png', type: 'png' });
console.log('pond3 saved');

console.log('\nlogs:', logs.filter(l => l.includes('[AF]')).slice(-8).join(' | '));
await browser.close();
