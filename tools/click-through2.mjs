// v2: 主菜单 -> 输入名字弹窗 -> 确定 -> 进游戏
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://127.0.0.1:8090/';
const NAME = process.argv[3] || '测试员';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(22000); // 主菜单

// 1) 点"开始游戏"（主菜单四个按钮, 之前验证 y≈330-410 附近有效）
for (const y of [340, 380, 420]) {
  await page.mouse.click(640, y);
  await wait(3000);
  const hasInput = await page.evaluate(() => {
    const els = document.querySelectorAll('input');
    return Array.from(els).some(el => el.id !== 'af-chat-input' && getComputedStyle(el).display !== 'none');
  });
  if (hasInput) { console.log('输入框出现, 点击 y=' + y); break; }
}
// 2) 输入名字
const inputInfo = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('input')).filter(el => el.id !== 'af-chat-input' && getComputedStyle(el).display !== 'none');
  const el = els[0];
  return el ? { tag: el.tagName, placeholder: el.placeholder, x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height } : null;
});
console.log('INPUT: ' + JSON.stringify(inputInfo));
if (inputInfo) {
  await page.click('input');
  await wait(500);
  await page.keyboard.type(NAME, { delay: 60 });
  await wait(800);
} else {
  // Cocos 自绘输入框: 点输入框区域后键盘输入
  await page.mouse.click(640, 380);
  await wait(300);
  await page.keyboard.type(NAME, { delay: 60 });
  await wait(800);
}
// 3) 点确定 (640, 448)
await page.mouse.click(640, 448);
await wait(6000);
// 4) 检查是否还有弹窗, 再点一次确定(若有)
const stillInput = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('input')).filter(el => el.id !== 'af-chat-input' && getComputedStyle(el).display !== 'none');
  return els.length > 0;
});
if (stillInput) { await page.mouse.click(640, 448); await wait(6000); }
await page.screenshot({ path: 'D:\\agent社区\\AgentFarm2\\_entered.png' });

const state = await page.evaluate(() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  return {
    entered: keys.some(k => /^(playerData|knapData|attributeData)_/.test(k)),
    keys: keys.filter(k => !k.startsWith('af_')).slice(0, 30),
  };
});
console.log('STATE: ' + JSON.stringify(state, null, 1));
console.log('ELAPSED: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('--- logs ---');
logs.slice(0, 60).forEach(l => console.log(l));
await browser.close();
