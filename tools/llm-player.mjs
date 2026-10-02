#!/usr/bin/env node
// tools/llm-player.mjs —— LLM 玩家接入游戏接口的最小 CLI（M-B1 P2P 对话交易用）
// 子命令（均为一次性，读完即退）：
//   book  <accToken> <item>              GET /af/market/<item>  看盘口（best bid/ask + top 档）
//   self  <accToken> <uid>              GET /af/save           看自己金币/库存
//   trade <agentToken> <item> <side> <price> <qty>   WS /agent act trade place 挂单
// 用法示例：
//   node tools/llm-player.mjs book  <accToken> 3
//   node tools/llm-player.mjs self  <accToken> <uid>
//   node tools/llm-player.mjs trade <agentToken> 3 buy 42 10
import WebSocket from 'ws';
const BASE = process.env.AF_BASE || 'http://127.0.0.1:8091';
const cmd = process.argv[2];
const a = process.argv.slice(3);
const j = (o) => console.log(JSON.stringify(o, null, 1));

if (cmd === 'book') {
  const [accToken, item] = a;
  const r = await fetch(`${BASE}/af/market/${item}?token=${encodeURIComponent(accToken)}&days=1`);
  const d = await r.json().catch(() => ({}));
  const bk = d.book || {};
  const top = (arr, n) => (arr || []).slice(0, n);
  j({ item: Number(item), basePrice: d.basePrice, last: bk.last || null,
     bestBid: top(bk.bids, 3), bestAsk: top(bk.asks, 3) });
} else if (cmd === 'self') {
  const [accToken, uid] = a;
  const r = await fetch(`${BASE}/af/save?uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(accToken)}`);
  const d = await r.json().catch(() => ({}));
  const kn = (d.datas || []).find(x => x.key === `knapData_${uid}`)?.val || {};
  const inv = {};
  for (const p of (kn.props || [])) inv[p.id] = p.num || 0;
  j({ uid, coins: inv[1] || 0, inv });
} else if (cmd === 'trade') {
  const [agentToken, item, side, price, qty] = a;
  const WS_BASE = BASE.replace(/^http/, 'ws');
  const ws = new WebSocket(WS_BASE + '/agent?token=' + encodeURIComponent(agentToken));
  const seq = Math.random().toString(36).slice(2, 10);
  let done = false;
  const out = (m) => { done = true; j(m); ws.close(); process.exit(0); };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'act', action: 'trade', op: 'place', itemId: Number(item), side, price: Number(price), qty: Number(qty), seq })));
  ws.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'result' && m.action === 'trade' && m.seq === seq) out({ ...m, item: Number(item) }); });
  ws.on('error', () => { if (!done) out({ ok: false, msg: 'ws error' }); });
  setTimeout(() => { if (!done) out({ ok: false, msg: 'timeout' }); }, 4000);
} else {
  console.error('未知命令：' + cmd);
  console.error('用法：book <accToken> <item> | self <accToken> <uid> | trade <agentToken> <item> <side> <price> <qty>');
  process.exit(2);
}
