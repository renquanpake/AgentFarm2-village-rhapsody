// WS 联机验证：双玩家 join/move/save/chat 广播 + 心跳断线清理 + 重连
import WebSocket from 'ws';
import http from 'node:http';

const BASE = process.env.AF_BASE || 'http://127.0.0.1:8080';
const WS_BASE = process.env.AF_WS_BASE || BASE.replace(/^http/, 'ws');
const results = [];
const check = (name, cond, extra = '') => {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${extra ? ' | ' + extra : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const onceOpen = (ws) => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
const next = (ws, predicate, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { ws.off('message', on); reject(new Error('timeout waiting msg')); }, timeoutMs);
  const on = (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (predicate(m)) { clearTimeout(t); ws.off('message', on); resolve(m); } };
  ws.on('message', on);
});
const jget = async (p) => (await fetch(BASE + p)).json();
const jpost = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { ok: false, status: r.status, raw: t.slice(0, 120) }; } // 错误分支是纯文本
};
const playersList = async (tok) => (await jget('/af/players' + (tok ? `?token=${encodeURIComponent(tok)}` : '')));
const send = (ws, obj) => ws.send(JSON.stringify(obj));

// 自备账号：CI 是全新 checkout，data/accounts.json（gitignore）不存在 —— 先注册后登录，
// 再铸 agentToken。talk 断言与 /af/players（D18 起需 token）都依赖它。
// 用户名上限 16 字符（http.ts 注册正则），故用短前缀 + 时间戳 36 进制尾段。
async function ensureProbeAccount() {
  const username = `afp${Date.now().toString(36).slice(-8)}`;
  const password = 'probe_pw_1234';
  let r = await jpost('/af/register', { username, password });
  if (!r || !r.token) r = await jpost('/af/login', { username, password });
  if (!r || !r.token) { console.error(`自备账号失败：${JSON.stringify(r)}`); return null; }
  const ag = await jpost('/af/agent-token', { token: r.token });
  return { username, token: r.token, agentToken: ag && ag.agentToken };
}
const probe = await ensureProbeAccount();
if (!probe) { console.error('无法自备账号（注册/登录均失败）——协议回归中止'); process.exit(1); }

const A = new WebSocket(WS_BASE + '/ws');
const B = new WebSocket(WS_BASE + '/ws');
await onceOpen(A); await onceOpen(B);

// 1) join + welcome
send(A, { t: 'join', uid: 'ta0001', nick: '甲', x: 0, y: 0 });
const aw = await next(A, m => m.t === 'welcome' && m.uid === 'ta0001');
check('A join/welcome', !!aw);
// 2-5) 先挂好监听器再触发动作，避免广播先于监听器到达
const joinBProm = next(A, m => m.t === 'player_join' && m.p?.uid === 'tb0002');
send(B, { t: 'join', uid: 'tb0002', nick: '乙', x: 1, y: 1 });
const bw = await next(B, m => m.t === 'welcome' && m.uid === 'tb0002');
check('B join/welcome', !!bw && (bw.players || []).length === 2, `在线=${(bw.players || []).length}`);
const jb = await joinBProm;
check('player_join 广播', !!jb);

const mvProm = next(B, m => m.t === 'move' && m.uid === 'ta0001' && m.x === 5 && m.y === 6);
send(A, { t: 'move', scene: 0, x: 5, y: 6 });
const mv = await mvProm;
check('move 广播', !!mv);

// D17：save 走字段白名单 —— 客户端自有键（settingData）正常落库并广播
const svProm = next(B, m => m.t === 'save_broadcast' && Array.isArray(m.kv) && m.kv.some(([k]) => k === 'settingData_ta0001'));
send(A, { t: 'save', kv: [['settingData_ta0001', '{"hello":1}']] });
const sv = await svProm;
check('save_broadcast 广播（客户端自有键）', !!sv);
// D17：未注册键拒写（不进玩家桶、不广播）—— 锁字段白名单
const badKey = 'zzzSelfMade_ta0001';
let leaked = false;
const leakWatch = (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch { return; } if (m.t === 'save_broadcast' && Array.isArray(m.kv) && m.kv.some(([k]) => k === badKey)) leaked = true; };
B.on('message', leakWatch);
send(A, { t: 'save', kv: [[badKey, '{"x":1}']] });
await sleep(600);
B.off('message', leakWatch);
const guard = (await jget('/af/replay-status?token=' + encodeURIComponent(probe.token))).saveGuard || {};
check('save 白名单：未注册键不广播且计入拒写', !leaked && (guard.byReason?.['unknown-key'] || 0) >= 1, JSON.stringify(guard.byReason || {}));

const chProm = next(B, m => m.t === 'chat' && m.nick === '甲' && m.text === '联机测试你好');
send(A, { t: 'chat', text: '联机测试你好' });
const ch = await chProm;
check('chat 广播', !!ch);

// 6) HTTP 在线列表（D18 起需 token）
const pl = await playersList(probe.token);
check('HTTP /af/players', Array.isArray(pl) && pl.length === 2, JSON.stringify(pl).slice(0, 100));

// 7) talk：价目表 + persona 回退（agent 通道 act）
const AG = new WebSocket(WS_BASE + '/agent?token=' + encodeURIComponent(probe.agentToken));
await onceOpen(AG);
send(AG, { t: 'act', action: 'talk', npcId: 1, text: '你好' });
const tk1 = await next(AG, m => m.t === 'result' && m.action === 'talk');
check('talk 结果结构', !!tk1 && tk1.ok === true && 'priceList' in tk1 && 'dialogue' in tk1, JSON.stringify(tk1).slice(0, 200));
AG.close();

// 8) 心跳保活：B 存活超过 3 个心跳周期（服务器 2s 间隔）后仍能收到广播（证明 ping/pong 保活未误杀活连接）
await sleep(6500);
const hbProm = next(B, m => m.t === 'move' && m.uid === 'ta0001' && m.x === 9);
send(A, { t: 'move', scene: 0, x: 9, y: 0 });
const hb = await hbProm;
check('存活连接 3 个心跳周期后仍正常', !!hb);

// 9) 死连接清理：A 粗暴断电（不发 close frame），等 2 轮心跳后被清理
A.terminate();
await sleep(6500);
const pl2 = await playersList(probe.token);
const aGone = Array.isArray(pl2) && !pl2.some(p => p.uid === 'ta0001');
check('死连接被心跳清理', aGone, JSON.stringify(pl2).slice(0, 100));

// 10) A 重连恢复
const A2 = new WebSocket(WS_BASE + '/ws');
await onceOpen(A2);
send(A2, { t: 'join', uid: 'ta0001', nick: '甲', x: 0, y: 0 });
const aw2 = await next(A2, m => m.t === 'welcome' && m.uid === 'ta0001');
check('断线重连恢复', !!aw2);
const pl3 = await playersList(probe.token);
check('重连后在线列表正确', Array.isArray(pl3) && pl3.length === 2, JSON.stringify(pl3).slice(0, 100));

A2.close(); B.close();
const fails = results.filter(r => !r).length;
console.log('----');
console.log(fails ? `结果: ${results.length - fails}/${results.length} 通过` : `结果: 全部 ${results.length} 项通过`);
process.exit(fails ? 1 : 0);
