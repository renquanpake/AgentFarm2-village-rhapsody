import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const root = new URL('..', import.meta.url);
const accounts = JSON.parse(readFileSync(new URL('data/accounts.json', root), 'utf8'));
const account = accounts['66'];
const token = (await (await fetch('http://127.0.0.1:8080/af/agent-token', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: account.token }),
})).json()).agentToken;
const ws = new WebSocket('ws://127.0.0.1:8080/agent?token=' + encodeURIComponent(token));
let seq = 0;
const waitResult = action => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(action + ' 超时')), 30000);
  const onMessage = raw => {
    const msg = JSON.parse(raw);
    if (msg.t === 'result' && msg.action === action && !(action === 'move_to' && msg.ok && !msg.pos)) {
      clearTimeout(timer); ws.off('message', onMessage); resolve(msg);
    }
  };
  ws.on('message', onMessage);
});
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
await new Promise(resolve => setTimeout(resolve, 300));

const moveTo = async (x, y) => {
  const result = waitResult('move_to');
  ws.send(JSON.stringify({ t: 'act', action: 'move_to', x, y, seq: ++seq }));
  return result;
};
const moved = [await moveTo(4200, 2600), await moveTo(2450, 3850)];
const fish = waitResult('fish');
ws.send(JSON.stringify({ t: 'act', action: 'fish', seq: ++seq }));
const caught = await fish;
console.log(JSON.stringify({ moved, caught }));
ws.close();
