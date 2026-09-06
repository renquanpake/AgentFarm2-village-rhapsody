// 双玩家移动互见：A 按 D 走动，验证 B 收到位置广播且渲染远程节点
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:8090/';
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'],
});
const wait = ms => new Promise(r => setTimeout(r, ms));

async function openPlayer() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(20000);
  await page.mouse.click(640, 416); await wait(5000);
  await page.mouse.click(640, 224); await wait(12000);
  return { ctx, page, logs };
}

console.log('=== 双玩家进入 ===');
const A = await openPlayer();
const B = await openPlayer();

const aState = await A.page.evaluate(() => ({
  uid: window.__AF__.uid, remote: Array.from(window.__AF__.remotePlayers.entries()),
}));
const bState = await B.page.evaluate(() => ({
  uid: window.__AF__.uid, remote: Array.from(window.__AF__.remotePlayers.entries()),
}));
console.log('A 视角:', JSON.stringify(aState));
console.log('B 视角:', JSON.stringify(bState));

// A 向右走 3 秒
await A.page.keyboard.down('d');
await wait(3000);
await A.page.keyboard.up('d');
await wait(3000);

const afterA = await A.page.evaluate(() => {
  const m = window.__AF_MODS__; if (!m) return null;
  const node = m['Application'] && m['Application'].exports && m['Application'].exports.default.getIns().playerNode;
  return node ? { x: Math.round(node.getPosition().x), y: Math.round(node.getPosition().y) } : null;
});
console.log('A 实际位置:', JSON.stringify(afterA));
const afterB = await B.page.evaluate(() => Array.from(window.__AF__.remotePlayers.entries()));
console.log('B 看到的 A:', JSON.stringify(afterB));

await B.page.screenshot({ path: 'D:\\agent社区\\AgentFarm2\\_twinmove_B.png' });
console.log('=== B logs (tail) ===');
B.logs.slice(-15).forEach(l => console.log(l));
console.log('=== A logs (tail) ===');
A.logs.slice(-10).forEach(l => console.log(l));
await browser.close();
