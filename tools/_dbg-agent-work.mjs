// _dbg-agent-work.mjs —— 完整 till/water/harvest（简化move循环+修正方向）
const BASE = 'http://127.0.0.1:8080';
const WS_A = 'ws://127.0.0.1:8080/ws';
async function reg(tag) {
  const uname = tag + Math.floor(Math.random() * 1e6).toString(36);
  await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'aw!2026' }) })).json();
  const l = await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'aw!2026' }) })).json();
  return l;
}
const A = await reg('agentA');
// 先让玩家A在线到农田(3500,3000)
const pA = await new Promise(r => { const ws = new WebSocket(WS_A); ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', uid: A.uid, nick: A.nick, scene: 2, x: 3500, y: 3000 })); r({ ws }); }; });
await new Promise(r => setTimeout(r, 500));
const agt = await (await fetch(`${BASE}/af/agent-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: A.token }) })).json();
const aws = await new Promise(r => { const ws = new WebSocket(`ws://127.0.0.1:8080/agent?token=${agt.agentToken}`); const inbox = []; ws.onopen = () => r({ ws, inbox, send: o => ws.send(JSON.stringify(o)) }); ws.onmessage = e => inbox.push(JSON.parse(e.data)); });
await new Promise(r => setTimeout(r, 800));
const ask = (msg) => aws.send(msg);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const state = () => aws.inbox.filter(m => m.t === 'state').pop();
const results = () => aws.inbox.filter(m => m.t === 'result');

// observe
ask({ t: 'observe' }); await wait(1000);
const o0 = state();
console.log('起点:', o0?.pos, 'tillableNear:', o0?.tillableNear?.length);
const tillable = o0?.tillableNear;
const target = tillable?.[0];
if (!target) { console.log('无可耕地'); ws.close(); process.exit(1); }
console.log(`目标 (${target.gx},${target.gy}) px=${target.px} py=${target.py}`);
const ax = Math.floor(o0.pos.x / 100), ay = Math.floor(o0.pos.y / 100);
const nx = target.gx - ax, ny = target.gy - ay;
console.log(`需要 dx=${nx} dy=${ny}`);
// move 步进：逐方向分开走（dx和dy各走若干步）
for (let i = 0; i < Math.abs(nx); i++) { ask({ t: 'act', action: 'move', dir: nx > 0 ? 'right' : 'left' }); await wait(500); }
for (let i = 0; i < Math.abs(ny); i++) { const dir = ny > 0 ? 'up' : 'down'; ask({ t: 'act', action: 'move', dir }); await wait(500); }
await wait(500);
ask({ t: 'observe' }); await wait(1000);
const o1 = state();
const cx = Math.floor(o1.pos.x / 100), cy = Math.floor(o1.pos.y / 100);
console.log('移到:', cx, cy, '目标:', target.gx, target.gy, '差:', Math.abs(cx - target.gx), Math.abs(cy - target.gy));

// buy种子
ask({ t: 'act', action: 'buy', itemId: 36, count: 5 }); await wait(700);
console.log('buy:', results().pop()?.msg);
ask({ t: 'observe' }); await wait(600);
const seed = state()?.backpack?.find(b => b.id === 36);
console.log('种子数:', seed?.num ?? 0);

if (Math.abs(cx - target.gx) <= 1 && Math.abs(cy - target.gy) <= 1) {
  console.log('\n--- till→plant→water×3→harvest ---');
  ask({ t: 'act', action: 'till', x: target.px, y: target.py }); await wait(600);
  console.log('till:', results().pop()?.msg);
  ask({ t: 'act', action: 'plant', x: target.px, y: target.py, itemId: 36 }); await wait(600);
  console.log('plant:', results().pop()?.msg);
  for (let i = 0; i < 3; i++) { ask({ t: 'act', action: 'water', x: target.px, y: target.py }); await wait(500); }
  const ws2 = results().filter(m => m.action === 'water');
  console.log('water x3:', ws2.map(w => w.msg).join(' | '));
  ask({ t: 'act', action: 'harvest', x: target.px, y: target.py }); await wait(600);
  console.log('harvest:', results().pop()?.msg);
  ask({ t: 'observe' }); await wait(800);
  const o3 = state();
  console.log('plotsNear:', o3?.plotsNear?.map(p => p.status).join(' | ') || '空');
  console.log('backpack:', o3?.backpack?.filter(b => b.num > 0).map(b => b.name + '×' + b.num).join(', '));
  console.log('agent_activity:', aws.inbox.filter(m => m.t === 'agent_activity').map(a => a.activity).join(' → '));
} else {
  console.log('未能到达相邻格 (差' + Math.abs(cx - target.gx) + ',' + Math.abs(cy - target.gy) + ')');
}
aws.ws.close(); pA.ws.close();
process.exit(0);
