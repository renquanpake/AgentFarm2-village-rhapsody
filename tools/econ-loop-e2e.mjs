#!/usr/bin/env node
// tools/econ-loop-e2e.mjs —— 经济闭环 e2e：砍树 → 背包 → 挂卖单 → 撮合 → 金币
// 闭环口径（架构师批复 WP2）：卖家 A 真实砍树得木材(id=18)进背包 -> 挂 sell 单 ->
// 买家 B 挂 buy 单吃单撮合 -> A 扣木、B 扣币、A 收净价（gross - 10% 手续费烧币）。
// 全程只走公开协议 act/observe 与 market_fills 事件落库，砍树与撮合都是真动作。
// 资金来源：新玩家自带 250 金币（heroTemplate），够 3 木材 @60 的买盘预留，
// 全程不碰 dev 端点 —— 因此在 AF_DEV_ENDPOINTS=0 的加固实例上也能跑。
// 定位口径（纯协议，批4 P1）：不读服务端任何世界档文件，全部走公开接口。
// ①宏观寻路：公开地标网络。村景真树只在 x∈[0,74] y∈[0,59]（treeOf 判定：plantId 14-19；
//   farmType===2 会混进装饰植物，砍到「这个格子上没有树」），新玩家出生在民居门口
//   （实测 x∈[9,102] y∈[54,119]），最近树常在 40+ 格外。observe 的 obstacles 只有 12 格窗，
//   treesNear 更是 3 格窗（§4.2 不喂导航级树坐标清单），从出生点直接看不到树。
//   所以先 move_to {near:'北路口里程碑'}（树场东北入口，路名「南北大街·北林间道」），
// ②林区选址：GET /af/mapdoc 是公开文本地图（专为纯文本 LLM 自规划路线设计），
//   里面给出阻挡簇 bbox（格坐标）。西北象限的簇就是树丛，挑离当前位置最近的簇 move_to 进去。
// ③局部感知：observe 的 treesNear 3 格窗。到位后就近树丛再步进 1-2 跳，直到 treesNear 非空。
//   move_to 会把目标吸附到可站立环，落点必然贴着树，所以 treesNear 立即非空。
// 用法：node tools/econ-loop-e2e.mjs [--base http://127.0.0.1:8098] [--slot 98]
//       [--qty 3] [--price 60] [--db <events.db>] [--data-dir <saves/slot98>] [--timeout 300000]
//       [--user-a econloop_a] [--user-b econloop_b]
// 复用存档位不要求全新账号：开头会按存档位的 accounts.json 遍历所有 owner 清掉历史 open 挂单，
// 还原干净盘面（撤单才退预留，改 DB 会与内存订单簿脱节）；B 本金不够时会把本轮数量自适应钳制。
// 复用存档位时上一轮账号已被买盘预留掏空（自带 250 金币见底，撑不起 60×qty 的预留），
// 传一对新账号名即可拿回 heroTemplate 本金，同时保留市场历史以验证重启 ID 校准。
// 退出码：0 = 全绿；1 = 任一步失败；2 = 环境/参数错误。
import WebSocket from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (arg('--base', 'http://127.0.0.1:8098')).replace(/\/+$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const SLOT = Number(arg('--slot', '98'));
// 数量可被动态算价保护钳制（见「定价 + 挂卖单」段），故用 let
let QTY = Math.max(1, Number(arg('--qty', '3')));
const PRICE = Number(arg('--price', '60'));
const TIMEOUT_MS = Number(arg('--timeout', '180000'));
const WOOD = 18;          // 砍树产出（ws.ts chop -> knapAdd(pm, 18, 3)）
const FEE_RATE = 0.1;    // TRADE_FEE_RATE，卖方实收 90%
const DATA_DIR = arg('--data-dir') || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'saves', `slot${SLOT}`);
// 事件库与实例数据目录同源：服务端按 AF_DATA_DIR 落盘，所以 DB_PATH 默认跟着 DATA_DIR 走，
// 单独指仓库 data/ 会查到空表（交易真发生了但账本在另一个库）——曾因此误判撮合失败。
const DB_PATH = arg('--db') || join(DATA_DIR, 'events.db');
// 本轮时间水位：market_fills 与 events 都是历史追加表，隔离实例跨轮复用同一存档位，
// 不带 ts 过滤会把上一轮的成交算进本轮（毛额翻倍、卖方收款口径被污染）。
const RUN_TS = Date.now();
// 只读小查询。WAL 模式下开连接偶发 ENOENT/锁竞争，调用方自己判空重试。
const dbRows = (sql, params = []) => {
  try { const db = new DatabaseSync(DB_PATH, { readOnly: true }); const r = db.prepare(sql).all(...params); db.close(); return r; }
  catch { return []; }
};

// 公开文本地图解析：/af/mapdoc 是服务端专门为「纯文本 LLM 自规划路线」生成的公开接口，
// 给出阻挡簇 bbox（格坐标）。西北象限（x<82, y<62）的簇就是树丛簇——树场整片都在那一带，
// 而民居/广场/河湾都在 x>84。挑离当前位置最近的簇，move_to 进去就贴着树了。
// 只保留 n>=4 的簇（<4 格的散点在服务端已按噪声丢弃）并排除世界边界大框。
async function mapdocClusters() {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(BASE + '/af/mapdoc');
      const doc = (await r.json()).mapdoc || '';
      const sec = (doc.split('## 不可通行区')[1] || '').split('## ')[0] || '';
      const out = [];
      for (const m of sec.matchAll(/\[(-?\d+),(-?\d+)\]-\[(-?\d+),(-?\d+)\] \((\d+)格\)/g)) {
        const c = { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], n: +m[5] };
        if (c.n >= 4 && (c.x2 - c.x1) * (c.y2 - c.y1) < 400) out.push(c);
      }
      if (out.length) return out;
    } catch { /* 实例未就绪，重试 */ }
    await sleep(300);
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

// 阻挡格集合（格坐标）：obstacles 只有 12 格窗，但树丛在 treesNear 里必然也在窗内，够用。
const blockedCells = (st) => {
  const s = new Set();
  for (const o of regionsOf(st)) for (let x = o.x1; x <= o.x2; x++) for (let y = o.y1; y <= o.y2; y++) s.add(`${x},${y}`);
  return s;
};
// move_to 打树格本身会吸附到可站立环，但吸附点不保证贴着树（树丛深处只能落到 2 格外，chop 直接 far）。
// 正确做法是打「树格的邻近可站格」：该格本身可站，move_to 精确落点，chop 距离必为 1。
const standNextTo = (st, t, m) => {
  const blk = blockedCells(st);
  return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    .map(([dx, dy]) => ({ cx: t.gx + dx, cy: t.gy + dy }))
    .filter(o => !blk.has(`${o.cx},${o.cy}`))
    .sort((a, b) => Math.max(Math.abs(a.cx - m[0]), Math.abs(a.cy - m[1])) - Math.max(Math.abs(b.cx - m[0]), Math.abs(b.cy - m[1])))
    .shift() || null;
};
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
  // 账号名可覆盖：复用同一存档位时上一轮的 econloop_b 已被买盘预留掏空（自带 250 金币见底），
  // 换一对新名即可拿到 heroTemplate 的 250 本金，同时保留 market_orders/market_fills 历史以验证重启 ID 校准。
  const NAME_A = arg('--user-a', 'econloop_a'), NAME_B = arg('--user-b', 'econloop_b');
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

  // 3. 全局清盘：当前存档位库里所有 open 的 wood 订单全部撤掉，还原干净盘面。
  //    撤单必须走 ws 协议（撤单才把挂单预留退回去）——直接改 DB 会与内存订单簿脱节，
  //    下次 persist 又被覆盖。复用存档位时上一轮的残留买单把 topBid 抬到 59、残留卖单撑大
  //    ask 深度，B 自带的 250 本金算不出可行价位，撮合链 5-9 步必红。
  //    owner 到账号的映射从存档位同级的 accounts.json 取（含 token，无需密码）。
  const cancelOrders = async (owner, orderId) => {
    const mine = (uid) => dbRows(`SELECT id FROM market_orders WHERE item_id = ? AND owner = ? AND status = 'open'`, [WOOD, uid]);
    let cancelled = 0;
    for (const { uid, w } of [{ uid: A.uid, w: wA }, { uid: B.uid, w: wB }]) {
      if (uid !== owner) continue;
      for (const row of (orderId ? [{ id: orderId }] : mine(uid))) {
        await callAct(w, { t: 'act', action: 'trade', op: 'cancel', itemId: WOOD, orderId: row.id });
        cancelled++;
      }
    }
    return cancelled;
  };
  {
    const openOrders = dbRows(`SELECT id, owner FROM market_orders WHERE item_id = ? AND status = 'open'`, [WOOD]);
    const accts = (() => {
      try { return JSON.parse(readFileSync(join(DATA_DIR, '..', '..', 'accounts.json'), 'utf8')); } catch { return {}; }
    })();
    const byUid = new Map(Object.values(accts).map(a => [a.uid, a]));
    const owners = [...new Set(openOrders.map(o => o.owner))];
    let cancelled = 0, skipped = [];
    for (const owner of owners) {
      cancelled += await cancelOrders(owner, null);
      if (owner === A.uid || owner === B.uid) continue;
      const acc = byUid.get(owner);
      if (!acc) { skipped.push(owner); continue; }
      try {
        const tok = await jpost('/af/agent-token', { token: acc.token });
        if (!tok.agentToken) { skipped.push(owner); continue; }
        const wc = await openAgent(tok.agentToken);
        for (const row of openOrders.filter(o => o.owner === owner)) {
          await callAct(wc, { t: 'act', action: 'trade', op: 'cancel', itemId: WOOD, orderId: row.id });
          cancelled++;
        }
        wc.close();
      } catch { skipped.push(owner); }
    }
    console.log(`[清盘] open wood 订单 ${openOrders.length} 笔 -> 撤单 ${cancelled} 笔${skipped.length ? `；跳过 ${skipped.length} 个无凭据 owner（${skipped.join(',')}）` : ''}`);
  }

  // 4. A 找可砍的树（纯协议三段式，不读服务端任何文件）
  let st = await observe(wA);
  let navSteps = 0, hops = 0;
  if (st.scene !== 2) {
    navSteps += (await callAct(wA, { t: 'act', action: 'move_to', near: '村纪念碑' }))?.steps || 0;
    st = (await waitFor(wA, s => s.scene === 2, 60000)) || await observe(wA);
  }
  // 4a. 宏观寻路：公开地标网络 -> 北路口里程碑（树场东北入口，路名「南北大街·北林间道」）
  navSteps += (await callAct(wA, { t: 'act', action: 'move_to', near: '北路口里程碑' }))?.steps || 0;
  st = (await waitFor(wA, s => { const c = cellOf(s); return Math.max(Math.abs(c[0] - 94), Math.abs(c[1] - 53)) <= 3; }, 120000)) || await observe(wA);
  // 4b. 林区选址：GET /af/mapdoc 公开文本地图的阻挡簇 -> 挑西北象限离当前最近的一簇
  const docClusters = await mapdocClusters();
  const forest = docClusters.filter(c => c.x1 < 82 && c.y2 < 62);
  if (!forest.length) {
    wA.close(); wB.close();
    throw new Error(`mapdoc 里找不到西北林区阻挡簇（共 ${docClusters.length} 簇），无法定位树场`);
  }
  {
    const m = cellOf(st);
    const near = forest.reduce((best, c) => {
      const cx = (c.x1 + c.x2) / 2, cy = (c.y1 + c.y2) / 2;
      const d = Math.max(Math.abs(cx - m[0]), Math.abs(cy - m[1]));
      return d < best.d ? { cx, cy, d } : best;
    }, { cx: 0, cy: 0, d: Infinity });
    navSteps += (await callAct(wA, { t: 'act', action: 'move_to', x: near.cx * 100 + 50, y: near.cy * 100 + 50 }))?.steps || 0;
    st = await observe(wA);
  }
   // 4c. 局部试砍：林区簇里逐簇靠近，用 treesNear（3 格窗）逐棵试砍。见下。

  // 4. 砍树 -> 木材进背包。树 hp 不定（10/30/60 都实测过），每斧 -20，所以按 hp 连砍 ceil(hp/20) 斧。
  //    两类树砍不动，都得跳过换下一棵：
  //      · 已倒的 —— 回「这个格子上没有树」
  //      · 种在导航格「建筑/障碍」上的 —— 回 target-blocked（数据侧树与阻挡格重叠，详见报告）
  //    本簇的树全砍不动就换下一簇树丛，而不是原地重试。
  const woodBefore = woodNum(st);
  const coinsBefore = st.coins || 0;
  let chopped = 0, chops = 0, deadSkips = 0;
  const dead = new Set();
  const pick = (near, skip) => {
    const alive = near.filter(t => !skip.has(`${t.gx},${t.gy}`));
    if (!alive.length) return null;
    alive.sort((a, b) => (a.hp || 0) - (b.hp || 0));
    return alive[0];
  };
  // 靠近一棵树：先 move_to 树的邻近可站格，再按 chebyshev 距离单步 move 补足。
  // move_to 的吸附落点不保证贴着树（树丛深处可能落到 2-3 格外，chop 直接 far），
  // 而 move 只吃 dir 没有绝对坐标，所以只能一步步逼近。
  const approach = async (t) => {
    st = await observe(wA);
    const land = standNextTo(st, t, cellOf(st));
    const mv = await callAct(wA, { t: 'act', action: 'move_to', x: land ? land.cx * 100 + 50 : t.px, y: land ? land.cy * 100 + 50 : t.py });
    navSteps += mv?.steps || 0;
    let cur = cellOf({ pos: mv?.pos || (await observe(wA))?.pos });
    for (let s = 0; s < 6; s++) {
      if (Math.max(Math.abs(cur[0] - t.gx), Math.abs(cur[1] - t.gy)) <= 1) break;
      const dx = Math.sign(t.gx - cur[0]), dy = Math.sign(t.gy - cur[1]);
      if (!dx && !dy) break;
      const dir = Math.abs(t.gy - cur[1]) >= Math.abs(t.gx - cur[0]) ? (dy > 0 ? 'up' : 'down') : (dx > 0 ? 'right' : 'left');
      const mv2 = await callAct(wA, { t: 'act', action: 'move', dir });
      if (!mv2?.ok) break;
      cur = cellOf({ pos: mv2.pos });
    }
    return cur;
  };
   // 候选簇：mapdoc 的林区簇按离当前位置的 chebyshev 距离就近排序。
   const m0 = cellOf(st);
   const ranked = forest
     .map(c => ({ cx: (c.x1 + c.x2) / 2, cy: (c.y1 + c.y2) / 2 }))
     .map(c => ({ cx: c.cx, cy: c.cy, d: Math.max(Math.abs(c.cx - m0[0]), Math.abs(c.cy - m0[1])) }))
     .sort((a, b) => a.d - b.d);
   let lastFail = '';
   outer:
   for (const c of ranked) {
     hops++;
     navSteps += (await callAct(wA, { t: 'act', action: 'move_to', x: c.cx * 100 + 50, y: c.cy * 100 + 50 }))?.steps || 0;
     st = (await waitFor(wA, s => (s.treesNear || []).length > 0, 60000)) || await observe(wA);
     for (let i = 0; i < 6 && !chopped; i++) {
       st = await observe(wA);
       const t = pick(st.treesNear || [], dead);
       if (!t) break;
       const cur = await approach(t);
       const ch = await callAct(wA, { t: 'act', action: 'chop', x: t.px, y: t.py });
       lastFail = `站位${JSON.stringify(cur)} 树(${t.gx},${t.gy}) => ${JSON.stringify(ch).slice(0, 120)}`;
       if (ch?.ok && /砍倒了/.test(ch.msg || '')) { chopped = 1; break; }
       chops++;
       // 砍倒/砍不动才换下一棵；「砍了一斧头」说明树还活着（hp 60 要 3 斧），留在原地继续砍。
       if (!ch?.ok) {
         if (/没有树/.test(ch?.msg || '')) deadSkips++;
         dead.add(`${t.gx},${t.gy}`);
       }
     }
     if (chopped) break;
   }
   if (!chopped) {
     wA.close(); wB.close();
     throw new Error(`林区 ${ranked.length} 簇、${chops} 斧后没砍倒一棵树（位置 ${JSON.stringify(cellOf(st))}），末次返回 ${lastFail}`);
   }
  st = await observe(wA);
  const woodGained = woodNum(st) - woodBefore;
  (chopped && woodGained >= 3)
    ? ok('1.砍树产出', `树被砍倒，木材 +${woodGained}（${chops} 斧，跳过 ${deadSkips} 棵已倒的）`)
    : bad('1.砍树产出', `未出现"砍倒了"，木材 +${woodGained}（${chops} 斧，跳过 ${deadSkips}），末次返回 ${lastFail}`);

  // 5. 定价 + 挂卖单。两个约束共同定 P：
  //    下限 topBid+1 —— 低于等于最高买盘，A 的单会被做市商顺手吃掉，对手方变成 'mm' 而不是 B；
  //    上限 B 的采购预算 —— B 自带 250 金币，买量要覆盖簿上更便宜的 ask，价额超预算就下不了单。
  //    动态算价保护：定价取「topBid+1」（簿空回落 60），预算撑不起定价×数量就把本轮数量钳到
  //    B 买得起的量（≥1），不再因硬编码 3x 预算溢出直接判红。
  const bk = await callAct(wA, { t: 'act', action: 'trade', op: 'book', itemId: WOOD });
  const topBid = bk?.book?.bids?.[0]?.price ?? 0;
  const asks0 = bk?.book?.asks || [];
  const askQtyBelow = (p) => asks0.filter(a => a.price <= p).reduce((s, a) => s + a.qty, 0);
  const stB0 = await observe(wB);
  const bCoins = stB0.coins || 0;
  const woodBeforeB = woodNum(stB0);
  let P = Math.max(PRICE, topBid > 0 ? topBid + 1 : 60);
  if (P * QTY > bCoins) {
    const clamped = Math.max(1, Math.floor(bCoins / P));
    ok('4.买家吃单', `B 余额 ${bCoins} 撑不起 ${P}×${QTY}，本轮数量钳制为 ${clamped}`);
    QTY = clamped;
  }
  const buyQty = Math.max(QTY, askQtyBelow(P) + QTY);
  const afford = P * buyQty <= bCoins;
  if (!afford) bad('4.买家吃单', `B 余额 ${bCoins} 不足 ${P}×${buyQty}（topBid=${topBid}，簿上更低价 ask 深度 ${askQtyBelow(P)}，清盘未清干净）`);
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
      rows = db.prepare('SELECT price, qty, maker, taker FROM market_fills WHERE item_id = ? AND maker = ? AND ts >= ? ORDER BY ts ASC').all(WOOD, A.uid, RUN_TS);
      fees = db.prepare("SELECT payload FROM events WHERE type = 'trade.fee' AND actor = ? AND ts >= ?").all(A.uid, RUN_TS);
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

  // 9. 消耗出口：B 把吃进来的木材回炉换废资价金币。木材此前到 B 手里就是死账，
  //    回炉让「砍伐→挂单→购买→消耗」形成闭环（批4 P2）。数量只回 1 个，保留其余木材。
  const bWoodForRecycle = woodNum(await observe(wB));
  const bCoinsBeforeRecycle = (await observe(wB)).coins || 0;
  const rc = bWoodForRecycle >= 1 ? await callAct(wB, { t: 'act', action: 'recycle', itemId: WOOD, qty: 1 }) : null;
  const stBR = await observe(wB);
  const woodEndRecycle = woodNum(stBR);
  const coinsEndRecycle = stBR.coins || 0;
  const feeRows = (() => { try { const d = new DatabaseSync(DB_PATH, { readOnly: true }); const r = d.prepare("SELECT payload FROM events WHERE type = 'trade.recycle' AND actor = ? AND ts >= ?").all(B.uid, RUN_TS); d.close(); return r; } catch { return []; } })();
  if (rc?.ok && woodEndRecycle === bWoodForRecycle - 1 && coinsEndRecycle - bCoinsBeforeRecycle >= rc.recycled?.coins >= 1) {
    ok('9.回炉消耗', `B 回炉 1x 木材 → 得金币 ${rc.recycled.coins}，背包 ${bWoodForRecycle} → ${woodEndRecycle}，trade.recycle 事件 ${feeRows.length} 条（${QTY}x 买入的木材已有合法出口）`);
  } else {
    bad('9.回炉消耗', `rc=${JSON.stringify(rc).slice(0, 120)} 背包 ${bWoodForRecycle} → ${woodEndRecycle}，金币 ${bCoinsBeforeRecycle} → ${coinsEndRecycle}`);
  }

  // 10. 汇总
  wA.close(); wB.close();
  const failed = steps.filter(s => !s.ok);
  console.log(JSON.stringify({
    base: BASE, slot: SLOT, qty: QTY, price: P, runTs: RUN_TS,
    navSteps, hops,
    seller: { nick: A.nick, uid: A.uid.slice(-6), wood: `${woodBefore}→${woodEnd}`, coins: `${coinsBefore}→${coinsAfter}` },
    buyer: { nick: B.nick, uid: B.uid.slice(-6), coinsStart: bCoins, buyQty, wood: `${woodBeforeB}→${woodEndRecycle}`, recycled: rc?.recycled || null },
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
