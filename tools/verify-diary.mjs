// 验证日记按钮 + 面板
import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(4000);
// 登录（已有 token 自动登录；没有则注册）
const hasLogin = await page.evaluate(() => !!document.getElementById('af-login'));
if (hasLogin) {
  await page.type('#af-user', 'v' + Date.now().toString(36).slice(-5));
  await page.type('#af-pass', 'pass1234');
  await page.click('#af-login-btn');
  await wait(8000);
}
await wait(2000);
// 进世界
await page.mouse.click(640, 416); await wait(5000);
await page.mouse.click(640, 224); await wait(12000);
await wait(2000);
// 日记按钮
const btnInfo = await page.evaluate(() => {
  const b = document.getElementById('af-diary-btn');
  return b ? { exists: true, text: b.textContent } : { exists: false };
});
console.log('日记按钮:', JSON.stringify(btnInfo));
if (btnInfo.exists) {
  await page.click('#af-diary-btn');
  await wait(1500);
  await page.screenshot({ path: 'D:\\agent社区\\AgentFarm2\\_diary_panel.png' });
  const panel = await page.evaluate(() => {
    const p = document.getElementById('af-diary');
    return { display: getComputedStyle(p).display, listItems: p.querySelectorAll('.it').length, empty: !!p.querySelector('.empty') };
  });
  console.log('日记面板:', JSON.stringify(panel));
}
await browser.close();
