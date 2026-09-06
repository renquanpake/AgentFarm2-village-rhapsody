// 验证新玩家出生在村扩展区 + 房子碰撞阻挡
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(20000);
await page.mouse.click(640, 416); await wait(5000);
await page.mouse.click(640, 224); await wait(12000); // 进世界（村扩展区）

const state = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  const node = m.Application.exports.default.getIns().playerNode;
  return {
    pos: { x: Math.round(node.getPosition().x), y: Math.round(node.getPosition().y) },
    spawns: !!(window.__AF_SPAWNS__),
    colliders: !!window.__AF_COLLIDERS_DONE__,
  };
});
console.log('出生状态:', JSON.stringify(state));
await page.screenshot({ path: 'D:\\agent社区\\AgentFarm2\\_spawn_v.png' });

// 碰撞测试：按 d 向右走 3 秒，位置应该被房子/树篱挡（如果出生点附近有障碍）
const before = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  const node = m.Application.exports.default.getIns().playerNode;
  return { x: Math.round(node.getPosition().x), y: Math.round(node.getPosition().y) };
});
await page.keyboard.down('d'); await wait(2500); await page.keyboard.up('d');
const after = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  const node = m.Application.exports.default.getIns().playerNode;
  return { x: Math.round(node.getPosition().x), y: Math.round(node.getPosition().y) };
});
console.log('碰撞测试 移动前:', JSON.stringify(before), '移动后:', JSON.stringify(after), '位移:', after.x - before.x, after.y - before.y);
console.log('--- logs ---');
logs.slice(-20).forEach(l => console.log(l));
await browser.close();
