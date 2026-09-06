// dbg-move.mjs —— 最小验证：move_to 远距离时服务器到底发什么
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
let got = 0;
ws.on('message', (raw) => {
  got++;
  console.log('[' + got + ']', raw.toString().slice(0, 200));
});
await new Promise(r2 => setTimeout(r2, 400));
console.log('--- send move_to (7600,4600)->(2750,2950) ---');
ws.send(JSON.stringify({ t: 'act', action: 'move_to', x: 2750, y: 2950 }));
await new Promise(r2 => setTimeout(r2, 8000));
console.log('--- done, total msgs:', got);
process.exit(0);
