// 打印所有消息测试 move_to
import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:8080/agent?token=d9e2355ee61b5817efc9900830083fbe');
const wait = ms => new Promise(r => setTimeout(r, ms));
ws.on('open', async () => {
  await wait(600);
  ws.send(JSON.stringify({ t: 'act', action: 'move_to', x: 3000, y: 6000 })); // 木匠家门口附近（已知可走）
  await wait(3000);
  ws.send(JSON.stringify({ t: 'act', action: 'chat', text: '测试' }));
  await wait(2000);
  ws.send(JSON.stringify({ t: 'observe' }));
  await wait(1000);
  ws.close();
});
ws.on('message', (raw) => {
  console.log('<<', raw.toString().slice(0, 180));
});
ws.on('close', () => process.exit(0));
ws.on('error', (e) => { console.log('ERR', e.message); process.exit(1); });
