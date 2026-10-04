// tools/agent-act-e2e.mjs —— agent 目标格动作预检与 move_to 失败文案 E2E（批1c Task2/3 断言）
// 起隔离实例：PORT=8087 AF_SLOT=91 AF_NO_TUNNEL=1 node src/index.ts（server/ 目录）
// 用法：AF_BASE=http://127.0.0.1:8087 node tools/agent-act-e2e.mjs
// 坐标契约（两套，勿混）：
//   move_to 用原始像素 x/y（floor(x/100)=格）；plant/water 等目标格动作经 normXY，
//   <133/<117 的值按「格坐标」×100+50 解释 —— 本文件统一用 cell*100+50（cell≥2 时两套等价）。
import WebSocket from 'ws';
import http from 'node:http';

const BASE = process.env.AF_BASE || 'http://127.0.0.1:8087';
const WS_BASE = BASE.replace(/^http/, 'ws');
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${extra ? ' | ' + extra : ''}`); };
const P = (gx, gy) => ({ x: gx * 100 + 50, y: gy * 100 + 50 });

function post(path, body, token) {
  return new Promise((res, rej) => {
    const d = JSON.stringify(body || {});
    const r = http.request(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, s => {
      let x = ''; s.on('data', c => x += c); s.on('end', () => { try { res(JSON.parse(x || '{}')); } catch { res({}); } });
    });
    r.on('error', rej); r.write(d); r.end();
  });
}

// 账号 + agent token
const uname = `act-e2e_${Date.now() % 1e6}`;
const reg = await post('/af/register', { username: uname, password: 'pass1234' });
check('注册账号', reg.ok && reg.uid, reg.uid || JSON.stringify(reg));
const { uid, token } = reg;
const atk = await post('/af/agent-token', { token });
check('获取 agentToken', !!atk.agentToken);

// 游戏通道：join 直接入村景 2（agent 通道连接时以 online 记录为初始 apos，见 ws.ts agentConn）
const G = new WebSocket(WS_BASE + '/ws');
G.on('open', () => G.send(JSON.stringify({ t: 'join', uid, nick: '动作验证', token, scene: 2, x: 3500, y: 3000 })));
await new Promise(r => G.once('message', r));
// 确认环：按段回报 arrive（index=seg），让 move_to 快速走完
G.on('message', d => {
  let m; try { m = JSON.parse(d.toString()); } catch { return; }
  if (m.t === 'agent_move' && Number.isInteger(m.seg)) {
    G.send(JSON.stringify({ t: 'agent_arrive', index: m.seg, x: m.x, y: m.y, scene: m.scene }));
  }
});

// agent 通道（URL token 鉴权，无需 join 消息）
const A = new WebSocket(WS_BASE + '/agent?token=' + encodeURIComponent(atk.agentToken));
let seq = 0;
const resp = (action, payload, ms = 20000) => new Promise((resolve) => {
  seq++;
  const mySeq = seq;
  const onMsg = (d) => {
    const m = JSON.parse(d.toString());
    if ((m.t === 'result' || m.t === 'move_started') && m.action === action && m.seq === mySeq) {
      A.off('message', onMsg);
      resolve(m);
    }
  };
  A.on('message', onMsg);
  A.send(JSON.stringify({ t: 'act', action, seq: mySeq, ...payload }));
  setTimeout(() => { A.off('message', onMsg); resolve(null); }, ms);
});
const waitDone = (ms = 15000) => new Promise((resolve) => {
  const onMsg = (d) => { const m = JSON.parse(d.toString()); if (m.t === 'agent_move_done') { G.off('message', onMsg); resolve(m); } };
  G.on('message', onMsg);
  setTimeout(() => { G.off('message', onMsg); resolve(null); }, ms);
});

await new Promise(r => setTimeout(r, 1500));

// 初始位置（agent 连接时吸附到最近可达格）；agent 通道 observe 是直接消息类型
A.send(JSON.stringify({ t: 'observe' }));
const st0 = await new Promise((resolve) => {
  const onMsg = (d) => { const m = JSON.parse(d.toString()); if (m.t === 'state') { A.off('message', onMsg); resolve(m); } };
  A.on('message', onMsg);
  setTimeout(() => { A.off('message', onMsg); resolve(null); }, 8000);
});
const cell = st0?.pos ? [Math.floor(st0.pos.x / 100), Math.floor(st0.pos.y / 100)] : [35, 30];
check('observe 返回村景位置', !!st0 && Number.isFinite(st0.pos?.x), `(${cell[0]},${cell[1]}) scene=${st0?.scene}`);

// mapgrid 找一个「阻挡格 B + 可站邻格 N」（B 不贴边，保证 cell*100+50 坐标两套语义等价）
const mapgrid = await fetch(`${BASE}/af/mapgrid?token=${encodeURIComponent(token)}`).then(r => r.json());
const W = mapgrid.W, H = mapgrid.H;
const isBlocked = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mapgrid.blocked[y * W + x] === 1;
let B = null, N = null;
outer: for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  if (!isBlocked(x, y)) continue;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!isBlocked(x + dx, y + dy)) { B = [x, y]; N = [x + dx, y + dy]; break outer; }
  }
}
check('mapgrid 找到阻挡格+可站邻格', !!B && !!N, `B=${B} N=${N}`);

// 前置移动：站到 N（B 的邻格）
const mvN = await resp('move_to', P(N[0], N[1]), 25000);
check('前置移动到阻挡格邻格', !!mvN && mvN.t === 'move_started', mvN?.msg || 'timeout');
await waitDone();

// 1) 阻挡目标格 plant（合法种子 id=36，确保穿过种子检查走到预检）→ target-blocked 点名坐标+kind
const r1 = await resp('plant', { itemId: 36, ...P(B[0], B[1]) });
check('阻挡目标格 plant → 文案点名格坐标与 kind', !!r1 && r1.ok === false && /\d+,\d+/.test(r1.msg || '') && /水面|建筑\/障碍|越界/.test(r1.msg || ''), r1?.msg || 'timeout');

// 2) 远距目标：距离 >1 → 先报 far（旧短语保留）
const r2 = await resp('plant', { itemId: 36, ...P(N[0] + 3, N[1]) });
check('far 优先（离目标太远前缀保留）', !!r2 && r2.ok === false && /离目标太远/.test(r2.msg || ''), r2?.msg || 'timeout');

// 3) 正常 plant 失败路径回归（无种子）：种子检查在预检之前 → 文案应为种子类而非预检类
const r3 = await resp('plant', { itemId: 999, ...P(N[0] + 1, N[1]) });
check('未知种子报「没有这种种子」（不落入预检分支）', !!r3 && /没有这种种子/.test(r3.msg || ''), r3?.msg || 'timeout');

// 4) 同场景 move_to 边界阻挡格（格 0,0）：D3 交互环吸附（半径 8 内有可站格）→ move_started；
//    若全密封则回落 moveFailMsg 点名坐标。两种都是设计内行为。
const r4 = await resp('move_to', P(0, 0), 25000);
check('同场景阻挡角格：吸附成行或点名坐标', !!r4 && (r4.t === 'move_started' || /目标格 \d+,\d+/.test(r4.msg || '')), r4?.msg || `t=${r4?.t}` || 'timeout');
if (r4?.t === 'move_started') await waitDone();

// 5) 跨场景不可达（目标场景 0：无门户无 nav）。村景为源时门户全连通（1-14/101-113），
//    planRoute 失败分支无法从村景触发；「无导航数据」守卫先拦截 —— 断言失败+可读文案即可。
//    planRoute 失败+目标格坐标点名的覆盖在 e2e-nav-arrive E.2b（源场景 0 → 场景 5）。
const r5 = await resp('move_to', { x: 3050, y: 3050, scene: 0 }, 25000);
check('跨场景不可达返回可读失败文案', !!r5 && r5.ok === false && (/无导航数据|目标格 \d+,\d+/.test(r5.msg || '')), r5?.msg || 'timeout');

console.log(`----\n结果: ${results.filter(Boolean).length}/${results.length} 通过`);
process.exit(results.every(Boolean) ? 0 : 1);
