// 双窗口联机测试：两个独立上下文同时进同一世界，验证 uid 隔离 + 聊天互通
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:8090/';
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'],
});
const wait = ms => new Promise(r => setTimeout(r, ms));

async function openPlayer(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(20000); // 主菜单
  await page.mouse.click(640, 416); // 开始游戏
  await wait(5000);
  await page.mouse.click(640, 224); // 槽位1
  await wait(12000); // 进世界
  const state = await page.evaluate(() => ({
    uid: window.__AF__ ? window.__AF__.uid : null,
    hasPlayerData: (() => { for (let i = 0; i < localStorage.length; i++) if (/^playerData_\d+$/.test(localStorage.key(i))) return true; return false; })(),
  }));
  return { ctx, page, logs, state, name };
}

console.log('=== 玩家A 进入 ===');
const A = await openPlayer('A');
console.log('A:', JSON.stringify(A.state));
console.log('=== 玩家B 进入 ===');
const B = await openPlayer('B');
console.log('B:', JSON.stringify(B.state));

// 聊天互通：A 发 → B 收
const beforeB = await B.page.evaluate(() => (document.querySelector('#af-chat') || { childElementCount: 0 }).childElementCount);
await A.page.evaluate(() => window.__AF_CHAT__.send('你好我是玩家A'));
await wait(3000);
const afterB = await B.page.evaluate(() => {
  const box = document.querySelector('#af-chat');
  const lines = box ? Array.from(box.children).map(d => d.textContent) : [];
  return lines;
});
console.log('B 收到聊天: ' + JSON.stringify(afterB));

// 存档隔离验证：A 写入自己的私有 key 变化，B 不受影响（检查各自 uid）
const aUid = A.state.uid, bUid = B.state.uid;
console.log('uid 不同: ' + (aUid !== bUid) + ' (' + aUid + ' vs ' + bUid + ')');

// 服务器在线状态（D18 起 /af/players 需 token：用 A 的玩家 token）
const onlineTok = (A.state && A.state.token) || process.env.AF_TOKEN || '';
const online = await (await fetch('http://127.0.0.1:8080/af/players' + (onlineTok ? `?token=${encodeURIComponent(onlineTok)}` : ''))).json();
console.log('服务器在线: ' + JSON.stringify(online));

await A.page.screenshot({ path: 'D:\\agent社区\\AgentFarm2\\_twinA.png' });
await B.page.screenshot({ path: 'D:\\agent社区\\AgentFarm2\\_twinB.png' });
console.log('=== A logs (tail) ===');
A.logs.slice(-12).forEach(l => console.log(l));
console.log('=== B logs (tail) ===');
B.logs.slice(-12).forEach(l => console.log(l));
await browser.close();
