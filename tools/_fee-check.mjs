// 实机验证 10% 手续费：C 卖 item3@52x10（resting），A 吃单 P2P；查 C 实收 + moneySupply
import { execSync } from 'node:child_process';
import WebSocket from 'ws';
const B = 'http://127.0.0.1:8091';
const run = (cmd) => JSON.parse(execSync(cmd, { encoding: 'utf8' }));
const jpost = async (p, d) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d || {}) }); try { return await r.json(); } catch { return {}; } };
const open = (at) => new Promise((res) => { const w = new WebSocket('ws://127.0.0.1:8091/agent?token=' + at); w.on('open', () => { w.close(); res(true); }); w.on('error', () => res(false)); setTimeout(() => res(false), 3000); });
const stamp = Date.now().toString(36).slice(-5);
const mk = async (n) => { let r = await jpost('/af/register', { username: n + stamp, password: 'test1234' }); if (!r.token) { await new Promise((s) => setTimeout(s, 300)); r = await jpost('/af/register', { username: n + stamp + 'y', password: 'test1234' }); } const a = await jpost('/af/agent-token', { token: r.token }); await open(a.agentToken); return { uid: r.uid, acc: r.token, agent: a.agentToken }; };
const self = (p) => run(`node tools/llm-player.mjs self ${p.acc} ${p.uid}`);
const trade = (p, item, side, price, qty) => run(`node tools/llm-player.mjs trade ${p.agent} ${item} ${side} ${price} ${qty}`);

const A = await mk('feeA');
const C = await mk('feeC');
await jpost('/af/dev/give-coins', { token: A.acc, amount: 20000 });
await jpost('/af/dev/give-item', { token: C.acc, itemId: 3, amount: 10 });
const c0 = self(C).coins;
const rC = trade(C, 3, 'sell', 52, 10);
const rA = trade(A, 3, 'buy', 52, 10);
const c1 = self(C).coins;
console.log('C sell:', JSON.stringify(rC));
console.log('A buy :', JSON.stringify(rA));
console.log(JSON.stringify({ C_before: c0, C_after: c1, C_received: c1 - c0, expectedNet: Math.round(52 * 10 * 0.9), expectedGross: 520 }, null, 1));
