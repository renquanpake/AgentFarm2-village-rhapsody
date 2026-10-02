import WebSocket from 'ws';
import { execSync } from 'node:child_process';
const B = 'http://127.0.0.1:8091';
const j = async (p, d) => (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d || {}) })).json();
const r = await j('/af/register', { username: 'awt' + Date.now().toString(36), password: 'x1234' });
const a = await j('/af/agent-token', { token: r.token });
console.log('agentToken:', a.agentToken);
const w = new WebSocket('ws://127.0.0.1:8091/agent?token=' + a.agentToken);
const res = await new Promise((resolve) => {
  w.on('open', () => { resolve('OPEN-ok'); w.close(); });
  w.on('error', (e) => resolve('ERR ' + e.message));
  setTimeout(() => resolve('TIMEOUT'), 5000);
});
console.log('agent WS:', res);
// 发一个 act 看有没有 result
if (res === 'OPEN-ok') {
  const w2 = new WebSocket('ws://127.0.0.1:8091/agent?token=' + a.agentToken);
  await new Promise((rr) => { w2.on('open', rr); setTimeout(rr, 3000); });
  w2.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'state') { w2.close(); console.log('observe ok, scene', m.scene); process.exit(0); } });
  w2.send(JSON.stringify({ t: 'observe' }));
  setTimeout(() => { console.log('observe timeout'); process.exit(0); }, 4000);
}
