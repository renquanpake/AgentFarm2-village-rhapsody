// _dbg-playernode.mjs —— 全场景找玩家节点
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const uname = 'pn' + Date.now().toString(36).slice(-6);
const pwd = 'pn!2026';
const reg = await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_pn' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'x'); }, { token: reg.token, uid: reg.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 25000));
const out = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const hits = [];
  scene.walk((n, d) => {
    if (/player|Player|role|Role|hero|Hero|main/i.test(n.name)) hits.push({ d, name: n.name, pos: n.position ? { x: Math.round(n.position.x), y: Math.round(n.position.y) } : null });
  });
  const ins = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
  return {
    hits: hits.slice(0, 40),
    insKeys: ins ? Object.keys(ins).filter(k => /player|role/i.test(k)) : [],
    insPlayer: ins?.playerNode ? { name: ins.playerNode.name, x: ins.playerNode.x, y: ins.playerNode.y } : null,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
