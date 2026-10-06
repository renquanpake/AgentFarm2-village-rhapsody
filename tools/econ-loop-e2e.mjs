#!/usr/bin/env node
// tools/econ-loop-e2e.mjs —— 经济闭环 e2e：砍树 → 背包 → 挂卖单 → 撮合 → 金币
// 闭环口径（架构师批复 WP2）：卖家 A 真实砍树得木材(id=18)进背包 -> 挂 sell 单 ->
// 买家 B 挂 buy 单吃单撮合 -> A 扣木、B 扣币、A 收净价（gross - 10% 手续费烧币）。
// 全程只走公开协议 act/observe 与 market_fills 事件落库，砍树与撮合都是真动作。
// 资金来源：新玩家自带 250 金币（heroTemplate），够 3 木材 @60 的买盘预留，
// 全程不碰 dev 端点 —— 因此在 AF_DEV_ENDPOINTS=0 的加固实例上也能跑。
// 定位提示（仅测试脚手架，不进协议）：村景真树是 plantId 14-19（treeOf 判定，farmType===2 里
// 混着装饰植物会砍到"这个格子上没有树"），共 171 株，只分布在 x∈[0,74] y∈[0,59]；
// 而新玩家出生在民居门口（实测 x∈[9,102] y∈[54,119]），最近树常在 45 格之外。
// observe 的 obstacles 半径只有 12 格，够不着；所以按 --data-dir 读世界档直接取
// 离 A 最近的真树格作为 move_to 目标（move_to 会吸附可站立环，落点必然贴着树）。
// 用法：node tools/econ-loop-e2e.mjs [--base http://127.0.0.1:8098] [--slot 98]
//       [--qty 3] [--price 60] [--db <events.db>] [--data-dir <saves/slot98>]
//       [--timeout 300000]
// 退出码：0 = 全绿；1 = 任一步失败；2 = 环境/参数错误。
import WebSocket from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (arg('--base', 'http://127.0.0.1:8098')).replace(/\/+$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const SLOT = Number(arg('--slot', '98'));
const QTY = Math.max(1, Number(arg('--qty', '3')));
const PRICE = Number(arg('--price', '60'));
const TIMEOUT_MS = Number(arg('--timeout', '180000'));
const WOOD = 18;          // 砍树产出（ws.ts chop -> knapAdd(pm, 18, 3)）
const FEE_RATE = 0.1;    // TRADE_FEE_RATE，卖方实收 90%
const DATA_DIR = arg('--data-dir') || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'saves', `slot${SLOT}`);
// 事件库与实例数据目录同源：服务端按 AF_DATA_DIR 落盘，所以 DB_PATH 默认跟着 DATA_DIR 走，
// 单独指仓库 data/ 会查到空表（交易真发生了但账本在另一个库）——曾因此误判撮合失败。
const DB_PATH = arg('--db') || join(DATA_DIR, 'events.db');
// 只读小查询。WAL 模式下开连接偶发 ENOENT/锁竞争，调用方自己判空重试。
const dbRows = (sql, params = []) => {
  try { const db = new DatabaseSync(DB_PATH, { readOnly: true }); const r = db.prepare(sql).all(...params); db.close(); return r; }
  catch { return []; }
};

// 读世界档取村景真树位（测试脚手架，见文件头说明）。桶结构：datas[] = {key:'plantData', val:{datas:[{sceneType, plants[]}]}}。
// 树判定跟 treeOf 对齐：plantId 14-19。按 farmType===2 筛会混进装饰植物，chop 回「这个格子上没有树」。
// 服务端持续 persist 这个文件，读失败重试几次，全失败返回空数组（退回 obstacles 逼近）。
function loadTrees() {
  const p = join(DATA_DIR, 'world.json');
  if (!existsSync(p)) return [];
  for (let i = 0; i < 4; i++) {
    try {
      const w = JSON.parse(readFileSync(p, 'utf8'));
      const pd = (w.datas || []).find(d => d.key === 'plantData')?.val?.datas || [];
      const s2 = pd.find(s => s.sceneType === 2);
      const trees = (s2?.plants || []).filter(x => x.plantId >= 14 && x.plantId <= 19).map(x => ({ gx: x.x, gy: x.y }));
      if (trees.length) return trees;
    } catch { /* 文件正在写入，重试 */ }
  }
  return [];
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const steps = [];
const ok = (name, detail) => steps.push({ step: name, ok: true, detail });
const bad = (name, detail) => steps.push({ step: name, ok: false, detail });

const jpost = async (p, b) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};

// ---------- WebSocket 客户端 ----------
const waitMsg = (ws, pred, ms = 10000) => new Promise((res) => {
  const on = (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (pred(m)) { ws.off('message', on); res(m); }
  };
  ws.on('message', on);
  setTimeout(() => { ws.off('message', on); res(null); }, ms);
});
const seqOf = () => Math.random().toString(36).slice(2, 10);
const callAct = (ws, o, ms = 10000) => {
  const seq = seqOf();
  const p = waitMsg(ws, m => m.t === 'result' && m.action === o.action && m.seq === seq, ms);
  ws.send(JSON.stringify({ ...o, seq }));
  return p;
};
const observe = (ws, ms = 10000) => {
  const p = waitMsg(ws, m => m.t === 'state', ms);
  ws.send(JSON.stringify({ t: 'observe' }));
  return p;
};
// observe 轮询直到断言成立（位置同步/导航到位都要等，不能立刻判定）
const waitFor = async (ws, pred, ms = 30000, intervalMs = 400) => {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    last = await observe(ws);
    if (last && pred(last)) return last;
    await sleep(intervalMs);
  }
  return last;
};
const cellOf = (st) => [Math.floor((st?.pos?.x ?? 0) / 100), Math.floor((st?.pos?.y ?? 0) / 100)];
// observe 的 obstacles 是 { regions: [...], note } 包一层，取 regions
const regionsOf = (st) => st?.obstacles?.regions || [];
const clustersOf = (st) => regionsOf(st).filter(o => o.name === '树丛');
const woodNum = (st) => (st?.backpack || []).find(p => p.id === WOOD)?.num || 0;
const openAgent = (token) => new Promise((res, rej) => {
  const ws = new WebSocket(WS_BASE + '/agent?token=' + encodeURIComponent(token));
  ws.on('open', () => res(ws));
  ws.on('error', rej);
  setTimeout(() => rej(new Error('agent ws 连接超时')), 10000);
});

// ---------- 主流程 ----------
try {
  // 1. 建号（自洽）。账号名固定，跨轮次幂等：先 login，登不上再 register。
  //    固定的目的是——上一轮失败残留的挂单能在开头按 owner 精确撤掉，
  //    否则残留买单会把 topBid 抬到 59，A 的单被 MM 吃掉、B 的余额又撑不起 60×N，测试必红。
  const NAME_A = 'econloop_a', NAME_B = 'econloop_b';
  const ensureAccount = async (name) => {
    let r = await jpost('/af/login', { username: name, password: 'econloop' });
    if (!r.token) r = await jpost('/af/register', { username: name, password: 'econloop' });
    if (!r.token) throw new Error(`建号 ${name} 失败: ${JSON.stringify(r).slice(0, 160)}`);
    const a = await jpost('/af/agent-token', { token: r.token });
    if (!a.agentToken) throw new Error(`agent-token ${name} 失败: ${JSON.stringify(a).slice(0, 160)}`);
    return { uid: r.uid, nick: r.nick, token: r.token, agentToken: a.agentToken };
  };
  const A = await ensureAccount(NAME_A);
  const B = await ensureAccount(NAME_B);

  // 2. 买家资金 + 触发 ensurePlayerData（新 slot 无玩家数据）
  const wA = await openAgent(A.agentToken);
  const wB = await openAgent(B.agentToken);
  await Promise.all([observe(wA), observe(wB)]);

  // 3. 清掉自己上一轮残留的挂单（撤单会把背包预留退回来）
  {
    const mine = (uid) => dbRows(`SELECT id FROM market_orders WHERE item_id = ? AND owner = ? AND status = 'open'`, [WOOD, uid]);
    for (const { uid, w } of [{ uid: A.uid, w: wA }, { uid: B.uid, w: wB }]) {
      for (const row of mine(uid)) {
        await callAct(w, { t: 'act', action: 'trade', op: 'cancel', itemId: WOOD, orderId: row.id });
      }
    }
  }

  // 4. A 找可砍的树。村景树只在 x∈[0,76] y∈[0,60]，新玩家出生在民居门口（可能在 40+ 格外），
  //    obstacles 半径 12 格够不着，所以优先用世界档提示取最近树；否则退回 obstacles 逼近。
  let st = await observe(wA);
  if (st.scene !== 2) {
    await callAct(wA, { t: 'act', action: 'move_to', near: '村纪念碑' });
    st = (await waitFor(wA, s => s.scene === 2, 60000)) || await observe(wA);
  }
  const me = cellOf(st);
  const clusters = clustersOf(st);
  let tree = null, hint = '';
  if (clusters.length) {
    const c = clusters.reduce((m, o) => {
      const cx = Math.floor((o.x1 + o.x2) / 2), cy = Math.floor((o.y1 + o.y2) / 2);
      return Math.max(Math.abs(cx - me[0]), Math.abs(cy - me[1])) < m.d ? { d: Math.max(Math.abs(cx - me[0]), Math.abs(cy - me[1])), gx: cx, gy: cy } : m;
    }, { d: Infinity, gx: Math.floor((clusters[0].x1 + clusters[0].x2) / 2), gy: Math.floor((clusters[0].y1 + clusters[0].y2) / 2) });
    tree = { gx: c.gx, gy: c.gy };
    hint = `obstacles 树丛(${c.d}格)`;
  } else {
    const trees = loadTrees();
    if (trees.length) {
      tree = trees.reduce((m, t) => {
        const d = Math.max(Math.abs(t.gx - me[0]), Math.abs(t.gy - me[1]));
        return d < m.d ? { ...t, d } : m;
      }, { gx: trees[0].gx, gy: trees[0].gy, d: Infinity });
      hint = `世界档提示(${tree.d}格)`;
    }
  }
  if (!tree) {
    wA.close(); wB.close();
    throw new Error(`A 找不到可砍的树（位置 ${JSON.stringify(me)}，12 格内树丛 0 个，世界档 ${loadTrees().length} 棵树，--data-dir=${DATA_DIR}）`);
  }
  // move_to 目标吸附可站立环：对准树格本身，到位后落在相邻可站格，treesNear 随即非空
  await callAct(wA, { t: 'act', action: 'move_to', x: tree.gx * 100 + 50, y: tree.gy * 100 + 50 });
  st = await waitFor(wA, s => (s.treesNear || []).length > 0, TIMEOUT_MS);
  if (!(st.treesNear || []).length) {
    wA.close(); wB.close();
    throw new Error(`走到树(${tree.gx},${tree.gy}) ${hint} 后 treesNear 仍为空（位置 ${JSON.stringify(cellOf(st))}）`);
  }

  // 4. 砍树 -> 木材进背包。树 hp 不定（10/30/60 都实测过），每斧 -20，所以要按 hp 连砍 ceil(hp/20) 斧。
  //    砍到「这个格子上没有树」说明目标已倒，从 treesNear 里换一棵（优先挑 hp 低的省斧数）。
  const woodBefore = woodNum(st);
  const coinsBefore = st.coins || 0;
  let chopped = 0, chops = 0, deadSkips = 0;
  const pick = (near, skip) => {
    const alive = near.filter(t => !skip.has(`${t.gx},${t.gy}`));
    if (!alive.length) return null;
    alive.sort((a, b) => (a.hp || 0) - (b.hp || 0));
    return alive[0];
  };
  const dead = new Set();
  for (let i = 0; i < 14 && !chopped; i++) {
    st = await observe(wA);
    const t = pick(st.treesNear || [], dead);
    if (!t) break;
    await callAct(wA, { t: 'act', action: 'move_to', x: t.px, y: t.py });
    await waitFor(wA, s => { const c = cellOf(s); return Math.abs(c[0] - t.gx) <= 1 && Math.abs(c[1] - t.gy) <= 1; }, 30000);
    const ch = await callAct(wA, { t: 'act', action: 'chop', x: t.px, y: t.py });
    if (ch?.ok && /砍倒了/.test(ch.msg || '')) { chopped = 1; break; }
    chops++;
    if (/没有树/.test(ch?.msg || '')) { dead.add(`${t.gx},${t.gy}`); deadSkips++; continue; }
  }
  st = await observe(wA);
  const woodGained = woodNum(st) - woodBefore;
  (chopped && woodGained >= 3)
    ? ok('1.砍树产出', `树被砍倒，木材 +${woodGained}（${chops} 斧，跳过 ${deadSkips} 棵已倒的）`)
    : bad('1.砍树产出', `未出现"砍倒了"，木材 +${woodGained}（${chops} 斧，跳过 ${deadSkips}）`);

  // 5. 定价 + 挂卖单。两个约束共同定 P：
  //    下限 topBid+1 —— 低于等于最高买盘，A 的单会被做市商顺手吃掉，对手方变成 'mm' 而不是 B；
  //    上限 B 的采购预算 —— B 自带 250 金币，买量要覆盖簿上更便宜的 ask，价额超预算就下不了单。
  //    所以下单前就把 B 的预算问出来，逐档降价找同时满足两边的 P。
  const bk = await callAct(wA, { t: 'act', action: 'trade', op: 'book', itemId: WOOD });
  const topBid = bk?.book?.bids?.[0]?.price ?? 0;
  const asks0 = bk?.book?.asks || [];
  const askQtyBelow = (p) => asks0.filter(a => a.price <= p).reduce((s, a) => s + a.qty, 0);
  const stB0 = await observe(wB);
  const bCoins = stB0.coins || 0;
  const woodBeforeB = woodNum(stB0);
  const buyQtyAt = (p) => Math.max(QTY, askQtyBelow(p) + QTY);
  let P = Math.max(PRICE, topBid + 1);
  let buyQty = buyQtyAt(P);
  let afford = P * buyQty <= bCoins;
  while (!afford && P > topBid + 1) { P--; buyQty = buyQtyAt(P); afford = P * buyQty <= bCoins; }
  if (!afford) bad('4.买家吃单', `B 自带金币 ${bCoins} 撑不起任何可行价位（topBid=${topBid}，最低需 ${topBid + 1}*${buyQty}）`);
  const sell = await callAct(wA, { t: 'act', action: 'trade', op: 'place', itemId: WOOD, side: 'sell', price: P, qty: QTY });
  sell?.ok
    ? ok('2.挂卖单', `@${P} x${QTY} resting=${sell.resting} 立即成交=${sell.fills} 笔`)
    : bad('2.挂卖单', JSON.stringify(sell).slice(0, 160));
  const woodAfterReserve = woodNum(await observe(wA));
  woodAfterReserve <= woodNum(st) - QTY
    ? ok('3.背包预留', `背包木材 ${woodNum(st)} → ${woodAfterReserve}（挂单预留 ${QTY}）`)
    : bad('3.背包预留', `挂单后背包木材 ${woodNum(st)} → ${woodAfterReserve}，未见预留扣减`);

  // 6. B 吃单撮合。订单簿按价优先：先吃簿上更便宜的 ask，再轮到 A 的单，所以买量按 askQtyBelow 加量。
  //    收款基线在下单前取：挂单本身已触发"集市学徒-挂单"任务奖励铸币，成交再触发"成交"奖励，
  //    余额增量会被任务铸币污染，所以精确等式只对事件落库的交易口径成立（见第 7 步）。
  const coinsBeforeTrade = (await observe(wA)).coins || 0;
  if (afford) {
    const buy = await callAct(wB, { t: 'act', action: 'trade', op: 'place', itemId: WOOD, side: 'buy', price: P, qty: buyQty });
    buy?.ok
      ? ok('4.买家吃单', `@${P} x${buyQty} 成交 ${buy.fills} 笔 余挂 ${buy.resting}`)
      : bad('4.买家吃单', JSON.stringify(buy).slice(0, 200));
  }

  // 7. 结算核验：交易口径以事件落库为准（market_fills 记对手方，trade.fee 记烧币金额）。
  const stA = await observe(wA);
  const stB = await observe(wB);
  const woodEnd = woodNum(stA);
  const woodEndB = woodNum(stB);
  const coinsAfter = stA.coins || 0;
  let db = null, rows = [], fees = [], retries = 0;
  while (retries < 6) {
    try { db = new DatabaseSync(DB_PATH, { readOnly: true });
      rows = db.prepare('SELECT price, qty, maker, taker FROM market_fills WHERE item_id = ? AND maker = ? ORDER BY ts ASC').all(WOOD, A.uid);
      fees = db.prepare("SELECT payload FROM events WHERE type = 'trade.fee' AND actor = ?").all(A.uid);
      if (rows.length) break;
    } catch { /* WAL 未就绪，重试 */ }
    await sleep(500); retries++;
  }
  const fills = db ? rows : [];
  db?.close?.();
  const gotQty = fills.reduce((s, f) => s + Number(f.qty), 0);
  let gross = 0;
  for (const f of fills) gross += Number(f.price) * Number(f.qty);
  const feeBurned = fees.reduce((s, e) => s + (JSON.parse(e.payload || '{}').fee || 0), 0);
  const net = gross - feeBurned;
  const p2p = fills.some(f => String(f.taker) === String(B.uid));
  fills.length && gotQty === QTY
    ? ok('5.撮合过户', `${fills.length} 笔共 ${gotQty}x 单价[${fills.map(f => f.price).join(',')}] ${p2p ? 'P2P(A→B)' : '对手方非 B'}`)
    : bad('5.撮合过户', `market_fills 查到 ${fills.length} 笔 / 应 ${QTY}x`);
  (gross > 0 && feeBurned === Math.round(gross * FEE_RATE))
    ? ok('6.手续费烧币', `毛额 ${gross} − trade.fee ${feeBurned} = 净 ${net}（卖方实收 90%，10% 出清不入任何账）`)
    : bad('6.手续费烧币', `毛额 ${gross}，trade.fee 事件 ${feeBurned}，期望 ${gross ? Math.round(gross * FEE_RATE) : 0}`);
  (coinsAfter - coinsBeforeTrade >= net)
    ? ok('7.卖方收款', `A ${coinsBeforeTrade} → ${coinsAfter}（≥ 净 ${net}；差额 ${coinsAfter - coinsBeforeTrade - net} 来自任务链铸币）`)
    : bad('7.卖方收款', `A ${coinsBeforeTrade} → ${coinsAfter}，期望 ≥ +${net}`);
  (woodEnd === woodNum(st) - QTY && woodEndB - woodBeforeB >= QTY)
    ? ok('8.买方收货', `A 砍后 ${woodNum(st)} → ${woodEnd}（-${QTY}）；B ${woodBeforeB} → ${woodEndB}（+${woodEndB - woodBeforeB}）`)
    : bad('8.买方收货', `A ${woodNum(st)} → ${woodEnd}；B ${woodBeforeB} → ${woodEndB}，期望 A -${QTY} / B +${QTY}`);

  // 9. 汇总
  wA.close(); wB.close();
  const failed = steps.filter(s => !s.ok);
  console.log(JSON.stringify({
    base: BASE, slot: SLOT, qty: QTY, price: P,
    seller: { nick: A.nick, uid: A.uid.slice(-6), wood: `${woodBefore}→${woodEnd}`, coins: `${coinsBefore}→${coinsAfter}` },
    buyer: { nick: B.nick, uid: B.uid.slice(-6), coinsStart: bCoins, buyQty, wood: `${woodBeforeB}→${woodEndB}` },
    fills: fills.map(f => `${f.price}x${f.qty}→${String(f.taker).slice(-6)}`),
    gross, fee: feeBurned, net,
    steps, pass: steps.length - failed.length, total: steps.length,
  }, null, 1));
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  console.error('[econ-loop] 环境/流程错误：' + (e.message || e));
  console.log(JSON.stringify({ steps }, null, 1));
  process.exit(2);
}
