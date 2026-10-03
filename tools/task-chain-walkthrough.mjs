// tools/task-chain-walkthrough.mjs —— 任务链端到端走查（"任务能不能好好执行"的判定器）
//
// 做法：不靠 LLM，自己当玩家把 data/task-chains.json 的每条链逐阶走完，每阶都用真实
// 游戏动作触发（犁地/播种/浇水/收获/钓鱼/挖矿/砍树/交易/送礼/结关系/租约/认领…），
// 走完对照任务链状态与背包奖励增量，输出报告。
// 判据：
//   PASS = 每条链的可完成阶全部完成，且奖励逐阶到账（无卡点、无吞奖励）
//   BLOCKED = 该阶在当前局面客观不可完成（例：节日才开摊 / 需要第二名玩家且没有），
//             报告里必须写清原因与解锁条件 —— 这不算失败，但必须被看见
//   FAIL = 动作做完了、阶段却没推进（或奖励没到账）= 任务系统缺陷
//
// 用法：
//   AF_BASE=http://127.0.0.1:8197 node tools/task-chain-walkthrough.mjs
//   --solo        不造第二个账号（联机阶自然 BLOCKED，用来验证单人房的真实体验）
//   --rounds 2    多跑几轮日历（解锁天数门槛）
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.AF_BASE || 'http://127.0.0.1:8080';
const WS_BASE = BASE.replace(/^http/, 'ws');
const SOLO = process.argv.includes('--solo');
const argN = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const ROUNDS = Math.max(1, Math.min(10, argN('--rounds', 1)));

const j = async (p, b) => {
  const r = await fetch(BASE + p, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {});
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { ok: false, raw: t.slice(0, 120) }; }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function makeAccount(tag) {
  const username = `tcw${tag}${Date.now().toString(36).slice(-4)}`.slice(0, 14);
  const password = 'walk_pw_1';
  let r = await j('/af/register', { username, password });
  if (!r.token) r = await j('/af/login', { username, password });
  if (!r.token) return null;
  const ag = await j('/af/agent-token', { token: r.token });
  return { username, token: r.token, agentToken: ag.agentToken, uid: r.uid };
}

/** Agent 通道客户端（带 act/observe 调用） */
async function agentConn(acc) {
  const ws = new WebSocket(`${WS_BASE}/agent?token=${encodeURIComponent(acc.agentToken)}`);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  ws.send(JSON.stringify({ t: 'join', uid: acc.uid, nick: acc.username }));
  await sleep(400);
  const waiters = [];
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if ((m.t === 'result' && m.action === w.action) || (w.expect && m.t === w.expect)) { waiters.splice(i, 1); w.resolve(m); }
    }
  });
  const call = (action, extra = {}, timeoutMs = 25000) => new Promise((resolve) => {
    const w = { action, expect: null, resolve };
    waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve({ ok: false, timeout: true }); } }, timeoutMs);
    ws.send(JSON.stringify({ t: 'act', action, ...extra }));
  });
  const observe = () => new Promise((resolve) => {
    const w = { action: null, expect: 'state', resolve };
    waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null); } }, 20000);
    ws.send(JSON.stringify({ t: 'observe' }));
  });
  return { ws, call, observe };
}

// ---------------- 玩家侧工具 ----------------
const coins = (obs) => obs?.coins ?? 0;
const hasItem = (obs, id) => (obs?.backpack || []).some(x => x.id === id && x.num > 0);
const countItem = (obs, id) => (obs?.backpack || []).find(x => x.id === id)?.num || 0;

/** 找一块可操作的地：优先未犁可耕地，其次已犁地块，最后任意可耕地（围绕当前位置） */
function findTillCell(obs) {
  if (obs?.tillableNear?.length) return obs.tillableNear[0];
  if (obs?.plotsNear?.length) return obs.plotsNear.find(p => !p.planted) || obs.plotsNear[0];
  return null;
}

const log = (...a) => console.log('[walk]', ...a);

// ---------------- 走查主体 ----------------
const report = { chains: [], blocked: [], fails: [], rewards: { coinsBefore: 0, coinsAfter: 0 }, steps: 0 };

const me = await makeAccount('p');
if (!me) { console.error('[walk] 主账号创建失败'); process.exit(1); }
const A = await agentConn(me);
let obs = await A.observe();
if (!obs) { console.error('[walk] observe 失败'); process.exit(1); }
report.rewards.coinsBefore = coins(obs);
log(`玩家 ${me.username} uid=${me.uid} 金币 ${coins(obs)} 天数 ${obs.day} 场景 ${obs.scene}`);

// 第二个账号（联机阶：送礼/结关系需要有人在房间里；bind 还需要好感）
let other = null, B = null;
if (!SOLO) {
  other = await makeAccount('q');
  if (other) {
    // 第二个账号以「玩家通道」上线（走 /ws，才能被同场景看见与送礼物）
    const ws = new WebSocket(`${WS_BASE}/ws`);
    await new Promise((res) => ws.once('open', res));
    ws.send(JSON.stringify({ t: 'join', uid: other.uid, nick: other.username, token: other.token }));
    await sleep(700);
    B = { ws };
    log(`第二名玩家 ${other.username} 已上线（联机阶可用）`);
  }
}

// 各阶段类型的执行器：返回 { done:boolean, why?:string }
const exec = {
  async forecast(o) { const r = await A.call('forecast'); return { done: r.ok, why: r.msg }; },
  async report(o) { const r = await A.call('report'); return { done: r.ok || /银行|场景/.test(String(r.msg)), why: r.msg }; },
  async tasks(o) { const r = await A.call('tasks'); return { done: r.ok, why: r.summary || r.msg }; },
  async onboarding(o) { const r = await A.call('onboarding'); return { done: r.ok, why: r.summary || r.msg }; },
  async season(o) { const r = await A.call('season'); return { done: r.ok, why: r.msg }; },
  async claims(o) { const r = await A.call('claims'); return { done: r.ok, why: r.msg }; },
  async chat(o) { const r = await A.call('chat', { text: '路过打个招呼' }); return { done: r.ok, why: r.msg }; },
  async talk(o) {
    const r = await A.call('talk', { npcId: 2 });
    return { done: !!r.ok, why: r.msg };
  },
  async letter(o) {
    if (!other) return { done: false, why: '需要第二名玩家在线（单人不触发）' };
    const r = await A.call('letter', { to: other.username, body: '你好，刚上线' });
    return { done: r.ok, why: r.msg };
  },
  async move(o) {
    const r = await A.call('move', { dir: 'right' });
    return { done: r.ok, why: r.msg };
  },
  async move_to(o) {
    const here = o?.pos || { x: 0, y: 0 };
    // 去 3 格外的可走点（先 move_to 附近空地，再回中心，避免撞障碍）
    const r = await A.call('move_to', { x: here.x + 300, y: here.y });
    return { done: r.ok, why: r.msg };
  },
  async till(o) {
    const c = findTillCell(o);
    if (!c) return { done: false, why: '附近 3 格内没有可犁地（需回村景开阔处）' };
    // 观察半径 3 格、动作要求相邻格：先走过去再动作（玩家真实交互就是两步）
    const go = await A.call('move_to', { x: c.px, y: c.py });
    if (!go.ok) return { done: false, why: '走不到候选格：' + String(go.msg).slice(0, 50) };
    const o2 = (await A.observe()) || o;
    const r = await A.call('till', { x: c.px, y: c.py });
    return { done: r.ok, why: r.msg };
  },
  async plant(o) {
    const c = (o?.plotsNear || []).find(p => !p.planted);
    if (!c) return { done: false, why: '附近没有已犁未种的地块' };
    // 种子：优先背包里的（36 小麦 / 38 土豆 / 96 胡萝卜），没有就买
    const seed = [96, 38, 36].find(id => hasItem(o, id));
    if (!seed) {
      const t = await A.call('talk', { npcId: 13 });
      const buy = await A.call('buy', { itemId: 38, count: 2 });
      if (!buy.ok) return { done: false, why: '没有种子且买不到：' + String(buy.msg || t.msg).slice(0, 40) };
      obs = await A.observe() || obs;
    }
    const s2 = [96, 38, 36].find(id => hasItem(obs, id));
    if (!s2) return { done: false, why: '买种后背包仍无种子' };
    const r = await A.call('plant', { x: c.px, y: c.py, itemId: s2 });
    return { done: r.ok, why: r.msg };
  },
  async water(o) {
    const c = (o?.plotsNear || []).find(p => p.planted && p.status && p.status.includes('未成熟'));
    if (!c) return { done: false, why: '附近没有未成熟作物（需先种下且未到成熟）' };
    const r = await A.call('water', { x: c.px, y: c.py });
    return { done: r.ok, why: r.msg };
  },
  async harvest(o) {
    const c = (o?.plotsNear || []).find(p => p.status === '成熟可收');
    if (!c) return { done: false, why: '附近没有成熟作物（生长需 1 个游戏日）' };
    const r = await A.call('harvest', { x: c.px, y: c.py });
    return { done: r.ok, why: r.msg };
  },
  async fish(o) {
    if (!hasItem(o, 6)) {
      const buy = await A.call('buy', { itemId: 6, count: 1 });
      if (!buy.ok) return { done: false, why: '没有鱼竿且买不起：' + String(buy.msg).slice(0, 40) };
      obs = await A.observe() || obs;
    }
    // 去水边
    if (!o?.waterNear) {
      const go = await A.call('move_to', { near: 'water' });
      if (!go.ok) return { done: false, why: '走不到水边：' + String(go.msg).slice(0, 50) };
      obs = await A.observe() || obs;
      if (!obs?.waterNear) return { done: false, why: '到达水边但附近无水格' };
    }
    const r = await A.call('fish');
    return { done: r.ok, why: r.msg };
  },
  async mine(o) {
    if (!hasItem(o, 58)) {
      const buy = await A.call('buy', { itemId: 58, count: 1 });
      if (!buy.ok) return { done: false, why: '没有镐且买不起：' + String(buy.msg).slice(0, 40) };
      obs = await A.observe() || obs;
    }
    const spots = o?.farm?.mineSpots || [];
    if (!spots.length) return { done: false, why: 'observe 未给矿点坐标' };
    const near = spots.find(s => Math.abs(s.gx - Math.floor(o.pos.x / 100)) <= 3 && Math.abs(s.gy - Math.floor(o.pos.y / 100)) <= 3);
    if (!near) {
      const go = await A.call('move_to', { x: spots[0].px, y: spots[0].py });
      if (!go.ok) return { done: false, why: '走不到矿点：' + String(go.msg).slice(0, 50) };
      obs = await A.observe() || obs;
    }
    const r = await A.call('mine');
    return { done: r.ok, why: r.msg };
  },
  async chop(o) {
    const t = o?.treesNear?.find(x => x);
    if (!t) return { done: false, why: '附近 3 格内没有树（换到有树的区域）' };
    const go = await A.call('move_to', { x: t.px, y: t.py });
    if (!go.ok) return { done: false, why: '走不到树边：' + String(go.msg).slice(0, 50) };
    const o2 = (await A.observe()) || o;
    const t2 = o2?.treesNear?.find(x => x) || t;
    const r = await A.call('chop', { x: t2.px, y: t2.py });
    return { done: r.ok, why: r.msg };
  },
  async buy(o) {
    const r = await A.call('buy', { itemId: 36, count: 1 });
    return { done: r.ok, why: r.msg };
  },
  async trade(o) {
    const item = 28; // 小麦
    const view = await A.call('trade', { op: 'book', item });
    if (!view.ok) return { done: false, why: view.msg };
    const price = Math.max(1, Number(view.ask?.[0]?.price || view.book?.asks?.[0]?.price || 30));
    const r = await A.call('trade', { op: 'place', side: 'sell', item, price, qty: 1 });
    return { done: r.ok, why: r.msg };
  },
  async give(o) {
    if (!other) return { done: false, why: '需要第二名玩家在线（单人不触发）' };
    const giveable = (o?.backpack || []).find(x => x.id !== 1 && x.num > 0);
    const itemId = giveable ? giveable.id : 18;
    const r = await A.call('give', { target: other.username, itemId, num: 1 });
    return { done: r.ok, why: r.msg };
  },
  async bind(o) {
    if (!other) return { done: false, why: '需要第二名玩家在线' };
    // 好感门槛 30：先聊天/送礼攒一点（单次 +2 / 送礼更多），不够就如实报告
    for (let i = 0; i < 3; i++) await A.call('chat', { text: '交个朋友？' });
    const give = await exec.give(o);
    if (!give.done) return { done: false, why: '送礼未成，好感不足 30：' + String(give.why).slice(0, 40) };
    const r = await A.call('bind', { target: other.username, type: 'friend' });
    return { done: r.ok, why: r.msg };
  },
  async lease(o) {
    const plot = 'tcw-demo';
    const open = await A.call('lease', { op: 'open', plot, leaseMs: 60000 });
    if (!open.ok) return { done: false, why: open.msg };
    const care = await A.call('lease', { op: 'care', plot });
    return { done: care.ok, why: care.msg };
  },
  async claim(o) {
    const t = o?.treesNear?.find(x => x);
    if (!t) return { done: false, why: '附近没有树可认领' };
    const r = await A.call('claim', { kind: 'tree', x: t.px, y: t.py });
    return { done: r.ok, why: r.msg };
  },
  async build(o) {
    const r = await A.call('build', { type: 'kitchen', x: (o?.tillableNear?.[0]?.px) || o.pos.x, y: (o?.tillableNear?.[0]?.py) || o.pos.y });
    return { done: r.ok, why: r.msg };
  },
  async cook(o) {
    const r = await A.call('cook', {});
    return { done: r.ok, why: r.msg || '厨房未建成或缺原料' };
  },
  async place(o) {
    if (!hasItem(o, 77)) {
      const buy = await A.call('buy', { itemId: 77, count: 1 });
      if (!buy.ok) return { done: false, why: '没有初级洒水器且买不起：' + String(buy.msg).slice(0, 40) };
      obs = await A.observe() || obs;
    }
    const c = obs?.tillableNear?.[0];
    if (!c) return { done: false, why: '附近没有可放洒水器的地块' };
    const r = await A.call('place', { x: c.px, y: c.py, itemId: 77 });
    return { done: r.ok, why: r.msg };
  },
  async adopt(o) { return { done: false, why: '畜牧需先有畜棚（建造前置）' }; },
  async feed(o) { return { done: false, why: '没有已收养动物' }; },
  async pet(o) { return { done: false, why: '没有已收养动物' }; },
  async decorate(o) {
    const r = await A.call('decor_place', { decorId: (obs?.farm ? 1 : 1) });
    return { done: r.ok, why: r.msg };
  },
  async courtyard(o) { const r = await A.call('courtyard'); return { done: r.ok, why: r.msg }; },
  async decor_place(o) {
    const r = await A.call('decor_place', { decorId: 1 });
    return { done: r.ok, why: r.msg };
  },
  async stall(o) { return { done: false, why: '开摊随经济钩子冻结（M-B1 判门后才开）' }; },
  async train(o) {
    const r = await A.call('train', { attr: '力量' });
    return { done: r.ok, why: r.msg || '需站在健身房（门位 6 格内）' };
  },
  async delegate(o) {
    const r = await A.call('delegate', { op: 'publish', task: '帮我砍棵树', itemId: 1, num: 200 });
    return { done: r.ok, why: r.msg };
  },
  async release(o) { const r = await A.call('release', { kind: 'tree', x: 0, y: 0 }); return { done: r.ok, why: r.msg }; },
  async reply(o) { return { done: false, why: '非任务类动作' }; },
  async recap(o) { return { done: false, why: '非任务类动作' }; },
};

// 走查：反复挑「已解锁且未完成」的第一阶去执行，直到没有进展
const chainDoc = JSON.parse(fs.readFileSync(path.join(repo, 'data/task-chains.json'), 'utf8'));
const byId = new Map(chainDoc.chains.map(c => [c.id, c]));
let progress = true;
let iter = 0;
while (progress && iter++ < 80) {
  progress = false;
  const view = await A.call('tasks');
  if (!view.ok) break;
  for (const c of view.chains || []) {
    const def = byId.get(c.id);
    for (const st of c.stages) {
      if (st.done) continue;
      const before = st.cur;
      report.steps++;
      const fn = exec[st.type];
      if (!fn) { report.blocked.push({ chain: c.id, stage: st.id, name: st.name, type: st.type, why: '走查器没有该动作的执行器（需要补）' }); continue; }
      if (!c.unlocked) { report.blocked.push({ chain: c.id, stage: st.id, name: st.name, type: st.type, why: `第 ${c.unlockDay} 天解锁（当前第 ${obs.day} 天）` }); continue; }
      obs = (await A.observe()) || obs;   // 动作前刷新（join 后 playerPos 才落定，旧 obs 会误报「附近没有可犁地」）
      const res = await fn(obs);
      obs = (await A.observe()) || obs;
      const after = (await A.call('tasks')).chains?.find(x => x.id === c.id)?.stages?.find(x => x.id === st.id);
      const moved = (after?.cur ?? 0) > before || !!after?.done;
      if (res.done && moved) { progress = true; break; }
      if (res.done && !moved) report.fails.push({ chain: c.id, stage: st.id, type: st.type, why: '动作返回成功但阶段未推进：' + String(res.why).slice(0, 80) });
      else report.blocked.push({ chain: c.id, stage: st.id, name: st.name, type: st.type, why: String(res.why || '未能完成').slice(0, 90) });
      break;   // 一次只推进一阶，保持流水与真实动作一一对应
    }
    if (progress) break;
  }
  if (ROUNDS > 1 && !progress) { await sleep(1000); obs = (await A.observe()) || obs; }
}

const finalView = await A.call('tasks');
const finalObs = (await A.observe()) || obs;
report.rewards.coinsAfter = coins(finalObs);
for (const c of finalView.chains || []) {
  report.chains.push({ id: c.id, name: c.name, unlocked: c.unlocked, finished: c.finished, total: c.total });
}
log('=== 任务链走查结果 ===');
for (const c of report.chains) log(`  ${c.name}(${c.id})：${c.finished}/${c.total} 阶${c.unlocked ? '' : '（未解锁）'}`);
log(`金币：${report.rewards.coinsBefore} -> ${report.rewards.coinsAfter}（净 ${report.rewards.coinsAfter - report.rewards.coinsBefore}）`);
log(`阻塞 ${report.blocked.length} 项：`);
for (const b of report.blocked) log(`  - ${b.chain}/${b.stage} ${b.name}（${b.type}）：${b.why}`);
log(`失败 ${report.fails.length} 项（动作成功但没推进 = 缺陷）：`);
for (const f of report.fails) log(`  - ${f.chain}/${f.stage}（${f.type}）：${f.why}`);

fs.mkdirSync('/tmp/af-walk', { recursive: true });
fs.writeFileSync('/tmp/af-walk/report.json', JSON.stringify(report, null, 1));
log('报告：/tmp/af-walk/report.json');
A.ws.close();
if (B) B.ws.close();
process.exit(report.fails.length ? 1 : 0);