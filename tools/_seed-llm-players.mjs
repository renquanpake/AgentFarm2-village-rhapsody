// 种子 2 个 LLM 玩家：A 买手(只有币) / B 卖手(有 item3 库存)
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:8091';
const jpost = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); try { return await r.json(); } catch { return { ok: false, status: r.status, text: (await r.text().catch(() => '')).slice(0, 40) }; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (agentToken) => new Promise((res) => {
  const ws = new WebSocket('ws://127.0.0.1:8091/agent?token=' + encodeURIComponent(agentToken));
  ws.on('open', () => { ws.close(); res(true); }); ws.on('error', () => res(false));
  setTimeout(() => res(false), 3000);
});
const stamp = Date.now().toString(36).slice(-5);
const mk = async (base) => {
  let r = await jpost('/af/register', { username: base + stamp, password: 'llmp' });
  if (!r.token) { r = await jpost('/af/register', { username: base + stamp + 'x', password: 'llmp' }); }
  if (!r.token) { console.error('注册失败', r); process.exit(1); }
  const a = await jpost('/af/agent-token', { token: r.token });
  await open(a.agentToken);
  return { uid: r.uid, token: r.token, agentToken: a.agentToken };
};
const out = [];
for (const [nick, coins, items] of [['llmbuyer', 50000, []], ['llmseller', 5000, [[3, 30]]]]) {
  const p = await mk(nick);
  const g = await jpost('/af/dev/give-coins', { token: p.token, amount: coins });
  for (const [id, n] of items) { await jpost('/af/dev/give-item', { token: p.token, itemId: id, amount: n }); }
  out.push({ role: nick, uid: p.uid, token: p.token, agentToken: p.agentToken, coins: g.ok ? g.coins : -1, items });
}
writeFileSync('/tmp/llm-players.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.map((o) => ({ role: o.role, uid: o.uid.slice(-4), coins: o.coins, items: o.items })), null, 1));
