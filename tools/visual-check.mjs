import { chromium } from 'playwright-core';

const BASE = process.env.AF_BASE || 'https://outstanding-spontaneity-production.up.railway.app';
const CHROME = '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';

const cred = { username: process.env.AF_USER || 'deployok01', password: process.env.AF_PASS || 'pass1234' };
let auth = await fetch(BASE + '/af/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred),
}).then(r => r.json()).catch(() => ({}));
if (!auth.token) {
  auth = await fetch(BASE + '/af/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred),
  }).then(r => r.json()).catch(() => ({}));
}
console.log('auth', auth.ok, auth.uid || '', auth.msg || '');

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 180)); });
page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 180)));

// 1) 未登录首屏：确认 mod 已加载，且天气层在进村前为空
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
const pre = await page.evaluate(() => ({
  mod: !!window.__AF_MOD__,
  wx: document.getElementById('af-weather-fx')?.className || 'no-layer',
  inWorld: !!window.__AF_INWORLD__,
  canvases: document.querySelectorAll('canvas').length,
}));
await page.screenshot({ path: '/tmp/opencode/before.png' });
console.log('PRE', JSON.stringify(pre));

// 2) 登录后进村
await page.evaluate(a => {
  localStorage.setItem('af_token', a.token);
  localStorage.setItem('af_uid', a.uid);
  localStorage.setItem('af_nick', a.nick || a.username || 'tester');
}, auth);
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(45000);
const post = await page.evaluate(() => ({
  mod: !!window.__AF_MOD__,
  wx: document.getElementById('af-weather-fx')?.className || 'no-layer',
  inWorld: !!window.__AF_INWORLD__,
  canvases: document.querySelectorAll('canvas').length,
  hud: !!document.querySelector('#af-hud, [id^="af-hud"]'),
  bodyText: (document.body.innerText || '').slice(0, 160),
}));
await page.screenshot({ path: '/tmp/opencode/after.png' });
console.log('POST', JSON.stringify(post));
console.log('ERRORS', JSON.stringify(errors.slice(0, 15)));
await browser.close();