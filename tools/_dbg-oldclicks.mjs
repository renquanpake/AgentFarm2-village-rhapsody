// _dbg-oldclicks.mjs —— 复现早上成功的点击流程
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_review_oc' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', m => { const t = m.text(); logs.push(t.slice(0, 150)); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));
await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', uid); localStorage.setItem('af_nick', 'test3'); }, { token: login.token, uid: login.uid });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 16000));
await page.mouse.click(720, 468);
await new Promise(r => setTimeout(r, 5000));
await page.mouse.click(720, 252);
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const st = await page.evaluate(() => {
    const app = window.__AF_MODS__?.Application?.exports?.default?.getIns?.();
    const pn = app && app.playerNode;
    const scene = cc.director.getScene();
    let memoir = false;
    scene.walk((n) => { if (!memoir && n.activeInHierarchy) { const b = n.getComponent && n.getComponent(cc.Button); if (b && /^btnClose$/.test(n.name)) memoir = true; } });
    return { player: pn ? { x: Math.round(pn.x), y: Math.round(pn.y) } : null, memoir };
  });
  console.log('t+' + (i + 1) * 5 + 's', JSON.stringify(st));
  if (st.player) break;
}
console.log('--- logs ---');
for (const l of logs.filter(x => /GAMEINFO|AF|Error|error/.test(x)).slice(-12)) console.log(l);
await page.screenshot({ path: 'D:/agent社区/AgentFarm2/_dbg_oldclicks.png' });
await browser.close();
