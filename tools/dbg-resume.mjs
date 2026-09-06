// dbg-resume.mjs —— 验证：agent_status（托管中显示）+ agent_resume（恢复行动）
import WebSocket from 'ws';
const BASE = 'http://127.0.0.1:8080';
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const r = await post('/af/login', { username: 'test3', password: '1234' });
const rt = await post('/af/agent-token', { token: r.token });
const uid = r.uid;

// 玩家 WS
const pws = new WebSocket('ws://127.0.0.1:8080/ws');
await new Promise(res => pws.on('open', res));
const statuses = [];
pws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'agent_status') statuses.push(m);
});
pws.send(JSON.stringify({ t: 'join', uid, nick: '测试玩家' }));
await wait(300);
console.log('join 后状态(应 offline):', JSON.stringify(statuses[statuses.length - 1]));

// agent WS
const aws = new WebSocket('ws://127.0.0.1:8080/agent?token=' + rt.agentToken);
await new Promise(res => aws.on('open', res));
const pushes = [];
aws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'agent_resume' || m.t === 'player_op') pushes.push(m);
});
await wait(500);
console.log('agent 上线后状态(应 online):', JSON.stringify(statuses[statuses.length - 1]));

// HTTP 状态 API
const st = await (await fetch(BASE + '/af/agent-status?token=' + encodeURIComponent(r.token))).json();
console.log('HTTP agent-status:', JSON.stringify(st));

// 玩家发恢复指令
pws.send(JSON.stringify({ t: 'agent_resume' }));
await wait(400);
console.log('agent 收到 resume 推送:', JSON.stringify(pushes.map(p => p.t)));

// agent 下线 → 状态 offline
aws.close();
await wait(500);
console.log('agent 下线后状态(应 offline):', JSON.stringify(statuses[statuses.length - 1]));
process.exit(0);
