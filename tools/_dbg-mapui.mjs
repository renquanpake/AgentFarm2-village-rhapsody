// _dbg-mapui.mjs —— 进村庄后 dump 小地图/大地图 UI 结构
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'mp' + Date.now().toString(36).slice(-6);
const pwd = 'mp!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_mp' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 18000));
// 点开始游戏
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
if (btn) { await page.mouse.click(btn.x, btn.y); console.log('clicked start'); }
await new Promise(r => setTimeout(r, 12000));
const out = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const maps = [];
  scene.walk((n, d) => {
    const nm = n.name || '';
    if (/Map|map|地图/.test(nm) || d < 3) {
      const label = n.getComponent && n.getComponent(cc.Label);
      maps.push({ d, n: nm, l: label ? label.string.slice(0, 16) : '', active: n.activeInHierarchy });
    }
  });
  // 找玩家节点
  let player = null;
  scene.walk((n) => { if (!player && /Player|player|hero|Hero/.test(n.name)) player = { name: n.name, x: n.position?.x, y: n.position?.y, active: n.activeInHierarchy }; });
  const ins = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
  return { maps: maps.slice(0, 80), player, insPlayer: ins?.playerNode ? { n: ins.playerNode.name, x: ins.playerNode.x, y: ins.playerNode.y } : null, uiMapActive: !!document.querySelector('canvas') };
});
console.log(JSON.stringify(out, null, 1));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_mapui.png' });
await browser.close();
