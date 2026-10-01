#!/usr/bin/env node
// tools/trader-bot.mjs —— 单账号交易员机器人（M-B1 引擎活体验证用）
// 连接 /agent 托管通道，对若干物品双边挂单（买 ask / 卖 bid）一段时间，
// 统计成交，并拉 /af/shadow?days=1 快照（需账号 token），输出 JSON 报告供验收。
// 用法：node tools/trader-bot.mjs --agent-token <at> --token <accountToken> --uid <uid>
//       [--base http://127.0.0.1:8091] [--duration 60000] [--items 1,2,3]
import WebSocket from 'ws';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const at = arg('--agent-token');
const accToken = arg('--token');
const uid = arg('--uid');
const BASE = (arg('--base', 'http://127.0.0.1:8091')).replace(/\/+$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const DURATION = Number(arg('--duration', '60000'));
const ITEMS = String(arg('--items', '1,2,3')).split(',').map(s => Number(s)).filter(n => Number.isFinite(n) && n > 0);
if (!at) { console.error('缺少 --agent-token'); process.exit(2); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ws = new WebSocket(WS_BASE + '/agent?token=' + encodeURIComponent(at));
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
ws.on('error', () => { /* keep-alive 偶发 reset，不致命 */ });

const waiters = new Map(); // seq -> resolver
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.t === 'result' && m.action === 'trade' && m.seq) {
    const w = waiters.get(m.seq);
    if (w) { waiters.delete(m.seq); w(m); }
  }
});
// 发一个 act 并等对应 result（seq 匹配；超时返 null）
const callAct = (o, timeoutMs = 2500) => new Promise((res) => {
  const seq = Math.random().toString(36).slice(2, 10);
  waiters.set(seq, res);
  const t = setTimeout(() => { if (waiters.delete(seq)) res(null); }, timeoutMs);
  ws.send(JSON.stringify({ ...o, seq }));
});
const bookOf = async (item) => (await callAct({ t: 'act', action: 'trade', op: 'book', itemId: item }))?.book || null;

const st = { orders: 0, placedOk: 0, placedFail: 0, fills: 0, lastErr: null };
const itemStats = Object.fromEntries(ITEMS.map(i => [i, { buyFills: 0, sellFills: 0 }]));
const end = Date.now() + DURATION;
let cycle = 0;
while (Date.now() < end) {
  for (const item of ITEMS) {
    if (Date.now() >= end) break;
    const book = await bookOf(item);
    const ask = book?.asks?.[0];
    const bid = book?.bids?.[0];
    const qty = 1 + (cycle % 2);
    // 买：吃 ask 卖价（无 ask 则挂略高买价）
    const b = await callAct({ t: 'act', action: 'trade', op: 'place', itemId: item, side: 'buy', price: ask ? ask.price : 12, qty });
    // 卖：挂 bid 买价成交（消耗库存；新号初期可能"物品不足"，属预期）
    const s = await callAct({ t: 'act', action: 'trade', op: 'place', itemId: item, side: 'sell', price: bid ? bid.price : 8, qty: 1 });
    for (const r of [b, s]) {
      st.orders++;
      if (!r) continue;
      if (r.ok) {
        st.placedOk++;
        const f = typeof r.fills === 'number' ? r.fills : 0;
        st.fills += f;
        if (f > 0) itemStats[item][r.side === 'sell' ? 'sellFills' : 'buyFills'] += f;
      } else { st.placedFail++; st.lastErr = r.msg; }
    }
    cycle++;
    await sleep(300);
  }
}
ws.close();
await sleep(300);
let shadow = null;
if (accToken) {
  try { shadow = await (await fetch(`${BASE}/af/shadow?token=${encodeURIComponent(accToken)}&days=1`)).json(); } catch { /* ignore */ }
}
console.log(JSON.stringify({ uid, base: BASE, durationMs: DURATION, ...st, itemStats, shadow }));
process.exit(0);
