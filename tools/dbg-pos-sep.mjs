// dbg-pos-sep.mjs —— 验证 Agent 位置独立：agent 移动后，玩家保存不会覆盖 agent 位置
import WebSocket from 'ws';
const BASE = 'http://127.0.0.1:8080';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const login = await post('/af/login', { username: 'test3', password: '1234' });
const at = await post('/af/agent-token', { token: login.token });

// agent 连接
const aws = new WebSocket('ws://127.0.0.1:8080/agent?token=' + at.agentToken);
await new Promise(res => aws.on('open', res));
await wait(400);
function call(ws, msg) {
  return new Promise((res) => {
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'result' && m.action === msg.action) { ws.off('message', onMsg); res(m); }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify(msg));
    setTimeout(() => { ws.off('message', onMsg); res({ ok: false, msg: 'timeout' }); }, 15000);
  });
}
// move_to 走完
const mv = await call(aws, { t: 'act', action: 'move_to', x: 3350, y: 2350 });
console.log('move_to 发起:', mv.msg);
if (mv.msg && mv.msg.startsWith('已开始')) {
  await new Promise((res) => {
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'result' && m.action === 'move_to' && m.pos) { aws.off('message', onMsg); res(); }
    };
    aws.on('message', onMsg);
    setTimeout(res, 10000);
  });
}
// 玩家连接：保存（模拟玩家在游戏里操作覆盖 playerData）
const pws = new WebSocket('ws://127.0.0.1:8080/ws');
await new Promise(res => pws.on('open', res));
pws.send(JSON.stringify({ t: 'join', uid: login.uid, nick: 'test3' }));
await wait(300);
// 玩家保存自己的 playerData（位置 100,100 —— 完全不同的位置）
const pd = { uID: login.uid, playerPos: { x: 100, y: 100, z: 0 }, sceneType: 2, day: 3 };
pws.send(JSON.stringify({ t: 'save', kv: [['playerData_' + login.uid, JSON.stringify(pd)]] }));
await wait(500);

// agent observe 看位置是否被覆盖
const obs = await new Promise((res) => {
  const onMsg = (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'state') { aws.off('message', onMsg); res(m); }
  };
  aws.on('message', onMsg);
  aws.send(JSON.stringify({ t: 'observe' }));
  setTimeout(() => res(null), 5000);
});
console.log('玩家保存(playerPos=100,100)后 agent 位置:', JSON.stringify(obs && obs.pos));
console.log(obs && obs.pos && obs.pos.x === 3350 && obs.pos.y === 2350
  ? '✅ 位置独立：玩家存档没有覆盖 Agent 位置'
  : '❌ 位置被覆盖！');
process.exit(0);
