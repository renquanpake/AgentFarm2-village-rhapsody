// _dbg-social3.mjs —— 纯 WS 定位 socialData 落盘问题
import { readFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:8080';
const WS = 'ws://127.0.0.1:8080/ws';
const reg = async (tag) => {
  const uname = tag + Math.floor(Math.random() * 1e6).toString(36);
  await (await fetch(`${BASE}/af/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'soc!2026' }) })).json();
  return (await (await fetch(`${BASE}/af/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'soc!2026' }) })).json());
};
const A = await reg('wsA'), B = await reg('wsB');
console.log('A:', A.nick, A.uid, ' B:', B.nick, B.uid);

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
// 同位置
cA.send({ t: 'move', scene: 2, x: 6800, y: 10000 });
cB.send({ t: 'move', scene: 2, x: 6800, y: 10000 });
await new Promise(r => setTimeout(r, 800));
// A 对 B 对话
cA.send({ t: 'social_talk', target: B.nick, text: '你好' });
await new Promise(r => setTimeout(r, 1000));
console.log('A 收:', JSON.stringify(cA.inbox.filter(m => m.t === 'social_result').slice(-2)));
// A 送 B 金币
cA.send({ t: 'social_give', target: B.nick, itemId: 1, num: 30 });
await new Promise(r => setTimeout(r, 1000));
console.log('A 收2:', JSON.stringify(cA.inbox.filter(m => m.t === 'social_result').slice(-2)));
// 查好感
cA.send({ t: 'social_fav', target: B.nick });
await new Promise(r => setTimeout(r, 800));
console.log('A 收3:', JSON.stringify(cA.inbox.filter(m => m.t === 'social_result').slice(-2)));
// 读文件
const w = JSON.parse(readFileSync('D:/agent社区/AgentFarm2/data/world.json', 'utf8'));
const sd = w.datas.find(d => d.key === 'socialData');
const pairKey = [A.uid, B.uid].sort().join('_');
console.log('pairKey:', pairKey);
console.log('落盘 pairs:', JSON.stringify(sd ? sd.val.pairs : null));
process.exit(0);
