// tools/agent-act-e2e.mjs —— agent 目标格动作预检与 move_to 失败文案 E2E（批1c Task2/3 断言）
// 起隔离实例：PORT=8087 AF_SLOT=91 AF_NO_TUNNEL=1 node src/index.ts（server/ 目录）
// 用法：AF_BASE=http://127.0.0.1:8087 node tools/agent-act-e2e.mjs
import WebSocket from 'ws';
import http from 'node:http';

const BASE = process.env.AF_BASE || 'http://127.0.0.1:8087';
const WS_BASE = BASE.replace(/^http/, 'ws');
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${extra ? ' | ' + extra : ''}`); };

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

// 游戏通道（在线 → move_to 走确认环；此处不回报 arrive，走 8s 盲推回落）
const G = new WebSocket(WS_BASE + '/ws');
G.on('open', () => G.send(JSON.stringify({ t: 'join', uid, nick: '动作验证', token })));
await new Promise(r => G.once('message', r));

// agent 通道
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

await new Promise(r => setTimeout(r, 1500));

// 1) 水格目标 plant（(0,0) 边界格 / 水格）→ target-blocked 点名文案
const r1 = await resp('plant', { itemId: 11, x: 50, y: 50 });
check('water 目标格 plant → 文案点名格坐标与 kind', !!r1 && r1.ok === false && /\d+,\d+/.test(r1.msg || '') && /水面|建筑\/障碍|越界/.test(r1.msg || ''), r1?.msg || 'timeout');

// 2) 远距 target-blocked：目标格是水面但距离 >1 → 仍先报 far（旧短语保留）
const r2 = await resp('plant', { itemId: 11, x: 1550, y: 1550 });
check('far 优先（离目标太远前缀保留）', !!r2 && r2.ok === false && /离目标太远/.test(r2.msg || ''), r2?.msg || 'timeout');

// 3) 正常 plant 失败路径回归（无种子）：距离足够近、目标空地 → 文案应为背包类而非预检类
const r3 = await resp('plant', { itemId: 999, x: 6550, y: 5350 });
check('未知种子报「没有这种种子」（不落入预检分支）', !!r3 && /没有这种种子/.test(r3.msg || ''), r3?.msg || 'timeout');

// 4) 同场景 move_to 不可达点名（角格 (0,0) 被吸附回起点 → 不可达路径）
const r4 = await resp('move_to', { x: 50, y: 50 }, 25000);
check('同场景不可达文案含目标格坐标', !!r4 && /目标格 0,0/.test(r4.msg || ''), r4?.msg || 'timeout');

// 5) 跨场景不可达点名（场景 14 无村门 → planRoute 跨场景失败）
const r5 = await resp('move_to', { x: 3050, y: 3050, scene: 14 }, 25000);
check('跨场景不可达文案点名目标格坐标+kind', !!r5 && r5.ok === false && /目标格 30,30/.test(r5.msg || ''), r5?.msg || 'timeout');

console.log(`----\n结果: ${results.filter(Boolean).length}/${results.length} 通过`);
process.exit(results.every(Boolean) ? 0 : 1);
