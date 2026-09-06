// _dbg-collide.mjs —— 实机诊断：场景物理碰撞体布局 + 玩家阻挡行为测试
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const uname = 'dbg' + Date.now().toString(36).slice(-6);
const pwd = 'dbg!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
if (!login.ok) throw new Error('login: ' + JSON.stringify(login));
console.log('account:', uname, 'uid:', login.uid);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_dbg_p' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('pageerror', e => logs.push(e.message.slice(0, 300)));
page.on('console', m => { if (m.type() === 'log' || m.type() === 'warn') logs.push(m.text().slice(0, 300)); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', String(uid)); localStorage.setItem('af_nick', 'dbg'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 10000));

const hasWorldNow = () => page.evaluate(() => {
  const ins = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
  const n = ins?.playerNode;
  return !!(n && n.x && n.y);
});
let hasWorld = false;
for (let attempt = 0; attempt < 6 && !hasWorld; attempt++) {
  const onMenu = await page.evaluate(() => {
    const scene = cc.director.getScene();
    let f = false;
    scene.walk((n) => { if (!f && n.activeInHierarchy) { const l = n.getComponent && n.getComponent(cc.Label); if (l && /^开始游戏$/.test(l.string)) f = true; } });
    return f;
  });
  if (onMenu) {
    await page.mouse.click(720, 468);
    await new Promise(r => setTimeout(r, 5000));
    await page.mouse.click(720, 252);
    await new Promise(r => setTimeout(r, 5000));
    console.log('menu clicks done');
  }
  const closed = await page.evaluate(() => {
    const scene = cc.director.getScene();
    let hit = null;
    scene.walk((n) => {
      if (hit || !n.activeInHierarchy) return;
      const btnC = n.getComponent && n.getComponent(cc.Button);
      if (btnC && /^btnClose$/i.test(n.name)) hit = n;
    });
    if (!hit) return false;
    try { cc.Component.EventHandler.emitEvents(hit.getComponent(cc.Button).clickEvents, hit); return true; } catch (e) { return false; }
  });
  if (closed) { console.log('closed popup'); await new Promise(r => setTimeout(r, 4000)); }
  for (let i = 0; i < 6 && !hasWorld; i++) { await new Promise(r => setTimeout(r, 4000)); hasWorld = await hasWorldNow(); }
  if (!hasWorld) console.log('attempt', attempt, 'screen:', (await page.evaluate(() => document.body.innerText.slice(0, 100).replace(/\n/g, ' '))));
}
console.log('in world:', hasWorld);
if (!hasWorld) { console.log('logs tail:', logs.slice(-15).join('\n')); await browser.close(); process.exit(1); }

// ===== 1. 场景结构诊断 =====
const diag = await page.evaluate(() => {
  const out = {};
  const ins = window.__AF_MODS__.Application.exports.default.getIns();
  const PM = window.__AF_MODS__.PlayerMoudle.exports;
  const player = PM._gPlayer || PM.default._gPlayer;
  out.sceneType = player ? player.getSceneType() : null;
  const pn = ins.playerNode;
  out.player = pn ? { pos: [pn.x, pn.y], parent: pn.parent && pn.parent.name, group: pn.groupIndex, active: pn.activeInHierarchy } : null;
  const rb = pn && pn.getComponent(cc.RigidBody);
  out.playerRigidBody = rb ? { type: rb.type, allowSleep: rb.allowSleep } : null;
  const pbc = pn && pn.getComponent(cc.PhysicsBoxCollider);
  out.playerPhyBox = pbc ? { size: [pbc.size.width, pbc.size.height], offset: [pbc.offset.x, pbc.offset.y] } : null;
  out.physicsEnabled = (cc.PhysicsSystem2D ? cc.PhysicsSystem2D.instance.enabled : 'n/a');
  const layer = ins.pnlSceneLayer;
  out.pnlSceneLayer = layer ? { pos: [layer.x, layer.y], scale: [layer.scaleX, layer.scaleY], parent: layer.parent && layer.parent.name } : null;
  // 场景内所有物理碰撞体
  const colls = [];
  const scene = cc.director.getScene();
  scene.walk((n) => {
    if (!n.activeInHierarchy) return;
    const comps = n.components || [];
    for (const c of comps) {
      if (c instanceof cc.PhysicsBoxCollider || c instanceof cc.PhysicsPolygonCollider) {
        const wp = n.parent ? n.parent.convertToWorldSpaceAR(n.position) : n.position;
        let size = null, pts = null;
        if (c instanceof cc.PhysicsBoxCollider) size = [c.size.width, c.size.height];
        else if (c.points) pts = c.points.length;
        const rbc = n.getComponent(cc.RigidBody);
        colls.push({ name: n.name, path: n.name, pos: [Math.round(wp.x), Math.round(wp.y)], size, pts, group: n.groupIndex, rb: rbc ? rbc.type : null, enabled: c.enabled });
      }
    }
  });
  out.colliders = colls;
  // mod 注入的阻挡盒
  out.blockBoxes = (window.__AF_BLOCK_BOXES__ || []).slice(0, 30).map(b => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }));
  out.spawnsScene = window.__AF_SPAWNS__ ? window.__AF_SPAWNS__.scene : null;
  out.blockWatchOn = !!window.__AF_BLOCK_CB__;
  return out;
});
console.log('=== 诊断 ===');
console.log(JSON.stringify(diag, null, 1));

// ===== 2. 阻挡行为测试：向水/栅栏方向走 =====
const tests = [
  ['water_west(原版水塘西北 25,34)', 2500, 3400, 'RIGHT'],
  ['fence_west(mirror 栅栏 8,40)', 800, 4000, 'RIGHT'],
  ['fence_east(原版东缘栅栏 92,45)', 9200, 4500, 'LEFT'],
  ['house8(西屋 2,24)', 200, 2400, 'RIGHT'],
];
const walk = async (name, x, y, dirKey) => {
  await page.evaluate(({ x, y }) => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(x, y, 0); }, { x, y });
  await new Promise(r => setTimeout(r, 600));
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
  console.log(`[walk] ${name}: before(${before.map(Math.round)}) after(${after.map(Math.round)}) Δ(${dx},${dy}) dist=${dist} ${dist < 60 ? '<< 被挡' : '通过'}`);
};
for (const t of tests) await walk(...t);

console.log('\nlogs tail:', logs.slice(-25).join('\n'));
await browser.close();
