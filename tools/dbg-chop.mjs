// dbg-chop.mjs —— 实测连续 chop
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
// 树 (1550,1550) plantId=16 hp=30
let pos = await call('move_to', { x: 1550, y: 1550 });
console.log('move_to:', JSON.stringify(pos).slice(0, 100));
await wait(1500);
for (let i = 1; i <= 3; i++) {
  const c = await call('chop', { x: 1550, y: 1550 });
  console.log(`chop #${i}:`, JSON.stringify(c).slice(0, 120));
  await wait(300);
}
process.exit(0);
