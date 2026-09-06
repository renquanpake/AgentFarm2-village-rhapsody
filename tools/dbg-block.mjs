// 调试回滚：检查 boxes/blockWatch + 移动后位置
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(20000);
await page.mouse.click(640, 416); await wait(5000);
await page.mouse.click(640, 224); await wait(12000);
await wait(2000); // 等注入

const before = await page.evaluate(() => ({
  boxes: window.__AF_BLOCK_BOXES__ ? window.__AF_BLOCK_BOXES__.length : null,
  pos: (() => { const m = window.__AF_MODS__; const n = m.Application.exports.default.getIns().playerNode; return { x: Math.round(n.x), y: Math.round(n.y) }; })(),
}));
console.log('before:', JSON.stringify(before));
// 向右走 4 秒（应被树篱右墙挡在 x≈8925）
await page.keyboard.down('d'); await wait(4000); await page.keyboard.up('d');
await wait(1000);
const after = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  const n = m.Application.exports.default.getIns().playerNode;
  return { x: Math.round(n.x), y: Math.round(n.y) };
});
console.log('after:', JSON.stringify(after));
await browser.close();
