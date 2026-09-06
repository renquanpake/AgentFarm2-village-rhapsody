// 严格阻挡测试：玩家朝自己宅基地的房子走，应被树篱/房子挡住
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
await wait(2500);
const read = () => page.evaluate(() => {
  const m = window.__AF_MODS__;
  const n = m.Application.exports.default.getIns().playerNode;
  return { x: Math.round(n.x), y: Math.round(n.y) };
});
const p0 = await read();
console.log('出生:', JSON.stringify(p0));
// 找到最近的盒子：向最近的盒子方向走
const boxInfo = await page.evaluate(() => {
  const m = window.__AF_MODS__;
  const n = m.Application.exports.default.getIns().playerNode;
  const p = n.getPosition();
  const boxes = window.__AF_BLOCK_BOXES__ || [];
  // 最近盒子
  let best = null, bd = 1e9;
  for (const b of boxes) {
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best ? { x: best.x, y: best.y, w: best.w, h: best.h, d: Math.round(bd) } : null;
});
console.log('最近盒子:', JSON.stringify(boxInfo));
// 朝最近盒子方向走 3 秒
if (boxInfo) {
  const dx = boxInfo.x - p0.x, dy = boxInfo.y - p0.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    await page.keyboard.down(dx > 0 ? 'd' : 'a'); await wait(3000); await page.keyboard.up(dx > 0 ? 'd' : 'a');
  } else {
    await page.keyboard.down(dy > 0 ? 's' : 'w'); await wait(3000); await page.keyboard.up(dy > 0 ? 's' : 'w');
  }
}
await wait(500);
const p1 = await read();
console.log('走后:', JSON.stringify(p1), '位移:', p1.x - p0.x, p1.y - p0.y);
// 判定：如果玩家离盒子距离显著减小且被挡住（位移 < 500px），阻挡有效
await browser.close();
