// 登录 → 进世界 → 各宅基地截图（新地图视觉验证）
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(4000);

// 注册
const uname = 'v' + Date.now().toString(36).slice(-5);
await page.type('#af-user', uname);
await page.type('#af-pass', 'pass1234');
await page.click('#af-login-btn');
console.log('注册账号:', uname);
await wait(8000);
const st = await page.evaluate(() => ({
  uid: window.__AF__ ? window.__AF__.uid : null,
  token: !!localStorage.getItem('af_token'),
  loginGone: !document.getElementById('af-login'),
}));
console.log('登录状态:', JSON.stringify(st));

// 进游戏
await page.mouse.click(640, 416); await wait(5000);
await page.mouse.click(640, 224); await wait(12000);
await wait(2000);
let world = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  if (!m || !m.Application) return null;
  const n = m.Application.exports.default.getIns().playerNode;
  return { x: Math.round(n.x), y: Math.round(n.y) };
});
if (!world) { console.log('未进世界，尝试再点一次槽位'); await page.mouse.click(640, 224); await wait(8000); world = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  if (!m || !m.Application) return null;
  const n = m.Application.exports.default.getIns().playerNode;
  return { x: Math.round(n.x), y: Math.round(n.y) };
}); }
console.log('进世界:', JSON.stringify(world));
if (!world) { console.log('--- logs tail ---'); logs.slice(-25).forEach(l => console.log(l)); await browser.close(); process.exit(1); }

// 各宅基地截图
const spawns = JSON.parse(readFileSync('D:/agent社区/AgentFarm2/data/spawn-points.json', 'utf8'));
for (const h of spawns.houses) {
  await page.evaluate((door) => {
    const m = window.__AF_MODS__;
    m.Application.exports.default.getIns().playerNode.setPosition(door.x, door.y, 0);
  }, h.door);
  await wait(1600);
  await page.screenshot({ path: `D:\\agent社区\\AgentFarm2\\_v2_lot_${h.id}.png` });
  console.log(`shot lot#${h.id}`);
}
// 原版村中心参照
await page.evaluate(() => {
  const m = window.__AF_MODS__;
  m.Application.exports.default.getIns().playerNode.setPosition(3500, 3000, 0);
});
await wait(1600);
await page.screenshot({ path: 'D:\\agent社区\\AgentFarm2\\_v2_village_center.png' });
console.log('--- logs tail ---');
logs.slice(-15).forEach(l => console.log(l));
await browser.close();
