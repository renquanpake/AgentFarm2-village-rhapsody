// 点击"开始游戏"进入世界：从 y=300 向下逐步点击菜单按钮，检测进入游戏的存档特征
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://127.0.0.1:8090/';
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
await new Promise(r => setTimeout(r, 20000)); // 等主菜单

const hasEntered = async () => page.evaluate(() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  return keys.some(k => /^(playerData|knapData|attributeData)_/.test(k));
});

let entered = false;
for (const y of [330, 370, 410, 450, 490, 530, 570, 610, 650]) {
  if (await hasEntered()) { entered = true; break; }
  await page.mouse.click(640, y, { clickCount: 1 });
  await new Promise(r => setTimeout(r, 4500));
  if (await hasEntered()) { entered = true; break; }
  await page.screenshot({ path: `D:\\agent社区\\AgentFarm2\\_step_${y}.png` });
}
await new Promise(r => setTimeout(r, 8000));
await page.screenshot({ path: 'D:\\agent社区\\AgentFarm2\\_after.png' });
console.log('ENTERED: ' + (await hasEntered()));
console.log('ELAPSED: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('--- logs ---');
logs.slice(0, 60).forEach(l => console.log(l));
await browser.close();
