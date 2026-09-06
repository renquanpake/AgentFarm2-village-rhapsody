// test-gameplay.mjs —— 玩法动作全流程测试（plant/harvest/chop/fish/mine + inbox + interrupt）
// 用法：node test-gameplay.mjs --username test2 --password 1234 [--grow-ms 5000]
// 说明：先登录拿 agentToken → 连 /agent → 依次验证各玩法。作物成长按真实时间（服务器 AF_GROW_MS），
//       测试时建议服务器用 AF_GROW_MS=5000 启动（5 秒 = 1 天）。
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:8080';
const WS_AGENT = 'ws://127.0.0.1:8080/agent';
const args = process.argv.slice(2);
const username = args[args.indexOf('--username') + 1] || 'test3';
const password = args[args.indexOf('--password') + 1] || '1234';
const GROW_WAIT_MS = Number(args[args.indexOf('--grow-wait') + 1] || 12000);

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- 连接 agent 通道 ----
function connect(token) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS_AGENT + '?token=' + token);
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}
let seq = 0;
function call(ws, msg, timeout = 20000) {
  return new Promise((resolveP) => {
    const onMsg = (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'result' && m.seq === msg.seq) { ws.off('message', onMsg); resolveP(m); }
    };
    ws.on('message', onMsg);
    msg.seq = ++seq;
    ws.send(JSON.stringify(msg));
    setTimeout(() => { ws.off('message', onMsg); resolveP({ t: 'result', ok: false, msg: '超时' }); }, timeout);
  });
}
function callState(ws, msg, timeout = 20000) {
  return new Promise((resolveP) => {
    const onMsg = (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'state') { ws.off('message', onMsg); resolveP(m); }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify(msg));
    setTimeout(() => { ws.off('message', onMsg); resolveP(null); }, timeout);
  });
}
function callRaw(ws, wantT, msg, timeout = 10000) {
  return new Promise((resolveP) => {
    const onMsg = (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === wantT) { ws.off('message', onMsg); resolveP(m); }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify(msg));
    setTimeout(() => { ws.off('message', onMsg); resolveP({ t: 'result', ok: false, msg: '超时' }); }, timeout);
  });
}
// move_to 是异步的：等待 result(ok && msg 含"已开始"或"已在")，再等最终 result
function moveTo(ws, x, y) {
  return new Promise((resolveP) => {
    const onMsg = (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'result' && m.action === 'move_to') {
        ws.off('message', onMsg);
        if (m.ok && m.msg && m.msg.startsWith('已开始')) {
          // 等待行走完成的最终 result
          const onDone = (raw2) => {
            let m2; try { m2 = JSON.parse(raw2.toString()); } catch { return; }
            if (m2.t === 'result' && m2.action === 'move_to' && m2.pos) { ws.off('message', onDone); resolveP(m2); }
          };
          ws.on('message', onDone);
          setTimeout(() => { ws.off('message', onDone); resolveP({ ok: false, msg: 'move_to 行走超时' }); }, 20000);
        } else resolveP(m);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ t: 'act', action: 'move_to', x, y }));
    setTimeout(() => { ws.off('message', onMsg); resolveP({ ok: false, msg: 'move_to 超时' }); }, 30000);
  });
}
// 长距离自动分段：路径过长(>60步)时取中点续走
async function walkTo(ws, x, y, depth = 0) {
  if (depth > 6) return { ok: false, msg: '分段行走失败' };
  const r = await moveTo(ws, x, y);
  if (r.ok) return r;
  if (/路径过长/.test(r.msg)) {
    const st = await callState(ws, { t: 'observe' });
    if (!st || !st.pos) return r;
    const mx = Math.floor((st.pos.x + x) / 200) * 100 + 50;
    const my = Math.floor((st.pos.y + y) / 200) * 100 + 50;
    const mid = await walkTo(ws, mx, my, depth + 1);
    if (!mid.ok) return mid;
    return walkTo(ws, x, y, depth + 1);
  }
  return r;
}

async function main() {
  console.log(`[test] 登录 ${username}`);
  let r = await post('/af/login', { username, password });
  if (r.status === 401) r = await post('/af/register', { username, password });
  if (r.status !== 200) { console.error('登录失败', r); process.exit(1); }
  const { token, uid } = r.json;
  let rt = await post('/af/agent-token', { token });
  const agentToken = rt.json.agentToken;
  console.log(`[test] uid=${uid} agentToken 就绪`);

  const ws = await connect(agentToken);
  console.log('[test] 已连接 /agent');
  await wait(300); // 等 welcome/state

  // ---- 1. 基础观察 ----
  const st = await callState(ws, { t: 'observe' });
  check('observe 返回状态', !!st && st.nick, JSON.stringify(st));
  console.log(`  位置 (${st.pos?.x},${st.pos?.y}) 金币 ${st.coins} 背包 ${JSON.stringify(st.backpack?.slice(0, 4))}`);
  const hasSeeds = (st.seeds || []).length > 0;
  check('observe 带种子列表', hasSeeds);

  // ---- 2. 买种子（动态找空农田格 + 就近的树） ----
  const seedId = 36; // 小麦种子
  const buy = await call(ws, { t: 'act', action: 'buy', itemId: seedId, count: 1 });
  check('buy 小麦种子×1', buy.ok, buy.msg);
  const stA = await callState(ws, { t: 'observe' });
  const freePlot = (stA.farm?.plots || []).find(p => p.plantUID === 0);
  check('有空农田格', !!freePlot, JSON.stringify(stA.farm?.plots));
  // 循环尝试每个空农田格（部分格可能被场景树占用）
  let plant = null, farmPx = null;
  for (const pl of (stA.farm?.plots || []).filter(p => p.plantUID === 0)) {
    const px = pl.gx * 100 + 50, py = pl.gy * 100 + 50;
    const mv = await walkTo(ws, px, py);
    if (!mv.ok) continue;
    plant = await call(ws, { t: 'act', action: 'plant', itemId: seedId, x: px, y: py });
    if (plant.ok) { farmPx = { x: px, y: py }; break; }
  }
  check('plant 种小麦', !!plant && plant.ok, plant?.msg);
  const plantUid = plant?.planted?.uid;
  // 重复种应失败（格子占用）
  const plant2 = await call(ws, { t: 'act', action: 'plant', itemId: seedId, x: farmPx.x, y: farmPx.y });
  check('重复种被拒（格子占用）', !plant2.ok, plant2.msg);
  // 未成熟不可收
  const harv0 = await call(ws, { t: 'act', action: 'harvest', x: farmPx.x, y: farmPx.y });
  check('未成熟不可收', !harv0.ok && /还没成熟/.test(harv0.msg), harv0.msg);

  // ---- 4. 砍树（从 treesNear 找一棵 hp<=30 的树，两刀倒） ----
  const stTree = await callState(ws, { t: 'observe' });
  const tree = (stTree.treesNear || []).find(t => t.hp <= 30);
  check('10格内有可砍树', !!tree, JSON.stringify(stTree.treesNear));
  const treePx = { x: tree.gx * 100 + 50, y: tree.gy * 100 + 50 };
  const mv2 = await walkTo(ws, treePx.x, treePx.y);
  check('move_to 树旁', mv2.ok, mv2.msg);
  const st2 = await callState(ws, { t: 'observe' });
  const nearTree = (st2.plantsNear || []).some(p => p.kind.includes('树'));
  check('observe 能看到树(3格内)', nearTree, JSON.stringify(st2.plantsNear));
  let chop = await call(ws, { t: 'act', action: 'chop', x: treePx.x, y: treePx.y });
  check('chop 第一刀', chop.ok, chop.msg);
  chop = await call(ws, { t: 'act', action: 'chop', x: treePx.x, y: treePx.y });
  check('chop 第二刀(树倒+木材)', chop.ok && /砍倒/.test(chop.msg), chop.msg);
  chop = await call(ws, { t: 'act', action: 'chop', x: treePx.x, y: treePx.y });
  check('chop 第三刀(树已倒被拒)', !chop.ok, chop.msg);
  const st3 = await callState(ws, { t: 'observe' });
  const hasWood = (st3.backpack || []).some(p => p.id === 18);
  check('背包有木材 id=18', hasWood, JSON.stringify(st3.backpack?.find(p => p.id === 18)));

  // ---- 5. 钓鱼（水边 (14,37) → 像素 1450,3750） ----
  const shorePx = { x: 1450, y: 3750 };
  const mv3 = await walkTo(ws, shorePx.x, shorePx.y);
  check('move_to 水边', mv3.ok, mv3.msg);
  const st4 = await callState(ws, { t: 'observe' });
  check('observe 水边 waterNear=true', st4.waterNear === true, 'waterNear=' + st4.waterNear);
  const fish = await call(ws, { t: 'act', action: 'fish' });
  check('fish 钓到鱼', fish.ok, fish.msg);

  // ---- 6. 挖矿（矿点 (35,10) → 像素 3550,1050） ----
  const minePx = { x: 3550, y: 1050 };
  const mv4 = await walkTo(ws, minePx.x, minePx.y);
  check('move_to 矿山', mv4.ok, mv4.msg);
  const mine = await call(ws, { t: 'act', action: 'mine' });
  check('mine 挖到矿', mine.ok, mine.msg);

  // ---- 7. 收菜（走回农田，等作物成熟，growDay 由真实时间推进） ----
  console.log(`[test] 等待作物成熟 ${GROW_WAIT_MS / 1000}s...`);
  await wait(GROW_WAIT_MS);
  const mv5 = await walkTo(ws, farmPx.x, farmPx.y);
  check('move_to 回农田', mv5.ok, mv5.msg);
  const harv = await call(ws, { t: 'act', action: 'harvest', x: farmPx.x, y: farmPx.y });
  check('harvest 收获小麦', harv.ok, harv.msg);
  const st5 = await callState(ws, { t: 'observe' });
  const hasWheat = (st5.backpack || []).some(p => p.id === 28);
  check('背包有小麦 id=28', hasWheat, JSON.stringify(st5.backpack?.find(p => p.id === 28)));

  // ---- 8. inbox / chat_log（响应类型是 inbox/chat_log，不是 result） ----
  const ib = await callRaw(ws, 'inbox', { t: 'inbox' });
  check('inbox 消息类型', ib.t === 'inbox' && Array.isArray(ib.msgs), JSON.stringify(ib).slice(0, 120));
  const cl = await callRaw(ws, 'chat_log', { t: 'chat_log' });
  check('chat_log 返回记录', cl.t === 'chat_log' && Array.isArray(cl.msgs), JSON.stringify(cl).slice(0, 120));

  ws.close();
  console.log(`\n[test] 通过 ${pass} / 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[test] 异常:', e); process.exit(1); });


