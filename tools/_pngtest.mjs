import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const L = (s) => appendFileSync('/tmp/pngtest.log', s + '\n');
const CHROME = process.env.AF_CHROME || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
const page = await b.newPage();
await page.goto('http://127.0.0.1:8097/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(()=>{});
for (const u of ['0e/0e2b73ea-4e59-45de-9c83-e1c10acaaeb7.a104c.png','63/6310d49a-4b39-444a-860c-6b8e6d9da830.9c7ea.png','aa/aa46e9f3-5f47-48a9-ad37-44cfe6afe4f0.a5f67.png']) {
  const r = await page.evaluate(async (url) => {
    const resp = await fetch(url); const st = resp.status;
    const blob = await resp.blob();
    const ok = await new Promise(res => { const im = new Image(); im.onload = () => res('ok ' + im.width + 'x' + im.height); im.onerror = () => res('decode-fail'); im.src = URL.createObjectURL(blob); });
    return st + ' type=' + blob.type + ' ' + ok;
  }, 'assets/resources/native/' + u);
  L(u + ' -> ' + r);
}
await b.close();
