// 调试：手动把玩家放进盒子，测回滚是否生效
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(20000);
await page.mouse.click(640, 416); await wait(5000);
await page.mouse.click(640, 224); await wait(12000);
await wait(3000);
const r1 = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  const n = m.Application.exports.default.getIns().playerNode;
  const boxes = window.__AF_BLOCK_BOXES__ || [];
  n.setPosition(2950, 550, 0); // 放进树根家右墙盒子
  return { boxes: boxes.length, box: boxes.find(b => Math.abs(b.x - 2950) < 200), set: true };
});
console.log('放入盒子:', JSON.stringify(r1));
await wait(500);
const r2 = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  const n = m.Application.exports.default.getIns().playerNode;
  return { x: Math.round(n.x), y: Math.round(n.y) };
});
console.log('500ms 后位置:', JSON.stringify(r2), '(若回滚生效应回到出生点附近)');
console.log('--- logs tail ---');
logs.slice(-15).forEach(l => console.log(l));
await browser.close();
