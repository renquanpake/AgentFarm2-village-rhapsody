#!/usr/bin/env node
// tools/shot-client.mjs —— 真实客户端截图 + 图片理解判读（视觉验证闭环）
//
// 解决的问题：此前所有"验收"都只看服务端数据/协议返回，UI 是否真的把话说清楚
// 没人验证过。本工具把「渲染 → 截图 → 交给视觉模型判读」接成一条命令，
// 让 UI 文案、死路、错位这类只有"眼睛能看出来"的问题也能进自动化回归。
//
// 用法：
//   node tools/shot-client.mjs --url http://127.0.0.1:8097/ --out /tmp/shots/a.png
//   node tools/shot-client.mjs --url ... --out ... --wait 9000 --w 1440 --h 900
//   node tools/shot-client.mjs --url ... --out ... --script /tmp/act.js   # 截图前先执行页面脚本
//   node tools/shot-client.mjs --url ... --out ... --ask "图里有没有引导面板？"   # 截图后顺带判读
//
// --ask 依赖平台图片理解服务（需 AF_VISION_URL 可公网访问）；不给 --ask 就只出图。
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer';

const CHROME = process.env.AF_CHROME
  || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const url = arg('url', 'http://127.0.0.1:8097/');
const out = resolve(arg('out', '/tmp/shots/shot.png'));
const waitMs = Number(arg('wait', 9000));
const W = Number(arg('w', 1440)), H = Number(arg('h', 900));
const scriptFile = arg('script', null);
const ask = arg('ask', null);
const scale = Number(arg('scale', 1));

mkdirSync(dirname(out), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--window-size=${W},${H}`],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => errors.push('goto: ' + e.message));
  if (waitMs) await new Promise(r => setTimeout(r, waitMs));
  if (scriptFile) {
    const code = readFileSync(scriptFile, 'utf8');
    const r = await page.evaluate(code).catch(e => ({ __error: String(e) }));
    if (r !== undefined) console.log('[script]', JSON.stringify(r));
  }
  await page.screenshot({ path: out });
  console.log('[shot]', out, `${W}x${H}`);
  if (errors.length) { console.log('[page-errors]'); for (const e of [...new Set(errors)].slice(0, 12)) console.log('  ' + e); }
} finally {
  await browser.close();
}

// 需要判读时起一个极简静态服务把图暴露出去（预览地址由外部 request_preview 换）
if (ask) {
  const dir = dirname(out);
  const srv = createServer((rq, rs) => {
    const p = decodeURIComponent((rq.url || '/').split('?')[0]).replace(/^\//, '') || out.split('/').pop();
    try { rs.writeHead(200, { 'Content-Type': 'image/png' }); rs.end(readFileSync(resolve(dir, p))); }
    catch { rs.writeHead(404); rs.end(); }
  });
  await new Promise(r => srv.listen(Number(arg('port', 8098)), '0.0.0.0', r));
  console.log('[serve] http://127.0.0.1:' + (arg('port', 8098)) + '/' + out.split('/').pop());
  console.log('[ask]', ask);
  await new Promise(() => {}); // 常驻，等外部取走预览地址后调用判读
}