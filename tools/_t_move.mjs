// 测 move_to + talk + diary
import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:8080/agent?token=d9e2355ee61b5817efc9900830083fbe');
const wait = ms => new Promise(r => setTimeout(r, ms));
ws.on('open', async () => {
  await wait(600);
  console.log('>> move_to (3500,3000)');
  ws.send(JSON.stringify({ t: 'act', action: 'move_to', x: 3500, y: 3000 }));
  await wait(12000);
  ws.send(JSON.stringify({ t: 'observe' }));
  await wait(1000);
  ws.close();
});
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'result' || m.t === 'state') console.log('[' + m.t + ']', JSON.stringify(m).slice(0, 220));
});
ws.on('close', () => process.exit(0));
ws.on('error', (e) => { console.log('ERR', e.message); process.exit(1); });
