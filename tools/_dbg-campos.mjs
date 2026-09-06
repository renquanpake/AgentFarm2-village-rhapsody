// _dbg-campos.mjs —— 读相机位置校准屏幕映射
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_cp' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 6000));
await page.evaluate(() => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(1200, 2800, 0); });
await new Promise(r => setTimeout(r, 3000));
const out = await page.evaluate(() => {
  const scene = cc.director.getScene();
  const camNode = scene.getChildByName('MapCamera');
  const ins = window.__AF_MODS__.Application.exports.default.getIns();
  const pn = ins.playerNode;
  const res = { player: { x: Math.round(pn.x), y: Math.round(pn.y) }, cam: null, camComp: null };
  if (camNode) {
    const wp = camNode.parent ? camNode.parent.convertToWorldSpaceAR(camNode.position) : null;
    res.cam = { x: Math.round(camNode.x), y: Math.round(camNode.y), world: wp ? { x: Math.round(wp.x), y: Math.round(wp.y) } : null };
    const comps = camNode.components.map(c => c.constructor.name);
    res.camComp = comps;
    const cc2 = camNode.getComponent(cc.Camera);
    if (cc2) {
      const vp = cc2.screenToWorld(new cc.Vec2(720, 450));
      res.centerWorld = { x: Math.round(vp.x), y: Math.round(vp.y) };
      const vp2 = cc2.screenToWorld(new cc.Vec2(540, 450));
      res.x540World = { x: Math.round(vp2.x), y: Math.round(vp2.y) };
    }
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
