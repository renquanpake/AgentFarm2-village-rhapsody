// 注册 3 个交易测试账号 + 建玩家数据 + 发币 + 取 agentToken（针对当前运行中的 8091 实例）
import WebSocket from 'ws';
const BASE = 'http://127.0.0.1:8091';
const WS_BASE = 'ws://127.0.0.1:8091';
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
const stamp = Date.now().toString(36).slice(-4);
const out = [];
for (let i = 1; i <= 3; i++) {
  let r = await jpost('/af/register', { username: 'trade' + stamp + i, password: 'tradetest' });
  if (r.status !== 200 || !r.ok || !r.token) { await sleep(400); r = await jpost('/af/register', { username: 'trade' + stamp + 'x' + i, password: 'tradetest' }); }
  if (!r.token) { console.error('注册失败', r); process.exit(1); }
  let a = await jpost('/af/agent-token', { token: r.token });
  // 开一次 agent 连接触发 ensurePlayerData（新 slot 无玩家数据）
  await openAgent(a.agentToken);
  let g = await jpost('/af/dev/give-coins', { token: r.token, amount: 50000 });
  if (!g.ok) { await sleep(300); g = await jpost('/af/dev/give-coins', { token: r.token, amount: 50000 }); }
  out.push({ uid: r.uid, token: r.token, nick: r.nick, coins: g.ok ? g.coins : -1, agentToken: a.agentToken });
}
console.log(JSON.stringify(out, null, 1));
