// 视觉质检：遍历每户宅基地截图
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(20000);
await page.mouse.click(640, 416); await wait(5000);
await page.mouse.click(640, 224); await wait(12000);
await wait(2500);
const spawns = JSON.parse(readFileSync('D:/agent社区/AgentFarm2/data/spawn-points.json', 'utf8'));
for (const h of spawns.houses) {
  await page.evaluate((door) => {
    const m = window.__AF_MODS__;
    m.Application.exports.default.getIns().playerNode.setPosition(door.x, door.y, 0);
  }, h.door);
  await wait(1800); // 等相机跟随
  await page.screenshot({ path: `D:\\agent社区\\AgentFarm2\\_lot_${h.id}.png` });
  console.log(`shot lot#${h.id} ${h.type}`);
}
await browser.close();
console.log('done');
