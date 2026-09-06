// dbg-inbox.mjs —— 端到端：玩家 WS 发指挥消息 → agent 收件箱 → agent 拉取 → 玩家操作打断推送
import WebSocket from 'ws';
const BASE = 'http://127.0.0.1:8080';
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// 1. 玩家登录（test3 已有 agent 通道权限）
const r = await post('/af/login', { username: 'test3', password: '1234' });
const { token, uid } = r;
const rt = await post('/af/agent-token', { token });
console.log('玩家 uid:', uid);

// 2. 玩家 WS 连接（模拟游戏客户端）
const pws = new WebSocket('ws://127.0.0.1:8080/ws');
await new Promise(res => pws.on('open', res));
pws.send(JSON.stringify({ t: 'join', uid, nick: '测试玩家' }));
await wait(300);

// 3. agent WS 连接
const aws = new WebSocket('ws://127.0.0.1:8080/agent?token=' + rt.agentToken);
await new Promise(res => aws.on('open', res));
await wait(300);
let pushed = [];
aws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'inbox_push' || m.t === 'player_op') pushed.push(m);
});

// 4. 玩家发指挥消息（不打断）
pws.send(JSON.stringify({ t: 'agent_msg', text: '小六，帮我去河边钓一条鱼！' }));
await wait(500);

// 5. agent 拉取收件箱
const ib = await new Promise((res) => {
  const onMsg = (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'inbox') { aws.off('message', onMsg); res(m); }
  };
  aws.on('message', onMsg);
  aws.send(JSON.stringify({ t: 'inbox' }));
  setTimeout(() => res({ msgs: 'timeout' }), 5000);
});
console.log('agent 收到收件箱:', JSON.stringify(ib.msgs));

// 6. 玩家游戏操作（模拟存档变化）→ agent 应收到 player_op 推送
pws.send(JSON.stringify({ t: 'save', kv: [['plantData_100001', JSON.stringify({ datas: [] })]] }));
await wait(500);
console.log('agent 收到推送:', JSON.stringify(pushed));

// 7. 玩家频道聊天（不应触发 player_op）
pws.send(JSON.stringify({ t: 'chat', text: '大家晚上好' }));
await wait(300);
pws.send(JSON.stringify({ t: 'agent_interrupt' }));
await wait(500);
console.log('agent 收到推送(含 interrupt):', JSON.stringify(pushed.map(p => p.t)));

process.exit(0);
