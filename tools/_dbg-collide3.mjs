// _dbg-collide3.mjs —— 新地图实机验证：水/栅栏/房子阻挡 + 道路畅通 + 旧错误位置不挡
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const BASE = 'http://127.0.0.1:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// 从磁盘读当前 tmx（选测试点位）
const KEY = Buffer.from('qingyoo0316', 'utf8');
const dec = (p) => {
  const buf = readFileSync(p);
  const out = Buffer.allocUnsafe(buf.length - KEY.length);
  for (let i = 0; i < out.length; i++) out[i] = buf[KEY.length + i] ^ KEY[i % KEY.length];
  return JSON.parse(out.toString('utf8'));
};
function loadMap(p) {
  const s = JSON.stringify(dec(p));
  let i = s.indexOf('"daditu"') + 8; while (s[i] !== '"') i++;
  let j = ++i; while (j < s.length) { if (s[j] === '\\') j += 2; else if (s[j++] === '"') break; }
  const xml = JSON.parse(s.slice(i - 1, j));
  const layers = {};
  for (const m of xml.matchAll(/<layer[^>]*name="([^"]+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/g))
    layers[m[1]] = Array.from(new Uint32Array(zlib.inflateSync(Buffer.from(m[2].replace(/\s/g, ''), 'base64')).buffer)).map(v => (v & 0x0fffffff) ? 1 : 0);
  return { W: +xml.match(/width="(\d+)"/)[1], H: +xml.match(/height="(\d+)"/)[1], layers };
}
const M = loadMap('client/assets/resources/import/eb/eb97a692-7760-4a32-b8c2-415ba9cf22e5.96519.json');
const { W, H } = M;
const L = 28, T = 28;
// 本地坐标（y-up 翻转）
const lx = tx => tx * 100 + 50, ly = ty => (H - ty) * 100 - 50;
// 测试点：水面某格、扩展区栅栏格、道路格、房子核心格、旧错误镜像位置
const waterCells = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (M.layers.shuich[y * W + x]) waterCells.push([x, y]);
const fenceCells = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if ((M.layers.mulan[y * W + x] || M.layers.mulan2[y * W + x]) && !(x >= L && x < L + 77 && y >= T && y < T + 61)) {
    if (M.layers.caodi[y * W + x] === 0 || M.layers.shilu[y * W + x]) continue; // 路上的栅栏不挡（mod 同规则）
    fenceCells.push([x, y]);
  }
}
const roadCells = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!(x >= L && x < L + 77 && y >= T && y < T + 61) && M.layers.caodi[y * W + x] === 0) roadCells.push([x, y]);
console.log(`water=${waterCells.length} fenceExt=${fenceCells.length} roadExt=${roadCells.length} 地图${W}x${H}`);
const water = waterCells[Math.floor(waterCells.length / 2)];
const fence = fenceCells.find(([x, y]) => y < 2) || fenceCells[0]; // 外圈栅栏
const fence2 = fenceCells.find(([x, y]) => !(x < 2 || y < 2 || x >= W - 2 || y >= H - 2)) || fenceCells[0]; // 非外圈（镜像带/房屋）
const road = roadCells.find(([x, y]) => x >= L + 10 && x < L + 70 && y >= T + 10 && y < T + 50) || roadCells[0];
// 旧错误位置 = 新房镜像+偏移后的位置（应不挡）
const spawns = JSON.parse(readFileSync('data/spawn-points.json', 'utf8'));
const house2 = spawns.houses.find(h => h.id === 2).rect;

const uname = 'dbg' + Date.now().toString(36).slice(-6);
const pwd = 'dbg!2026';
await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_dbg_p' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('pageerror', e => logs.push(e.message.slice(0, 200)));
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
if (!hasWorld) { console.log('logs:', logs.slice(-12).join('\n')); await browser.close(); process.exit(1); }

const walk = async (name, x, y, dirKey, expect) => {
  await page.evaluate(({ x, y }) => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(x, y, 0); }, { x, y });
  await new Promise(r => setTimeout(r, 700));
  const before = await page.evaluate(() => { const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode; return [n.x, n.y]; });
  const dirMap = { LEFT: 2, RIGHT: 5, UP: 10, DOWN: 11 };
  await page.evaluate(({ dir }) => {
    const mods = window.__AF_MODS__;
    const node = mods.Application.exports.default.getIns().playerNode;
    const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports;
    const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem');
    item.changeDir(dir, false);
  }, { dir: dirMap[dirKey] });
  await new Promise(r => setTimeout(r, 1500));
  const after = await page.evaluate(() => { const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode; return [n.x, n.y]; });
  await page.evaluate(() => { const mods = window.__AF_MODS__; const node = mods.Application.exports.default.getIns().playerNode; const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports; const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem'); item.changeDir(0, false); });
  const dx = Math.round(after[0] - before[0]), dy = Math.round(after[1] - before[1]);
  const dist = Math.round(Math.hypot(dx, dy));
  const ok = expect === 'block' ? dist < 120 : dist >= 120;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${expect}] ${name}: Δ(${dx},${dy}) dist=${dist}${dist < 120 ? ' <<挡' : ''}`);
};

// 1) 水面：站在水格西侧往东走（应被挡）
{
  const [wx, wy] = water;
  await walk(`水面 ${wx},${wy}（往东入水）`, lx(wx) - 160, ly(wy), 'RIGHT', 'block');
}
// 2) 扩展区栅栏（外圈/镜像带/房圈）：从南往北撞
{
  const [fx, fy] = fence;
  await walk(`栅栏 ${fx},${fy}（从南往北）`, lx(fx), ly(fy) - 160, 'UP', 'block');
}
// 3) 扩展区栅栏（非外圈）
if (fence2 && fence2[0] !== fence[0]) {
  const [fx, fy] = fence2;
  await walk(`栅栏(内) ${fx},${fy}（从南往北）`, lx(fx), ly(fy) - 160, 'UP', 'block');
}
// 4) 扩展区道路：沿路走（应畅通）
{
  const [rx, ry] = road;
  await walk(`道路 ${rx},${ry}（往东）`, lx(rx), ly(ry), 'RIGHT', 'free');
}
// 5) 房子#2：站在门口下方往北走进房（应被挡）—— 门在 (37,25) TMX → 本地 (3750, (117-25)*100-50=9150)
{
  const doorLocal = [lx(37), ly(25)];
  await walk(`房#2 门 (37,25) 往北进房`, doorLocal[0], doorLocal[1] + 160, 'UP', 'block');
}
// 6) 旧错误位置（Y 镜像+偏移后的位置，应畅通不挡）
{
  const r = house2; // TMX rect {32,15,10,9}
  const oldY = (r.y + r.h / 2) * 100; // 旧实现错误 y
  const oldX = (r.x + r.w / 2) * 100 + 960;
  await walk(`旧错位点 (${Math.round(oldX)},${Math.round(oldY)})（应畅通）`, oldX, oldY, 'RIGHT', 'free');
}
console.log('\nlogs:', logs.filter(l => l.startsWith('[AF]')).slice(-10).join(' | '));
await browser.close();
