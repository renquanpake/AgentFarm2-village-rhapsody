import WebSocket from 'ws';
const BASE = 'http://127.0.0.1:8094';
const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const get = async (p) => (await fetch(BASE + p)).json();

const mk = async (name) => {
  const r = await post('/af/register', { username: name, password: 'refundpw' });
  const t = await post('/af/agent-token', { token: r.token });
  return { uid: r.uid, token: r.token, agent: t.agentToken };
};
const suffix = Date.now().toString().slice(-5);
const seller = await mk('rfs' + suffix);
const buyer = await mk('rfb' + suffix);

const self = async (a) => {
  const d = await get(`/af/save?uid=${encodeURIComponent(a.uid)}&token=${encodeURIComponent(a.token)}`);
  const kn = (d.datas || []).find(x => x.key === `knapData_${a.uid}`)?.val || {};
  const inv = {};
  for (const p of (kn.props || [])) inv[p.id] = p.num || 0;
  return { coins: inv[1] || 0, inv };
};

// 开两个 agent 连接
const open = (a) => new Promise((res) => {
  const ws = new WebSocket('ws://127.0.0.1:8094/agent?token=' + encodeURIComponent(a.agent));
  ws.on('open', () => res(ws));
});
let seq = 0;
const trade = (ws, payload) => new Promise((res) => {
  const s = ++seq;
  const on = (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'result' && m.seq === s) { ws.off('message', on); res(m); }
  };
  ws.on('message', on);
  ws.send(JSON.stringify({ t: 'act', action: 'trade', ...payload, seq: s }));
});

const gi = await post('/af/dev/give-item', { token: seller.token, itemId: 12, amount: 5 });
console.log('卖方获得 item12 x5 ->', JSON.stringify(gi));
const gc = await post('/af/dev/give-item', { token: buyer.token, itemId: 1, amount: 5000 });
console.log('买方获得金币 5000 ->', JSON.stringify(gc));


const wsS = await open(seller);
const wsB = await open(buyer);

const book = await trade(wsB, { op: 'book', item: 12 });
const ask = book.book.asks[0].price;
const sellPx = ask - 1;
console.log('mm ask =', ask, '-> 卖方挂单 sellPx =', sellPx);

const before = { s: await self(seller), b: await self(buyer) };
const sr = await trade(wsS, { op: 'place', item: 12, side: 'sell', price: sellPx, qty: 5 });
console.log('卖方挂卖单:', sr.ok, sr.msg || '');

const limit = sellPx + 4;
const br = await trade(wsB, { op: 'place', item: 12, side: 'buy', price: limit, qty: 2 });
console.log('买方限价', limit, '吃单 ->', br.ok, '| fills:', JSON.stringify(br.fills || []), '|', br.msg || '');

const after = { s: await self(seller), b: await self(buyer) };
const gross = 2 * sellPx;
const fee = Math.round(gross * 0.1);
console.log('\n=== 账本核对 ===');
console.log('成交总价 gross =', gross, ' 10% 手续费 =', fee);
console.log('买方净支出 =', before.b.coins - after.b.coins, '(期望', gross, '- 退差', 4 * 2, '后)');
console.log('卖方净收入 =', after.s.coins - before.s.coins, '(期望', gross - fee, ')');
console.log('卖方完整库存:', JSON.stringify(after.s.inv));
console.log('买方完整库存:', JSON.stringify(after.b.inv));
console.log('\n守恒: 买方支出', before.b.coins - after.b.coins, '== 卖方收入', after.s.coins - before.s.coins, '+ 烧币', fee, '=', (after.s.coins - before.s.coins) + fee);
const bk = await trade(wsB, { op: 'book', item: 12 });
console.log('\n剩余挂单 卖盘:', JSON.stringify(bk.book.asks), ' 买盘:', JSON.stringify(bk.book.bids));
wsS.close(); wsB.close();
process.exit(0);