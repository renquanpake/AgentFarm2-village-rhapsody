// dbg-chop2.mjs —— 实测：到 (1450,1850) 后 chop；再换 hp=30 的树连砍
import WebSocket from 'ws';
const BASE = 'http://127.0.0.1:8080';
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const r = await post('/af/login', { username: 'test2', password: '1234' });
const rt = await post('/af/agent-token', { token: r.token });
const ws = new WebSocket('ws://127.0.0.1:8080/agent?token=' + rt.agentToken);
await new Promise((res) => ws.on('open', res));
let n = 0;
function call(action, extra = {}) {
  return new Promise((res) => {
    const onMsg = (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'result' && m.action === action) { ws.off('message', onMsg); res(m); }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ t: 'act', action, seq: ++n, ...extra }));
    setTimeout(() => { ws.off('message', onMsg); res({ ok: false, msg: 'timeout' }); }, 8000);
  });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await wait(400);

async function walk(x, y) {
  const m = await call('move_to', { x, y });
  if (m.ok && m.msg && m.msg.startsWith('已开始')) {
    // 等最终结果
    return new Promise((res) => {
      const onMsg = (raw) => {
        let mm; try { mm = JSON.parse(raw.toString()); } catch { return; }
        if (mm.t === 'result' && mm.action === 'move_to' && mm.pos) { ws.off('message', onMsg); res(mm); }
      };
      ws.on('message', onMsg);
      setTimeout(() => { ws.off('message', onMsg); res({ ok: false, msg: 'walk timeout' }); }, 20000);
    });
  }
  return m;
}

console.log('=== 测试 (1450,1850) ===');
let w = await walk(1450, 3750);
console.log('walk:', JSON.stringify(w).slice(0, 80));
await wait(200);
const c1 = await call('chop', { x: 1450, y: 1850 });
console.log('chop@(1450,1850):', JSON.stringify(c1).slice(0, 120));

console.log('=== 测试 (1550,1550) hp30 树连砍 ===');
w = await walk(1650, 2450);
console.log('walk:', JSON.stringify(w).slice(0, 80));
await wait(200);
for (let i = 1; i <= 3; i++) {
  const c = await call('chop', { x: 1550, y: 1550 });
  console.log(`chop#${i}:`, JSON.stringify(c).slice(0, 120));
  await wait(200);
}
process.exit(0);

