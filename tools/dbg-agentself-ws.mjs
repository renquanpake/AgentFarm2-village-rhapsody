// dbg-agentself-ws.mjs —— 双 WS 验证：本账号玩家收到 agent_move，而非 move(uid) 创建化身
import WebSocket from 'ws';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function post(p, b){ const r=await fetch('http://127.0.0.1:8080'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}); return r.json(); }
const login = await post('/af/login', { username:'test3', password:'1234' });
const at = await post('/af/agent-token', { token: login.token });
console.log('uid:', login.uid);

// 1. 玩家本账号 WS
const pws = new WebSocket('ws://127.0.0.1:8080/ws');
await new Promise(r=>pws.on('open',r));
pws.send(JSON.stringify({ t:'join', uid:login.uid, nick:'test3' }));
let recv = [];
pws.on('message', raw => { try { const m=JSON.parse(raw.toString()); if(['agent_move','move','player_join'].includes(m.t)) recv.push(m.t + (m.t==='agent_move'?`(${m.x},${m.y})`:m.t==='move'?`(${m.uid})`:'()')); } catch(e){} });
await wait(400);

// 2. agent WS，直接 move_to
const aws = new WebSocket('ws://127.0.0.1:8080/agent?token=' + at.agentToken);
await new Promise(r=>aws.on('open',r));
await wait(400);
aws.send(JSON.stringify({ t:'act', action:'move_to', x:3350, y:2500 }));

await wait(6000);
console.log('本账号收到的 agent 移动消息:', recv.join(', '));
const hasAgentMove = recv.some(m => m.startsWith('agent_move'));
const hasMoveSelf = recv.some(m => m.startsWith('move') && m.includes(login.uid) && !m.includes('agent'));
console.log(hasAgentMove ? '✅ 本账号收到 agent_move（驱动唯一主角）' : '❌ 未收到 agent_move');
console.log(hasMoveSelf ? '⚠️ 收到 move(自己uid) → 会误创建第二个化身!' : '✅ 无 move(自己uid)，不会创建第二个化身');
process.exit(0);
