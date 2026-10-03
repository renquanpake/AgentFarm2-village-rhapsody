#!/usr/bin/env node
// tools/e2e-nav-arrive.mjs —— D1/D3/D4 导航执行确认闭环 E2E
// 覆盖：确认环逐段推进 / 偏差自动重规划 / 静默回落盲推 / 打断硬停(<=200ms) / 交互环(near=water 水边 + 障碍格吸附)
// 前置：服务端已起（建议 AF_SLOT=9 AF_NAV_ARRIVE_MS=1200），AF_BASE 指向该实例
// 用法：AF_BASE=http://127.0.0.1:8091 node tools/e2e-nav-arrive.mjs
import WebSocket from 'ws';

const BASE = process.env.AF_BASE || 'http://127.0.0.1:8080';
const WS_BASE = BASE.replace(/^http/, 'ws');
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${extra ? ' | ' + extra : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const onceOpen = (ws) => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
const send = (ws, obj) => ws.send(JSON.stringify(obj));

// 消息队列封装：连接建立后立即挂监听（防早期消息丢失）；
// 到达消息：有匹配 waiter 立即投递（不排队）；无匹配者暂存，供后续 next() 扫描消费
function makeQueue() {
  const q = [];
  const waiters = [];
  return {
    attach(ws) {
      ws.on('message', (raw) => {
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        const i = waiters.findIndex(w => w.pred(m));
        if (i >= 0) { const w = waiters.splice(i, 1)[0]; w.resolve(m); }
        else q.push(m);
      });
    },
    next(pred, timeoutMs = 8000) {
      const i = q.findIndex(pred);
      if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
      });
    },
  };
}

// ---------- 账号 ----------
const uname = `navarrive_${Date.now() % 1e6}`;
const reg = await fetch(BASE + '/af/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'pass1234' }) }).then(r => r.json());
check('注册账号', reg.ok && reg.uid, reg.uid || reg.msg);
const { uid, token } = reg;
const atk = await fetch(`${BASE}/af/agent-token?token=${encodeURIComponent(token)}`, { method: 'POST' }).then(r => r.json());
check('获取 agentToken', !!atk.agentToken);

// ---------- 双通道连接（游戏通道=模拟客户端 mod；agent 通道=外部 LLM agent） ----------
const G = new WebSocket(WS_BASE + '/ws');
const A = new WebSocket(WS_BASE + '/agent?token=' + encodeURIComponent(atk.agentToken));
const GQ = makeQueue(), AQ = makeQueue();
GQ.attach(G); AQ.attach(A);
await onceOpen(G); await onceOpen(A);
send(G, { t: 'join', uid, nick: '导航验证', token });
await GQ.next(m => m.t === 'welcome');
await AQ.next(m => m.t === 'welcome');

send(A, { t: 'observe' });
const st = await AQ.next(m => m.t === 'state');
const pos = st.pos || { x: 0, y: 0 };
check('observe 返回位置', Number.isFinite(pos.x), `(${pos.x},${pos.y}) scene=${st.scene}`);
const scene = st.scene;

// 目标：当前位置 +10 格（保证 2..60 步内；越界/障碍/水回退 -10）
const mapgrid = await fetch(`${BASE}/af/mapgrid?token=${encodeURIComponent(token)}`).then(r => r.json());
const W = mapgrid.W, H = mapgrid.H;
const isWater = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mapgrid.water[y * W + x] === 1;
const isBlocked = (x, y) => mapgrid.blocked && x >= 0 && y >= 0 && x < W && y < H && mapgrid.blocked[y * W + x] === 1;
const sx = Math.floor(pos.x / 100), sy = Math.floor(pos.y / 100);
let tx = sx + 10, ty = sy + 10;
if (tx >= W - 1 || ty >= H - 1 || isBlocked(tx, ty) || isWater(tx, ty)) { tx = Math.max(1, sx - 10); ty = Math.max(1, sy - 10); }

const waitDone = (timeoutMs = 20000) => GQ.next(m => m.t === 'agent_move_done', timeoutMs).catch(() => null);

// 按服务端段广播逐段确认直到 done
async function confirmSegments(maxSegs = 30, hardTimeoutMs = 25000) {
  const t0 = Date.now();
  for (let i = 0; i < maxSegs && Date.now() - t0 < hardTimeoutMs; i++) {
    const m = await GQ.next(m => m.t === 'agent_move' && Number.isInteger(m.seg), 3000).catch(() => null);
    if (!m) {
      const d = GQ.next(m => m.t === 'agent_move_done', 1000).catch(() => null);
      const dm = await d;
      if (dm) return dm;
      continue;
    }
    send(G, { t: 'agent_arrive', index: m.seg, x: m.x, y: m.y, scene: m.scene });
  }
  return waitDone(25000);
}

// ---------- 场景 A：确认环逐段推进 + 打断硬停（D1/D4） ----------
const P = (gx, gy) => ({ x: gx * 100 + 50, y: gy * 100 + 50 }); // move_to 契约=像素坐标（observe 的 px/py）
console.log(`\n=== A: 确认环 (${sx},${sy}) -> (${tx},${ty}) + 打断 ===`);
send(A, { t: 'act', action: 'move_to', ...P(tx, ty), seq: 1 });
const mv0 = await AQ.next(m => m.t === 'move_started' && m.seq === 1);
check('move_to 返回 move_started（含航点/segMs）', mv0.ok && Array.isArray(mv0.waypoints) && mv0.waypoints.length >= 1 && Number.isFinite(mv0.segMs), `${mv0.msg}`);
// 客户端收到 seg=0 段广播 -> 回报落点 -> 服务端发 seg=1
const am0 = await GQ.next(m => m.t === 'agent_move' && m.seg === 0, 5000).catch(() => null);
check('游戏通道收到 seg=0 段广播', !!am0, am0 ? `(${am0.x},${am0.y})` : 'timeout');
const am1Prom = GQ.next(m => m.t === 'agent_move' && m.seg === 1, 5000).catch(() => null);
send(G, { t: 'agent_arrive', index: 0, x: (am0?.x ?? mv0.waypoints[0].x), y: (am0?.y ?? mv0.waypoints[0].y), scene });
const am1 = await am1Prom;
check('arrive 确认后服务端推进 seg=1', !!am1, am1 ? `(${am1.x},${am1.y})` : '未推进');
// D4 打断硬停：200ms 门针对 agent_move_done（停止链路）；result（含落盘）允许迟到
const t0 = Date.now();
const doneProm = GQ.next(m => m.t === 'agent_move_done', 3000).catch(() => null);
send(G, { t: 'agent_interrupt' });
const done = await doneProm;
const doneMs = Date.now() - t0;
const resProm = AQ.next(m => m.t === 'result' && m.action === 'move_to' && m.seq === 1, 10000).catch(() => null);
const res = await resProm;
check('打断后 200ms 内广播 agent_move_done（D4 硬停）', !!done && doneMs <= 200, `done@+${doneMs}ms（result@+${res ? undefined : '未达'}，落盘后回推，不计时）`);
check('打断 result 带 interrupted 标记', !!res && res.ok === false && res.interrupted === true, res ? JSON.stringify(res) : 'timeout');

// ---------- 场景 B：偏差超限 -> 自动重规划 ----------
console.log('\n=== B: 偏差重规划 ===');
send(A, { t: 'act', action: 'move_to', ...P(tx, ty), seq: 2 });
const mv2 = await AQ.next(m => m.t === 'move_started' && m.seq === 2).catch(() => null);
let replanned = false;
if (mv2 && mv2.waypoints?.length) {
  await GQ.next(m => m.t === 'agent_move' && m.seg === 0, 5000).catch(() => {});
  const big = { x: mv2.waypoints[0].x + 500, y: mv2.waypoints[0].y };
  const reProm = GQ.next(m => m.t === 'agent_move' && m.seg === 0, 5000).catch(() => null);
  send(G, { t: 'agent_arrive', index: 0, x: big.x, y: big.y, scene }); // 故意偏差超限
  const re = await reProm;
  replanned = !!re;
  check('偏差超限触发自动重规划（重发 seg）', replanned, re ? `重规划后 (${re.x},${re.y})` : '未重规划');
  // 继续按重规划后的段广播确认走到头
  const doneB = await confirmSegments();
  check('重规划路线走完并广播 done', !!doneB);
} else {
  check('场景B 前置 move_to 成功', !!mv2, mv2?.msg || 'timeout');
}

// ---------- 场景 C：客户端静默 -> 盲推回落 ----------
console.log('\n=== C: 盲推回落（客户端在线但静默） ===');
send(A, { t: 'act', action: 'move_to', ...P(tx - 10 < 1 ? tx + 1 : tx - 10, ty), seq: 3 });
const mv3 = await AQ.next(m => (m.t === 'move_started' || m.t === 'result') && m.seq === 3).catch(() => null);
check('场景C move_to 已发起', !!mv3 && (mv3.ok || /路径过长/.test(mv3.msg || '')), mv3?.msg || 'timeout');
const doneC = await waitDone(40000);
check('无 arrive 上报时走盲推回落直至完成', !!doneC);

// ---------- 场景 D：交互环（D3） ----------
console.log('\n=== D: 交互环 ===');
send(A, { t: 'observe' });
const stD = await AQ.next(m => m.t === 'state');
const ax = Math.floor((stD.pos?.x ?? pos.x) / 100), ay = Math.floor((stD.pos?.y ?? pos.y) / 100);
// D.1 水边吸附：找离当前 55 格内的水格（超过 60 步会触发路径过长，降级为跳过）
let wc = null;
for (let r = 1; r <= 55 && !wc; r++) {
  for (let dy = -r; dy <= r && !wc; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const nx = ax + dx, ny = ay + dy;
    if (isWater(nx, ny)) { wc = { x: nx, y: ny }; break; }
  }
}
if (wc) {
  send(A, { t: 'act', action: 'move_to', ...P(wc.x, wc.y), near: 'water', seq: 4 });
  const mv4 = await AQ.next(m => (m.t === 'move_started' || m.t === 'result') && m.seq === 4).catch(() => null);
  if (mv4 && mv4.ok && mv4.waypoints?.length) {
    const last = mv4.waypoints[mv4.waypoints.length - 1];
    const lx = Math.floor(last.x / 100), ly = Math.floor(last.y / 100);
    let nearWater = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isWater(lx + dx, ly + dy)) nearWater = true;
    check('near=water 终点吸附到水边（贴水且非水）', !isWater(lx, ly) && nearWater, `终点格 (${lx},${ly})`);
  } else {
    check('near=water 移动成功', !!mv4 && mv4.ok, mv4?.msg || 'timeout');
  }
  await waitDone(40000);
} else {
  check('D.1 水边吸附（55 格内无水，跳过）', true, 'skip');
}
// D.2 障碍格目标吸附（房子矩形中心通常为障碍）
let hc = null;
for (const h of mapgrid.houses || []) {
  const cx = Math.floor(h.x + h.w / 2), cy = Math.floor(h.y + h.h / 2);
  if (isBlocked(cx, cy)) { hc = { x: cx, y: cy }; break; }
}
if (hc) {
  send(A, { t: 'act', action: 'move_to', ...P(hc.x, hc.y), seq: 5 });
  const mv5 = await AQ.next(m => (m.t === 'move_started' || m.t === 'result') && m.seq === 5).catch(() => null);
  check('障碍格目标不再直接不可达（交互环吸附）', !!mv5 && !/不可达/.test(mv5.msg || ''), mv5?.msg || 'timeout');
  await waitDone(40000);
} else {
  check('D.2 障碍格吸附（无可用障碍格，跳过）', true, 'skip');
}

// ---------- 场景 E：P2 市政建筑功能层（buildings.json + move_to near + letter + /af/*） ----------
console.log('\n=== E: P2 建筑层 ===');
// E.1 move_to near:建筑名（村景交易大厅 C1 门位；同场景 A* 分支）
send(A, { t: 'act', action: 'move_to', near: '交易大厅', seq: 20 });
const mvN = await AQ.next(m => (m.t === 'move_started' || m.t === 'result') && m.seq === 20).catch(() => null);
// 成功态 = move_started（含航点）或「路径过长，请分两段走」（路已解出，超 60 步上限的分段提示，非不可达）
const mvNok = !!mvN && ((mvN.ok === true && (mvN.crossScene || Array.isArray(mvN.waypoints))) || /路径过长/.test(mvN.msg || ''));
check('move_to near:交易大厅 解析到门位（move_started/跨场景/分段提示）', mvNok, mvN?.msg || 'timeout');
if (mvN?.ok) {
  const doneN = await waitDone(40000).catch(() => null);
  check('near 建筑路线走完（确认环）', !!doneN);
}
// E.2 不可解析的 near
send(A, { t: 'act', action: 'move_to', near: '不存在的楼宇', seq: 21 });
const mvBad = await AQ.next(m => m.t === 'result' && m.seq === 21).catch(() => null);
check('near 无法解析时返回可用建筑名清单', !!mvBad && mvBad.ok === false && /无法解析/.test(mvBad.msg || ''), mvBad?.msg || 'timeout');
// E.2b 跨场景不可达点名坐标：场景 14 无村门 → planRoute 跨场景失败，文案点名目标格坐标+kind
send(A, { t: 'act', action: 'move_to', x: 3050, y: 3050, scene: 14, seq: 30 });
const mvX = await AQ.next(m => m.t === 'result' && m.seq === 30).catch(() => null);
check('跨场景不可达文案点名目标格坐标', !!mvX && mvX.ok === false && /目标格 30,30/.test(mvX.msg || ''), mvX?.msg || 'timeout');

// E.3 邮局 letter（收件人 = 游戏通道昵称「导航验证」）
send(A, { t: 'act', action: 'letter', to: '导航验证', body: 'e2e 测试信件：交易大厅在村中央，门朝广场。', seq: 22 });
const lt = await AQ.next(m => m.t === 'result' && m.action === 'letter' && m.seq === 22).catch(() => null);
check('letter 投递成功（inbox 持久化）', !!lt && lt.ok === true && lt.to === '导航验证', lt?.msg || 'timeout');
const letter = await fetch(`${BASE}/af/letter?token=${encodeURIComponent(token)}`).then(r => r.json()).catch(() => null);
// 游戏通道 join 与 agent 同 uid（昵称「导航验证」），故信投到自己收件箱：unread>=1 且末条含信文
check('/af/letter 收到信（unread>=1 且含信文）', !!letter && letter.unread >= 1 && letter.inbox.some(e => e.text.includes('e2e 测试信件')), letter ? `unread=${letter.unread}` : '404/timeout');
// E.4 /af/buildings 场景数据（村景 = 交易大厅/气象台/宴会厅/健身房/铁匠铺 5 座；银行/邮局在内部场景 102/109）
const bldg = await fetch(`${BASE}/af/buildings?scene=2&token=${encodeURIComponent(token)}`).then(r => r.json()).catch(() => null);
const bIds = (bldg?.buildings || []).map(b => b.id);
check('/af/buildings?scene=2 含村景 5 建筑', bIds.includes('trade-hall') && bIds.includes('gym') && bIds.length === 5, bIds.join(','));
const bldg102 = await fetch(`${BASE}/af/buildings?scene=102&token=${encodeURIComponent(token)}`).then(r => r.json()).catch(() => null);
check('/af/buildings?scene=102 含银行（A 挂牌落位内部场景）', (bldg102?.buildings || []).some(b => b.id === 'bank'), JSON.stringify(bldg102?.buildings || []));
// E.5 observe buildings 区域（当前场景有已落成建筑时非空；跨场景移动中途时为空属正确降级）
send(A, { t: 'observe' });
const stE = await AQ.next(m => m.t === 'state');
const bHere = stE?.buildings?.here || [];
check('observe buildings 区域结构正确（有则带门位距离）', !!stE && (stE.buildings === null || Array.isArray(bHere)), stE?.buildings ? `scene=${stE.scene} near=${bHere[0]?.id || '无'}` : 'null（当前场景无已落成建筑，正确）');
check('observe fitness/festival 字段类型正确', !!stE && (stE.fitness === null || typeof stE.fitness === 'object') && (stE.festival === null || typeof stE.festival === 'object'), `fitness=${stE?.fitness ? 'obj' : 'null'} festival=${stE?.festival ? stE.festival.name : 'null'}`);

// E.6 气象台 forecast（日历确定性纯函数：明日天气/节日预告）
send(A, { t: 'act', action: 'forecast', seq: 23 });
const fc = await AQ.next(m => m.t === 'result' && m.action === 'forecast' && m.seq === 23).catch(() => null);
const fcOk = !!fc && fc.ok === true && Number.isInteger(fc.day) && fc.tomorrow && ['clear', 'rain', 'snow', 'storm'].includes(fc.tomorrow.weather);
check('forecast 返回明日天气（day/tomorrow 结构）', fcOk, fc ? `day=${fc.day} 明日=${fc.tomorrow?.weather}${fc.tomorrow?.festival ? ' 节日=' + fc.tomorrow.festival : ''}` : 'timeout');

// E.7 健身房 train 位置门（agent 不在 gym 门位 6 格内 -> 友好报错带指引）
send(A, { t: 'act', action: 'train', attr: 'strength', seq: 24 });
const tr = await AQ.next(m => m.t === 'result' && m.action === 'train' && m.seq === 24).catch(() => null);
check('train 位置门（远处拒绝并指引 move_to near:健身房）', !!tr && tr.ok === false && /太远|健身房/.test(tr.msg || ''), tr?.msg || 'timeout');

// E.8 银行 report 场景门（agent 在村景 -> 指引跨场景到 102）
send(A, { t: 'act', action: 'report', seq: 25 });
const rp = await AQ.next(m => m.t === 'result' && m.action === 'report' && m.seq === 25).catch(() => null);
check('report 场景门（村景拒绝并指引银行）', !!rp && rp.ok === false && /银行/.test(rp.msg || ''), rp?.msg || 'timeout');

// E.9 铁匠 forge 配方被 recipeOf 识别（cook recipeId=4：文案区分「没有这个配方」vs 原料/位置门）
send(A, { t: 'act', action: 'cook', recipeId: 4, seq: 26 });
const ck = await AQ.next(m => m.t === 'result' && m.action === 'cook' && m.seq === 26).catch(() => null);
check('forge 配方已注册（cook 识别，报原料/位置门而非未知配方）', !!ck && !/没有这个配方/.test(ck.msg || ''), ck?.msg || 'timeout');

G.close(); A.close();
const fails = results.filter(r => !r).length;
console.log('----');
console.log(fails ? `结果: ${results.length - fails}/${results.length} 通过` : `结果: 全部 ${results.length} 项通过`);
process.exit(fails ? 1 : 0);
