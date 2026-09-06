// A 直接 setPosition 到 B 附近，验证 B 画面出现两个角色
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:8090/';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function openPlayer() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(20000);
  await page.mouse.click(640, 416); await wait(5000);
  await page.mouse.click(640, 224); await wait(12000);
  return { ctx, page };
}
const A = await openPlayer();
const B = await openPlayer();
await wait(4000);

// A 传送到 B 附近（离 B 100px）
await A.page.evaluate(() => {
  const m = window.__AF_MODS__;
  const node = m.Application.exports.default.getIns().playerNode;
  node.setPosition(1622, 1663, 0);
});
await wait(2500); // 等 move 广播

const bRemote = await B.page.evaluate(() => Array.from(window.__AF__.remotePlayers.entries()));
console.log('B 视角的 A:', JSON.stringify(bRemote));
await B.page.screenshot({ path: 'D:\\agent社区\\AgentFarm2\\_twin_near2_B.png' });
await browser.close();
console.log('done');
