// agent 通道冒烟测试：连接 /agent → welcome/state → move → chat → buy → observe
import WebSocket from 'ws';
const TOKEN = process.argv[2] || '1d57b638c25c3deade3e5ec744c06949'; // test1 的 agentToken（旧值，可能失效）
const URL = `ws://127.0.0.1:8080/agent?token=${TOKEN}`;
const ws = new WebSocket(URL);
let step = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
ws.on('open', async () => {
  console.log('[连接成功]');
  await wait(500);
  ws.send(JSON.stringify({ t: 'observe' }));
  await wait(500);
  ws.send(JSON.stringify({ t: 'act', action: 'move', dir: 'up' }));
  await wait(500);
  ws.send(JSON.stringify({ t: 'act', action: 'chat', text: '大家好，我是接入的Agent' }));
  await wait(500);
  ws.send(JSON.stringify({ t: 'act', action: 'buy', itemId: 6, count: 1 }));
  await wait(800);
  ws.send(JSON.stringify({ t: 'observe' }));
  await wait(800);
  ws.close();
});
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'state') {
    console.log('[state] 场景=' + m.scene, '位置=' + JSON.stringify(m.pos), '金币=' + m.coins,
      '背包=' + m.backpack.map(p => p.name + 'x' + p.num).join(','));
  } else {
    console.log('[' + m.t + ']', JSON.stringify(m).slice(0, 200));
  }
});
ws.on('close', (code) => { console.log('[关闭]', code); process.exit(0); });
ws.on('error', (e) => { console.log('[错误]', e.message); process.exit(1); });
