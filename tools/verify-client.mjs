// 验证客户端加载：打开游戏页 → 收集 console → 截图 → 检查 localStorage 与 AF 注入层
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:8090/';
const SHOT = process.argv[3] || 'D:\\agent社区\\AgentFarm2\\_verify.png';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const WAIT_MS = Number(process.argv[4] || 30000);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText || ''}`));

const t0 = Date.now();
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, WAIT_MS));
  await page.screenshot({ path: SHOT });
  const state = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && !k.startsWith('af_')) keys.push(k);
    }
    return {
      hasCanvas: !!document.getElementById('GameCanvas'),
      canvasVisible: (() => { const c = document.getElementById('GameCanvas'); return c ? getComputedStyle(c).visibility : 'no-canvas'; })(),
      splashDisplay: getComputedStyle(document.getElementById('splash')).display,
      afReady: !!(window.__AF__),
      afUid: window.__AF__ ? window.__AF__.uid : null,
      localStorageKeys: keys.slice(0, 40),
      title: document.title,
    };
  });
  console.log('STATE: ' + JSON.stringify(state, null, 1));
} catch (e) {
  console.log('ERROR: ' + e.message);
}
console.log('--- console logs (' + (Date.now() - t0) + 'ms) ---');
logs.slice(0, 80).forEach(l => console.log(l));
if (logs.length > 80) console.log('... 共 ' + logs.length + ' 条');
await browser.close();
