// _dbg-entry2.mjs —— 验证：对齐后的入口能触发切场景 + 回来时出生点修正
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const uname = 'dbg' + Date.now().toString(36).slice(-6);
const pwd = 'dbg!2026';
await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_dbg_p' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', m => { if (m.type() === 'log' || m.type() === 'warn') logs.push(m.text().slice(0, 250)); });
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
const getScene = () => page.evaluate(() => {
  const PM = window.__AF_MODS__.PlayerMoudle.exports;
  const player = PM._gPlayer || PM.default._gPlayer;
  return { scene: player ? player.getSceneType() : null };
});
const setPos = (x, y) => page.evaluate(({ x, y }) => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(x, y, 0); }, { x, y });
const walkDir = async (dir, ms) => {
  const dirMap = { LEFT: 2, RIGHT: 5, UP: 10, DOWN: 11 };
  await page.evaluate(({ dir }) => {
    const mods = window.__AF_MODS__;
    const node = mods.Application.exports.default.getIns().playerNode;
    const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports;
    const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem');
    item.changeDir(dir, false);
  }, { dir: dirMap[dir] });
  await new Promise(r => setTimeout(r, ms));
  await page.evaluate(() => { const mods = window.__AF_MODS__; const node = mods.Application.exports.default.getIns().playerNode; const PlayerItem = mods.PlayerItem && mods.PlayerItem.exports; const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem'); item.changeDir(0, false); });
};

// 1) 走到 home 入口（已对齐 4650,8095）→ 应该触发切场景
console.log('场景:', JSON.stringify(await getScene()));
await setPos(4650, 8500);
await new Promise(r => setTimeout(r, 800));
await walkDir('UP', 2500); // 向北走进入口
await new Promise(r => setTimeout(r, 3000));
const s1 = await getScene();
console.log('走进入口后场景:', JSON.stringify(s1), s1.scene !== 2 ? '→ 切场景成功!' : '→ 未切换');

// 2) 如果切到了别的场景（HOME=1），找回村庄的入口并走回
if (s1.scene !== 2) {
  await new Promise(r => setTimeout(r, 2500));
  const back = await page.evaluate(() => {
    const scene = cc.director.getScene();
    const out = [];
    scene.walk((n) => {
      if (n.group === 'map_passage') out.push({ name: n.name, x: Math.round(n.x), y: Math.round(n.y), parent: n.parent ? n.parent.name : '?' });
    });
    return out;
  });
  console.log('HOME 场景入口:', JSON.stringify(back));
  // 找非容器的入口节点
  const target = back.find(b => b.parent === 'passage') || back.find(b => b.name !== 'passage') || back[0];
  if (target) {
    await setPos(target.x, target.y - 200);
    await new Promise(r => setTimeout(r, 800));
    await walkDir('UP', 2000);
    await new Promise(r => setTimeout(r, 3000));
    const s2 = await getScene();
    console.log('走回后场景:', JSON.stringify(s2));
    await new Promise(r => setTimeout(r, 3000));
    if (s2.scene === 2) {
      const pos = await page.evaluate(() => { const n = window.__AF_MODS__.Application.exports.default.getIns().playerNode; return [Math.round(n.x), Math.round(n.y)]; });
      const ok = Math.abs(pos[0] - 4630) < 500 && Math.abs(pos[1] - 8630) < 500;
      console.log(`${ok ? 'PASS' : 'FAIL'} 回村庄出生点修正: 位置 ${pos} (期望 ~4630,8630 = 旧 home 入口 1830,5830 + 2800)`);
    }
  }
}
console.log('\nlogs:', logs.filter(l => l.includes('[AF]')).slice(-10).join('\n'));
await browser.close();
