import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const logs = [];
page.on('console', m => logs.push(m.text()));
await page.goto('http://127.0.0.1:8090/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 25000));
const names = await page.evaluate(() => {
  const mods = window.__AF_MODS__ || {};
  const keys = Object.keys(mods);
  return {
    total: keys.length,
    interesting: keys.filter(k => /Application|Player|GameManager|GameData|Npc|Map|Scene|UiMgr|UiTalk|ConfigureHelper|SdkManager|WebApi|StorageUtil|Talk|Chat/i.test(k)).sort(),
    sample: keys.slice(0, 40),
  };
});
console.log('MODS: ' + JSON.stringify(names, null, 1));
console.log('--- logs ---');
logs.slice(0, 30).forEach(l => console.log(l));
await browser.close();
