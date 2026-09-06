// _dbg-partner.mjs —— 伴侣流程：攒好感→绑定伴侣→传送
import { readFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:8080';
const WS = 'ws://127.0.0.1:8080/ws';
const reg = async (tag) => {
  const uname = tag + Math.floor(Math.random() * 1e6).toString(36);
  await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'soc!2026' }) })).json();
  return (await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'soc!2026' }) })).json());
};
const A = await reg('ptA'), B = await reg('ptB');
function conn(token, uid, nick) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    const inbox = [];
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', uid, nick })); resolve({ ws, inbox, send: (o) => ws.send(JSON.stringify(o)) }); };
    ws.onmessage = (e) => { inbox.push(JSON.parse(e.data)); };
  });
}
const cA = await conn(A.token, A.uid, A.nick);
const cB = await conn(B.token, B.uid, B.nick);
await new Promise(r => setTimeout(r, 500));
cA.send({ t: 'move', scene: 2, x: 6800, y: 10000 });
cB.send({ t: 'move', scene: 2, x: 6800, y: 10000 });
await new Promise(r => setTimeout(r, 800));
// 送 18 次金币（每次 +5 = 90）
for (let i = 0; i < 18; i++) {
  cA.send({ t: 'social_give', target: B.nick, itemId: 1, num: 5 });
  await new Promise(r => setTimeout(r, 120));
}
await new Promise(r => setTimeout(r, 800));
cA.send({ t: 'social_fav', target: B.nick });
await new Promise(r => setTimeout(r, 800));
console.log('好感:', JSON.stringify(cA.inbox.filter(m => m.t === 'social_result' && m.social === 'fav').slice(-1)));
// 绑定伴侣
cA.send({ t: 'social_bind', target: B.nick, type: 'partner' });
await new Promise(r => setTimeout(r, 800));
console.log('绑定:', JSON.stringify(cA.inbox.filter(m => m.t === 'social_result' && m.social === 'bind').slice(-1)));
// B 挪远，A 传送
cB.send({ t: 'move', scene: 2, x: 3000, y: 5000 });
await new Promise(r => setTimeout(r, 500));
cA.send({ t: 'social_tp', target: B.nick });
await new Promise(r => setTimeout(r, 800));
const tpRes = cA.inbox.filter(m => m.t === 'social_result' && m.social === 'tp').slice(-1)[0];
const tpApply = cA.inbox.filter(m => m.t === 'social_tp_apply').slice(-1)[0];
console.log('传送结果:', JSON.stringify(tpRes), 'apply:', JSON.stringify(tpApply));
// 落盘检查
const w = JSON.parse(readFileSync('D:/agent社区/AgentFarm2/data/world.json', 'utf8'));
const sd = w.datas.find(d => d.key === 'socialData');
const pairKey = [A.uid, B.uid].sort().join('_');
console.log('落盘 pair:', pairKey, '→', JSON.stringify(sd.val.pairs[pairKey]));
process.exit(0);
