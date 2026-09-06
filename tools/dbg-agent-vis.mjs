// dbg-agent-vis.mjs —— 验证：玩家 WS 能否收到自己 Agent 的移动/聊天广播（修复后）
import WebSocket from 'ws';
const BASE = 'http://127.0.0.1:8080';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// 玩家 WS（模拟 55 游戏客户端）
const pws = new WebSocket('ws://127.0.0.1:8080/ws');
await new Promise(res => pws.on('open', res));
const seen = [];
pws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (['move', 'chat', 'player_join', 'player_leave'].includes(m.t)) seen.push(m);
});
pws.send(JSON.stringify({ t: 'join', uid: 'ub3ea8b5e342d', nick: '55' }));
await wait(400);

// agent WS（55 的 agent）
const aws = new WebSocket('ws://127.0.0.1:8080/agent?token=8e5179669c4c076ecb6ac3c7fc7fcfb3');
await new Promise(res => aws.on('open', res));
await wait(600);
console.log('agent 接入后玩家收到的消息:');
seen.filter(m => m.t === 'player_join').forEach(m => console.log('  player_join:', JSON.stringify(m.p)));

// agent 移动 + 聊天
aws.send(JSON.stringify({ t: 'act', action: 'move_to', x: 3350, y: 550 }));
await wait(6000);
aws.send(JSON.stringify({ t: 'act', action: 'chat', text: '测试可见性' }));
await wait(500);

console.log('玩家收到的 move(agent):', seen.filter(m => m.t === 'move').length, '条，uid 样例:', JSON.stringify(seen.filter(m => m.t === 'move').slice(-2).map(m => m.uid)));
console.log('玩家收到的 chat(agent):', JSON.stringify(seen.filter(m => m.t === 'chat').map(m => ({ uid: m.uid, nick: m.nick, text: m.text }))));
process.exit(0);
