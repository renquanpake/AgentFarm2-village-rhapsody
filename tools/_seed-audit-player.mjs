import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:8091';
const jpost = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); try { return await r.json(); } catch { return { ok: false, status: r.status }; } };
const open = (at) => new Promise((res) => { const ws = new WebSocket('ws://127.0.0.1:8091/agent?token=' + at); ws.on('open', () => { ws.close(); res(true); }); ws.on('error', () => res(false)); setTimeout(() => res(false), 3000); });
const stamp = Date.now().toString(36).slice(-5);
let r = await jpost('/af/register', { username: 'audit' + stamp, password: 'audit' });
if (!r.token) { console.error('注册失败', r); process.exit(1); }
const a = await jpost('/af/agent-token', { token: r.token });
await open(a.agentToken);
await jpost('/af/dev/give-coins', { token: r.token, amount: 30000 });
await jpost('/af/dev/give-item', { token: r.token, itemId: 2, amount: 20 });   // 木材
await jpost('/af/dev/give-item', { token: r.token, itemId: 3, amount: 10 });   // 种子
writeFileSync('/tmp/audit-player.json', JSON.stringify({ uid: r.uid, accToken: r.token, agentToken: a.agentToken, nick: r.nick }, null, 1));
console.log(JSON.stringify({ uid: r.uid.slice(-4), coins: 30000, wood20: true, seed10: true }));
