// 单步点击工具: 打开页面 -> 等 LOAD_MS -> 依次点击坐标列表 -> [可选: 输入文本] -> 截图
// 用法: node click-one.mjs "640,416 640,224" [--type 文本] [--load 20000] [--wait 5000] [--shot 路径]
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:8080/';
const args = process.argv.slice(2);
const points = String(args[0] || '640,416').split(' ').map(s => { const [x, y] = s.split(',').map(Number); return { x, y }; });
const typeText = (args.indexOf('--type') >= 0) ? args[args.indexOf('--type') + 1] : null;
const loadMs = Number((args.indexOf('--load') >= 0) ? args[args.indexOf('--load') + 1] : 20000);
const waitMs = Number((args.indexOf('--wait') >= 0) ? args[args.indexOf('--wait') + 1] : 5000);
const shot = (args.indexOf('--shot') >= 0) ? args[args.indexOf('--shot') + 1] : 'D:\\agent社区\\AgentFarm2\\_step.png';

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, loadMs));

for (const p of points) {
  await page.mouse.click(p.x, p.y);
  await new Promise(r => setTimeout(r, waitMs));
}
if (typeText) {
  const info = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('input,textarea')).map((el, i) => ({
      i, id: el.id, cls: el.className, ph: el.placeholder,
      d: getComputedStyle(el).display, o: getComputedStyle(el).opacity,
      r: el.getBoundingClientRect().toJSON(),
    }));
    return els;
  });
  console.log('INPUTS: ' + JSON.stringify(info));
  await page.keyboard.type(typeText, { delay: 50 });
  console.log('typed: ' + typeText);
  await new Promise(r => setTimeout(r, 1500));
}
await page.screenshot({ path: shot });

const state = await page.evaluate(() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  return {
    hasPlayerData: keys.some(k => /^playerData_\d+$/.test(k) && localStorage.getItem(k).includes('nickName')),
    keys: keys.filter(k => !k.startsWith('af_')).slice(0, 25),
  };
});
console.log('STATE: ' + JSON.stringify(state));
console.log('SHOT: ' + shot);
console.log('--- logs ---');
logs.slice(0, 40).forEach(l => console.log(l));
await browser.close();
