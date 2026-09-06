// _dbg-cam.mjs —— 屏幕→世界坐标换算，定位亮线所在格
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_cm' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 6000));
// 传送到 west_door8 位置
await page.evaluate(() => {
  const ins = window.__AF_MODS__.Application.exports.default.getIns();
  ins.playerNode.setPosition(1200, 2800, 0);
});
await new Promise(r => setTimeout(r, 2500));
const out = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const cam = scene.getChildByName('MapCamera')?.getComponent(cc.Camera);
  const ins = window.__AF_MODS__.Application.exports.default.getIns();
  const pn = ins.playerNode;
  const res = { player: { x: Math.round(pn.x), y: Math.round(pn.y) } };
  if (cam) {
    // 屏幕坐标 → 世界坐标（MapCamera）
    for (const sx of [540, 720, 920]) {
      const w = cam.screenToWorld(new cc.Vec2(sx, 450));
      res['screen' + sx] = { x: Math.round(w.x), y: Math.round(w.y) };
    }
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_cam.png' });
await browser.close();
