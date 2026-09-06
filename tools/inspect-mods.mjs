import puppeteer from 'puppeteer-core';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://127.0.0.1:8090/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 25000));
const info = await page.evaluate(() => {
  const mods = window.__AF_MODS__;
  const out = {};
  for (const name of ['Application', 'PlayerMoudle', 'GameManager', 'SdkManager', 'WebApi', 'GameData', 'NpcMoudle', 'ConfigureHelper']) {
    const m = mods[name];
    if (!m) { out[name] = 'MISSING'; continue; }
    const keys = Object.keys(m);
    const dk = m.default ? Object.keys(m.default) : null;
    const extra = {};
    if (m._gPlayer) extra._gPlayerKeys = Object.keys(m._gPlayer).slice(0, 25);
    if (m.default && m.default.getIns) {
      try { const ins = m.default.getIns(); extra.insKeys = ins ? Object.keys(ins).slice(0, 30) : null; } catch (e) { extra.insErr = e.message; }
    }
    out[name] = { keys: keys.slice(0, 15), defaultKeys: dk ? dk.slice(0, 15) : null, ...extra };
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
