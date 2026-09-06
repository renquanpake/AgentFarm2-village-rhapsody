// _dbg-social.mjs —— 双账号实机验证社交系统：对话/送礼/好感/绑定/传送/任务
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function newPlayer(tag) {
  const uname = tag + Date.now().toString(36).slice(-6);
  const pwd = 'soc!2026';
  await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
  const login = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: pwd }) })).json();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: 'D:/agent社区/AgentFarm2/_dbg_p' + Date.now().toString(36), args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const logs = [];
  page.on('console', m => { if (m.type() === 'log' || m.type() === 'warn') logs.push(m.text().slice(0, 250)); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, uid }) => { localStorage.setItem('af_token', token); localStorage.setItem('af_uid', String(uid)); localStorage.setItem('af_nick', 't'); }, { token: login.token, uid: login.uid });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 10000));
  const hasWorldNow = () => page.evaluate(() => { const ins = window.__AF_MODS__?.Application?.exports?.default?.getIns?.(); const n = ins?.playerNode; return !!(n && n.x && n.y); });
  let hasWorld = false;
  for (let attempt = 0; attempt < 6 && !hasWorld; attempt++) {
    const onMenu = await page.evaluate(() => { const scene = cc.director.getScene(); let f = false; scene.walk((n) => { if (!f && n.activeInHierarchy) { const l = n.getComponent && n.getComponent(cc.Label); if (l && /^开始游戏$/.test(l.string)) f = true; } }); return f; });
    if (onMenu) {
      await page.mouse.click(720, 468); await new Promise(r => setTimeout(r, 5000));
      await page.mouse.click(720, 252); await new Promise(r => setTimeout(r, 5000));
    }
    for (let i = 0; i < 8 && !hasWorld; i++) { await new Promise(r => setTimeout(r, 4000)); hasWorld = await hasWorldNow(); }
  }
  console.log(tag, 'in world:', hasWorld, 'nick:', uname);
  return { page, browser, logs, uname, uid: login.uid, token: login.token, hasWorld };
}

const A = await newPlayer('alice');
const B = await newPlayer('bob');
if (!A.hasWorld || !B.hasWorld) { console.log('world fail'); process.exit(1); }
await new Promise(r => setTimeout(r, 3000));
// 两人传送到同一地点（村庄北带空旷处）
for (const P of [A, B]) {
  await P.page.evaluate(() => { window.__AF_MODS__.Application.exports.default.getIns().playerNode.setPosition(6800, 10000, 0); });
}
await new Promise(r => setTimeout(r, 2500));
// B 的背包：先通过 A 侧命令给 A 加物品？——送礼需要背包有物品。用服务器 agent 通道给 A 加木材：直接调用 buy？简化：通过 social 测试前先给 A 加物品——用 agent act buy（需要金币）——A 初始金币 200，买木材 id=18？木材在商店吗？SHOP_TABLE 木匠 6: 18 木材 ✓。通过 /agent 通道操作复杂。
// 更简单：服务器内部直接给 A 背包加木材（临时 API 没有）——用 agent WS 连接买：
// 先测对话/好感/绑定（不需要物品），送礼用"金币 id=1"？——id=1 是金币（knapData props id=1 金币）——送礼送金币？可以！A 给 B 送金币 50。

// 1) 对话：A 对 B 说话
await A.page.evaluate(({ bname }) => {
  const mods = window.__AF_MODS__;
  mods.Application.exports.default.getIns(); // ensure
  // 直接通过 mod 的 WS：找到 remotePlayers 里的 bob
  const rp = window.__AF__.remotePlayers;
  let target = null;
  for (const [uid2, p] of rp) if (p.nick === bname) target = uid2;
  window.__AF_TEST_TARGET__ = target;
  return target;
}, { bname: B.uname });
const t1 = await A.page.evaluate(() => {
  const target = window.__AF_TEST_TARGET__;
  if (!target) return 'no target found';
  // 通过聊天命令 /give 需要名字——社交直接发 WS？mod 没有暴露 sendSocial……用聊天框输入 /fav
  const input = document.getElementById('af-chat-input');
  input.style.display = 'block';
  input.value = '/fav ' + target;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 'sent /fav';
});
console.log('A→B /fav 发送:', t1);
await new Promise(r => setTimeout(r, 2000));
const favLogA = await A.page.evaluate(() => { const box = document.getElementById('af-chat'); return box ? box.innerText.slice(-400) : ''; });
console.log('A 侧聊天框:', JSON.stringify(favLogA.slice(0, 300)));
console.log('A logs:', A.logs.filter(l => l.includes('[AF]') || l.includes('social')).slice(-5).join(' | '));
// 服务器日志验证（通过 world.json 检查 socialData）
const w = JSON.parse(require('node:fs').readFileSync('D:/agent社区/AgentFarm2/data/world.json', 'utf8'));
const sd = w.datas.find(d => d.key === 'socialData');
console.log('socialData:', sd ? JSON.stringify(sd.val).slice(0, 300) : '(无)');
await A.browser.close();
await B.browser.close();
process.exit(0);
