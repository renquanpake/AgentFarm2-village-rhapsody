#!/usr/bin/env node
// tools/p2p-traders.mjs —— 3 个玩家账号 P2P 互相交易（M-B1 引擎活体 P2P 验证）
// 策略：账号间"卖对方的、买自家的"交叉挂单，价格可自定义（--plan 每账号 卖价/买价 独立）：
//   A: 卖 物品2 + 买 物品3
//   B: 卖 物品3 + 买 物品2
//   C: 卖 物品2 + 买 物品3
// => 买物品3 的人(A,C) 与 卖物品3 的人(B) 成交；买物品2 的人(B) 与 卖物品2 的人(A,C) 成交 = P2P。
// 引擎层 act trade 的 price 本就是自由参数（订单簿按价格优先撮合）；本工具把 3 账号价格做成参数。
// 用法：node tools/p2p-traders.mjs --base http://127.0.0.1:8091 --creds <creds.json> [--plan <plan.json>]
//       [--duration 45000] [--slot 97] [--price 55] [--qty 5]
//   --creds: [{uid,nick,agentToken} x3]（tools/seed-traders.mjs 产出）
//   --plan:  [{sellPrice,buyPrice,sellItem?,buyItem?} x3]（缺省用 --price 统一价 + 默认物品）
//   自定义价格示例：plan.json = [{"sellPrice":50,"buyPrice":62},{"sellPrice":58,"buyPrice":45},{"sellPrice":49,"buyPrice":60}]
// 先 tools/seed-traders.mjs 建账号并发可卖库存（A/C 物品2、B 物品3）。
import WebSocket from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = (arg('--base', 'http://127.0.0.1:8091')).replace(/\/+$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const DURATION = Number(arg('--duration', '45000'));
const SLOTS = Number(arg('--slot', '97'));
const PRICE = Number(arg('--price', '55'));
const QTY = Number(arg('--qty', '5'));
const CRED = JSON.parse(readFileSync(arg('--creds') ?? '', 'utf8'));
if (!Array.isArray(CRED) || CRED.length < 3) { console.error('需要 --creds <json>（3 个 {uid,nick,agentToken}）'); process.exit(2); }
const PLAYERS = CRED.slice(0, 3);
// 默认策略：[sellItem, buyItem]
const PLAN = [[2, 3], [3, 2], [2, 3]];
// 自定义价格：--plan 每账号 {sellPrice,buyPrice,sellItem?,buyItem?}，缺省回落 --price 统一价
let CUSTOM = null;
const planFile = arg('--plan');
if (planFile) {
  CUSTOM = JSON.parse(readFileSync(planFile, 'utf8'));
  if (!Array.isArray(CUSTOM) || CUSTOM.length < 3) { console.error('--plan 需为长度>=3 的数组'); process.exit(2); }
}
const priceOf = (i, side) => CUSTOM?.[i] ? Number(CUSTOM[i][side === 'sell' ? 'sellPrice' : 'buyPrice']) ?? PRICE : PRICE;
const itemOf = (i, role) => CUSTOM?.[i]?.[role === 'sell' ? 'sellItem' : 'buyItem'] ?? PLAN[i][role === 'sell' ? 0 : 1];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const openAgent = (agentToken) => new Promise((res, rej) => {
  const ws = new WebSocket(WS_BASE + '/agent?token=' + encodeURIComponent(agentToken));
  ws.on('open', () => res(ws)); ws.on('error', rej);
});
const callAct = (ws, o, timeoutMs = 2500) => new Promise((res) => {
  const seq = Math.random().toString(36).slice(2, 10);
  const on = (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'result' && m.action === o.action && m.seq === seq) { ws.off('message', on); res(m); } };
  ws.on('message', on);
  setTimeout(() => { ws.off('message', on); res(null); }, timeoutMs);
  ws.send(JSON.stringify({ ...o, seq }));
});
async function trader(i, p) {
  const ws = await openAgent(p.agentToken);
  const sellItem = itemOf(i, 'sell'), buyItem = itemOf(i, 'buy');
  const sellPrice = priceOf(i, 'sell'), buyPrice = priceOf(i, 'buy');
  const st = { ok: 0, fail: 0, fills: 0 };
  const end = Date.now() + DURATION;
  while (Date.now() < end) {
    const s = await callAct(ws, { t: 'act', action: 'trade', op: 'place', itemId: sellItem, side: 'sell', price: sellPrice, qty: QTY });
    if (s) { st.ok += s.ok ? 1 : 0; st.fail += s.ok ? 0 : 1; st.fills += (s.ok && typeof s.fills === 'number') ? s.fills : 0; }
    const b = await callAct(ws, { t: 'act', action: 'trade', op: 'place', itemId: buyItem, side: 'buy', price: buyPrice, qty: QTY });
    if (b) { st.ok += b.ok ? 1 : 0; st.fail += b.ok ? 0 : 1; st.fills += (b.ok && typeof b.fills === 'number') ? b.fills : 0; }
    await sleep(350);
  }
  ws.close();
  return { idx: i, uid: p.uid, nick: p.nick, sell: `${sellItem}@${sellPrice}`, buy: `${buyItem}@${buyPrice}`, ...st };
}

const results = await Promise.all(PLAYERS.map((p, i) => trader(i, p)));
console.log('[p2p] 3 账号 P2P 挂单完成：');
for (const r of results) console.log(`  ${r.nick}(${r.uid.slice(-4)}): 卖${r.sell}/买${r.buy} ok=${r.ok} fail=${r.fail} fills=${r.fills}`);

// 查 P2P 成交矩阵（market_fills: maker/taker 均为 3 玩家）
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = join(root, 'data', 'saves', `slot${SLOTS}`, 'events.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
const uids = PLAYERS.map(p => p.uid);
const rows = db.prepare('SELECT item_id, price, qty, maker, taker FROM market_fills WHERE maker IN (?,?,?) AND taker IN (?,?,?) ORDER BY ts').all(uids[0], uids[1], uids[2], uids[0], uids[1], uids[2]);
const nm = (uid) => PLAYERS.find(p => p.uid === uid)?.nick || String(uid);
const matrix = {};
for (const r of rows) {
  const key = [nm(String(r.maker)), nm(String(r.taker))].sort().join(' <-> ');
  matrix[key] = (matrix[key] || 0) + Number(r.qty);
}
db.close();
console.log('[p2p] 玩家间 P2P 成交（maker/taker 均为 3 账号）：');
console.log(JSON.stringify({ p2pRows: rows.length, p2pQty: rows.reduce((a, r) => a + Number(r.qty), 0), matrix }, null, 1));
