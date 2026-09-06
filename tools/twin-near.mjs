// A 走近 B，验证 B 画面出现两个角色（自己 + A 的远程节点）
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
await wait(4000); // 等双方 join + move 就绪

// A 向右走 1.5 秒再向左走回（制造移动+回位）
await A.page.keyboard.down('d'); await wait(1500); await A.page.keyboard.up('d');
await A.page.keyboard.down('a'); await wait(1500); await A.page.keyboard.up('a');
await wait(2500);

const aPos = await A.page.evaluate(() => {
  const m = window.__AF_MODS__;
  const node = m.Application.exports.default.getIns().playerNode;
  return { x: Math.round(node.getPosition().x), y: Math.round(node.getPosition().y) };
});
const bRemote = await B.page.evaluate(() => Array.from(window.__AF__.remotePlayers.entries()));
console.log('A 位置:', JSON.stringify(aPos));
console.log('B 视角的 A:', JSON.stringify(bRemote));

await B.page.screenshot({ path: 'D:\\agent社区\\AgentFarm2\\_twin_near_B.png' });
// B 端节点有效性
const nodeInfo = await B.page.evaluate(() => {
  const out = [];
  for (const [uid2, n] of (window.__AF_REMOTE_NODES__ || [])) { /* placeholder */ }
  return out;
});
await browser.close();
console.log('done');
