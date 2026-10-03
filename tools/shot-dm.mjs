// tools/shot-dm.mjs —— 私聊（加好友后远程聊天）双端验收
//
// 为什么要它：私聊是「见过面才解锁」的微信式通道，代码与面板都在，
// 但此前从未实机看过两端 UI 是否真的能用。本脚本用最省的方式验：
//   浏览器只开一个真实客户端（B），A 侧用 WS 协议模拟（省一次原版加载 ~30s）
//   1) A/B 都上线 -> 2) A 上报坐标到 B 身旁 -> 3) A social_talk 解锁私聊
//   4) A dm_send -> 5) 截 B 的气泡 + 私聊面板 + A 的私聊面板（命令侧）
//
// 用法：node tools/shot-dm.mjs --base http://127.0.0.1:8080 --out-dir /tmp/shots/dm
import puppeteer from 'puppeteer';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = process.env.AF_CHROME
  || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const BASE = arg('base', 'http://127.0.0.1:8080').replace(/\/$/, '');
const OUT = arg('out-dir', '/tmp/shots/dm');
const stamp = Date.now().toString(36).slice(-4);
const NAME_A = 'dmA' + stamp;
const NAME_B = 'dmB' + stamp;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const j = async (p, b) => {
  const r = await fetch(BASE + p, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {});
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 120) }; }
};
async function account(name) {
  let r = await j('/af/register', { username: name, password: 'dm_pw_1234' });
  if (!r.token) r = await j('/af/login', { username: name, password: 'dm_pw_1234' });
  return { name, token: r.token, uid: r.uid };
}
const A = await account(NAME_A);
const B = await account(NAME_B);
if (!A.token || !B.token) { console.error('[dm] 备号失败'); process.exit(1); }
console.log(`[dm] A=${NAME_A}(${A.uid})  B=${NAME_B}(${B.uid})`);

// ---------- 浏览器：B 的真实客户端 ----------
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCacheEnabled(false);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)));
await page.evaluateOnNewDocument((c) => {
  localStorage.setItem('af_token', c.token); localStorage.setItem('af_uid', c.uid); localStorage.setItem('af_nick', c.nick);
}, { token: B.token, uid: B.uid, nick: B.name });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
await sleep(14000);
const bOnline = await j(`/af/players?token=${encodeURIComponent(B.token)}`);
const bPos = (bOnline || []).find(p => p.uid === B.uid) || {};
console.log(`[dm] B 在线：scene=${bPos.scene} pos=(${bPos.x},${bPos.y})`);

// ---------- A 侧：协议模拟 ----------
const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`);
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
ws.send(JSON.stringify({ t: 'join', uid: A.uid, nick: A.name, token: A.token }));
await sleep(900);
// 上报位置到 B 身旁（玩家客户端本来就这样做；服务端 socialNear 判定依赖在线坐标）
ws.send(JSON.stringify({ t: 'move', scene: bPos.scene ?? 1, x: (bPos.x ?? 1500) + 150, y: bPos.y ?? 1500 }));
await sleep(700);
// 见面解锁（social_talk 首次见面 -> 双方 dmUnlocked）
ws.send(JSON.stringify({ t: 'social_talk', target: B.name, text: '你好，我是 A' }));
await sleep(900);
const unlocked = await j(`/af/players?token=${encodeURIComponent(A.token)}`);
console.log(`[dm] A 上报后在线：${(unlocked || []).map(p => p.nick).join('/')}`);

// 截图：B 的聊天气泡（应出现 A 的私聊）
const shot = async (name, note) => {
  const f = `${OUT}/${name}.png`;
  await page.screenshot({ path: f });
  const txt = await page.evaluate(() => {
    const chat = [...document.querySelectorAll('#af-chat-scroll .af-bubble')].map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).slice(-8);
    const dm = [...document.querySelectorAll('#af-dm-log .dm-line')].map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).slice(-8);
    return { chat, dm, dmOpen: !!document.getElementById('af-dm') };
  });
  console.log(`[shot] ${name} 气泡=${JSON.stringify(txt.chat).slice(0, 200)}`);
  console.log(`[shot] ${name} 私聊记录=${JSON.stringify(txt.dm).slice(0, 200)}`);
  return txt;
};
await page.evaluate(() => { const b = document.getElementById('af-chat-btn'); if (b) b.click(); }).catch(() => {});
await sleep(1200);
await shot('01-B-chat-after-unlock', 'A 与 B 见面解锁后');

ws.send(JSON.stringify({ t: 'dm_send', target: B.name, text: '在吗？我想问你昨天做了什么' }));
await sleep(1500);
await shot('02-B-dm-received', 'B 收到 A 的私聊');

// 打开私聊面板
const opened = await page.evaluate(() => {
  const btn = document.getElementById('af-dm-btn') || [...document.querySelectorAll('#af-ui-root *')].find(e => (e.innerText || '').trim() === '私聊');
  if (btn) { btn.click(); return true; }
  return false;
});
await sleep(1600);
await shot('03-B-dm-panel', 'B 的私聊面板');

// A 侧：再发一条，确认双向
ws.send(JSON.stringify({ t: 'dm_send', target: B.name, text: '顺便问下，村纪念碑怎么去？' }));
await sleep(1400);
const t3 = await shot('04-B-dm-second', '第二条私聊');
await shot('05-B-final', '最终态');

console.log(`\n[dm] 私聊面板按钮可点：${opened}`);
console.log(`[dm] 页面错误：${errors.length ? errors.slice(0, 3).join(' | ') : '无'}`);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ A: A.name, B: B.name, bPos, opened, errors, chat: t3.chat, dm: t3.dm }, null, 1));
await browser.close();
ws.close();
console.log(`[dm] 截图目录：${OUT}`);