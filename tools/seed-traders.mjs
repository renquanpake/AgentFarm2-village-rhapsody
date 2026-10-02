// 注册 3 个交易测试账号 + 建玩家数据 + 发币 + 发可卖库存 + 取 agentToken（针对运行中的 8091 实例）
// 库存按 P2P 策略发：账号0/2 发 物品2，账号1 发 物品3（对应 p2p-traders 的 [卖2买3,卖3买2,卖2买3]）
import WebSocket from 'ws';
const BASE = 'http://127.0.0.1:8091';
const WS_BASE = 'ws://127.0.0.1:8091';
const OUT = process.argv[2] || '/tmp/p2p-creds.json';
const jpost = async (p, b) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  const j = await r.json().catch(() => ({}));
  j.status = r.status;
  return j;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const openAgent = (agentToken) => new Promise((res) => {
  const ws = new WebSocket(WS_BASE + '/agent?token=' + encodeURIComponent(agentToken));
  ws.on('open', () => { ws.close(); res(true); });
  ws.on('error', () => res(false));
  setTimeout(() => res(false), 3000);
});
const GIVE_ITEMS = [[2, 40], [3, 40], [2, 40]]; // [itemId, num] 对应 3 账号
const stamp = Date.now().toString(36).slice(-4);
const out = [];
for (let i = 1; i <= 3; i++) {
  let r = await jpost('/af/register', { username: 'trade' + stamp + i, password: 'tradetest' });
  if (r.status !== 200 || !r.ok || !r.token) { await sleep(400); r = await jpost('/af/register', { username: 'trade' + stamp + 'x' + i, password: 'tradetest' }); }
  if (!r.token) { console.error('注册失败', r); process.exit(1); }
  let a = await jpost('/af/agent-token', { token: r.token });
  await openAgent(a.agentToken); // 触发 ensurePlayerData（新 slot 无玩家数据）
  let g = await jpost('/af/dev/give-coins', { token: r.token, amount: 50000 });
  if (!g.ok) { await sleep(300); g = await jpost('/af/dev/give-coins', { token: r.token, amount: 50000 }); }
  const gi = GIVE_ITEMS[i - 1];
  const giRes = await jpost('/af/dev/give-item', { token: r.token, itemId: gi[0], amount: gi[1] });
  out.push({ uid: r.uid, token: r.token, nick: r.nick, coins: g.ok ? g.coins : -1, gaveItem: { id: gi[0], num: gi[1], ok: giRes.ok }, agentToken: a.agentToken });
}
const { writeFileSync } = await import('node:fs');
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('凭据写入 ' + OUT);
console.log(JSON.stringify(out.map(o => ({ nick: o.nick, coins: o.coins, item: o.gaveItem, uid: o.uid.slice(-4) })), null, 1));
