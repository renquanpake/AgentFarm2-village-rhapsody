#!/usr/bin/env node
// tools/shadow-observe.mjs —— B4 影子模式观察流量驱动 + M-B1 验收快照
// 用法（目标服务器需已启动，AF_BASE 指向它）：
//   AF_BASE=http://127.0.0.1:8080 node tools/shadow-observe.mjs [--drivers 3] [--duration 180000] [--out data/eval/shadow-live-check.json]
// 做的事：注册 N 个观察账号 -> 发币 -> 取 agent 接入码 -> /agent 通道周期跨价挂单（买 ask/卖 bid）->
// 结束后取 /af/shadow?days=1 报告 + 记录观察起点（M-B1 门为 14 真实日窗口，本报告是
// 引擎活体验证 + 观察期启动凭据；14 日后同命令复查即验收）。
// 注意：act/trade 消息只在托管 /agent 通道处理（/ws 游戏通道忽略 act）。
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = (process.env.AF_BASE || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const N = Number(arg('--drivers', '3'));
const DURATION = Number(arg('--duration', '180000'));
const DAYS = Number(arg('--days', '1')); // 1=活体验证快照（观察期启动凭据）；14=M-B1 判门复查
const OUT = arg('--out', join(ROOT, 'data', 'eval', 'shadow-live-check.json'));
const ITEMS = [1, 2, 3]; // 小麦/种子等基础品（basePrice 各不同，跨品流动性）

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jpost = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify(body) });
  try { return await r.json(); } catch { return { ok: false, status: r.status, msg: await r.text().catch(() => '') }; }
};

// 1) 注册观察账号 + 发币（保证买盘预留足够）；用户名 <=16 位
const drivers = [];
const stamp = Date.now().toString(36).slice(-5);
for (let i = 1; i <= N; i++) {
  let r = await jpost('/af/register', { username: `sobs${stamp}${i}`, password: 'shadowobs' });
  if (r.ok === false) {
    await sleep(1000);
    r = await jpost('/af/register', { username: `sobs${stamp}x${i}`, password: 'shadowobs' });
  }
  if (!r.ok || !r.token) { console.error('[shadow-obs] 注册失败:', r.msg); process.exit(1); }
  const g = await jpost('/af/dev/give-coins', { token: r.token, amount: 50000 });
  drivers.push({ uid: r.uid, token: r.token, nick: r.nick, coins: g.ok ? g.coins : -1 });
}
console.log(`[shadow-obs] 账号就绪 ${drivers.map(d => d.uid + '(' + d.coins + '币)').join(', ')}`);

// 2) 托管 /agent 通道挂单（act/trade 只在该通道处理；/ws 游戏通道忽略 act）
class Driver {
  constructor(d) { this.d = d; this.fills = 0; this.orders = 0; }
  async openAgent() {
    // keep-alive 空闲连接偶发 ECONNRESET：重试兜底
    let d2 = null;
    for (let i = 0; i < 3 && !d2?.ok; i++) {
      try {
        const r = await fetch(BASE + '/af/agent-token', { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify({ token: this.d.token }) });
        d2 = await r.json();
      } catch {
        await sleep(1500);
      }
    }
    if (!d2?.ok || !d2.agentToken) throw new Error('agent-token 获取失败: ' + JSON.stringify(d2).slice(0, 120));
    const ws = new WebSocket(WS_BASE + '/agent?token=' + encodeURIComponent(d2.agentToken));
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'result' && m.action === 'trade' && m.ok && typeof m.fills === 'number' && m.fills > 0) {
        this.fills += m.fills;
      }
    });
    return ws;
  }
  async run() {
    const ws = this.ws || await this.openAgent();
    const end = Date.now() + DURATION;
    while (Date.now() < end) {
      const item = ITEMS[this.orders % ITEMS.length];
      // 查订单簿拿最新盘口
      let book = null;
      try {
        const r = await this.act(ws, { t: 'act', action: 'trade', op: 'book', itemId: item });
        book = r && r.book;
      } catch { /* ignore */ }
      const ask = book?.asks?.[0]; const bid = book?.bids?.[0];
      const qty = 1 + (this.orders % 3);
      if (ask) this.sendAct(ws, { t: 'act', action: 'trade', op: 'place', itemId: item, side: 'buy', price: ask.price, qty });
      else this.sendAct(ws, { t: 'act', action: 'trade', op: 'place', itemId: item, side: 'buy', price: Math.max(1, (ask ? ask.price : 10)), qty });
      if (bid) this.sendAct(ws, { t: 'act', action: 'trade', op: 'place', itemId: item, side: 'sell', price: bid.price + 1, qty: 1 });
      this.orders++;
      await sleep(6000 + Math.floor(Math.random() * 6000)); // 6-12s 节奏
    }
    try { ws.close(); } catch { /* ignore */ }
  }
  sendAct(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ } }
  act(ws, obj) {
    return new Promise((resolve) => {
      const to = setTimeout(() => { ws.off('message', on); resolve(null); }, 5000);
      const on = raw => {
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.t === 'trade_book' || (m.t === 'result' && m.action === 'trade')) {
          clearTimeout(to); ws.off('message', on); resolve(m);
        }
      };
      ws.on('message', on);
      ws.send(JSON.stringify(obj));
    });
  }
}

const startedAt = new Date().toISOString();
console.log(`[shadow-obs] 流量循环开始 ${DURATION / 1000}s（${N} 司机 x 品 ${ITEMS.join('/')}）...`);
const ds = drivers.map(d => new Driver(d));
// openAgent 串行（避免并发连接堆积触发 keep-alive 竞态），流量循环并行
for (const d of ds) {
  const ws = await d.openAgent();
  d.ws = ws;
}
await Promise.all(ds.map(d => d.run()));

// 3) M-B1 验收快照（/af/shadow 与 /af/economy 需账号 token）
await sleep(500);
const tok = drivers[0].token;
const rep = await (await fetch(BASE + `/af/shadow?days=${DAYS}&token=${encodeURIComponent(tok)}`, { headers: { Connection: 'close' } })).json();
const eco = await (await fetch(BASE + `/af/economy?token=${encodeURIComponent(tok)}`, { headers: { Connection: 'close' } })).json().catch(() => ({}));
const itemsOk = Array.isArray(rep.items) ? rep.items : [];
const withBoth = itemsOk.filter(i => i.liveVolume > 0 && i.shadowVolume > 0).length;
const report = {
  at: new Date().toISOString(),
  startedAt,
  base: BASE,
  drivers: ds.map(d => ({ uid: d.d.uid, orders: d.orders, fills: d.fills })),
  durationMs: DURATION,
  shadow: rep,
  economy: { feeMultiplier: eco.feeMultiplier, inflationIndex: eco.inflationIndex },
  mB1: {
    criterion: `14 真实日窗口（days=${DAYS} 复查口径）实盘 vs 影子：价差分布收敛（priceSpreadPct 中位 < 15%）且成交量偏差可解释（volumeDeviation < 0.5）；超阈值则调影子 spread/makerQty 后重启观察`,
    status: withBoth > 0
      ? (DAYS >= 14
        ? `M-B1 判门窗口：${withBoth}/${itemsOk.length} 件双边成交；逐件核对 priceSpreadPct/volumeDeviation 是否达标`
        : `引擎活体验证通过（${withBoth}/${itemsOk.length} 件实盘+影子双边成交）；14 日观察期起点 ${startedAt}，到期后重跑 --days 14 复查`)
      : '影子双边成交未出现——检查服务器是否挂了 shadow（app.shadow）或流量是否真实成交',
  },
};
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`[shadow-obs] 报告 -> ${OUT}`);
console.log(report.mB1.status);
