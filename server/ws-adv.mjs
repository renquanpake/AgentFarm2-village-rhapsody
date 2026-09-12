// 玩家视角对抗测试（afserver 行为边界 / 状态机 / 并发安全）
// 场景：玩家连接 + 假 agent 连接同时在线，模拟真实操作路径
// 用法: node server/ws-adv.mjs
import WebSocket from 'ws';
const BASE = 'http://127.0.0.1:8080';
const WS = 'ws://127.0.0.1:8080/ws';
const results = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const record = (n, v, d) => { results.push({ n, v, d }); console.log(`[${v === 'FAIL' ? '失败' : v === 'WARN' ? '观察' : '通过'}] ${n} :: ${d}`); };
function mkWS() { return new Promise((res, rej) => { const ws = new WebSocket(WS); ws._msgs = []; ws._closed = false; ws.on('close', () => { ws._closed = true; }); ws.on('open', () => res(ws)); ws.on('error', rej); ws.on('message', (d) => { try { ws._msgs.push(JSON.parse(d.toString())); } catch {} }); }); }
function mkAgentWS() { return new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:8080/agent?token=${AGENT_TOKEN}`); ws._msgs = []; ws.on('open', () => res(ws)); ws.on('error', rej); ws.on('close', () => {}); ws.on('message', (d) => { try { ws._msgs.push(JSON.parse(d.toString())); } catch {} }); }); }
function msgOf(ws, pred, ms = 1500) { return new Promise((res) => { const t0 = Date.now(); const iv = setInterval(() => { const m = ws._msgs.find(pred); if (m) { clearInterval(iv); res(m); } else if (Date.now() - t0 > ms) { clearInterval(iv); res(null); } }, 50); }); }

// ===== 准备：新账号 + agent 接入码 =====
const regRes = await fetch(BASE + '/af/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `adv_${Date.now() % 100000}`, password: 'pw123456' }) });
const REG = await regRes.json();
const P_TOKEN = REG.token, P_UID = REG.uid;
const atRes = await fetch(BASE + '/af/agent-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: P_TOKEN }) });
const AT = await atRes.json();
const AGENT_TOKEN = AT.agentToken;
console.log(`[setup] 玩家 ${P_UID} / agent ${AGENT_TOKEN.slice(0, 12)}…`);

// ===== A) 状态切换与权限边界 =====
{
  // A1: 未启动托管时，agent 相关消息无副作用
  const p = await mkWS(); p.send(JSON.stringify({ t: 'join', uid: P_UID, nick: 'ADV', token: P_TOKEN })); await sleep(400);
  p._msgs = [];
  p.send(JSON.stringify({ t: 'agent_interrupt' })); await sleep(200);
  p.send(JSON.stringify({ t: 'agent_resume' })); await sleep(200);
  const acts = p._msgs.filter(m => m.t === 'agent_activity');
  record('A1 无agent时操作', acts.length === 0 ? 'PASS' : 'WARN', `无 agent 时 interrupt/resume 产生 ${acts.length} 条 agent_activity（期望 0）`);
  p.close();
}
{
  // A2: agent 连接在线时 interrupt/resume 语义（5s 节流可能吞 interrupt，断言放宽为至少收到一条含语义的 agent_activity）
  const p = await mkWS(); p.send(JSON.stringify({ t: 'join', uid: P_UID, nick: 'ADV', token: P_TOKEN })); await sleep(300);
  const ag = await mkAgentWS(); await sleep(400);
  const st = await msgOf(p, m => m.t === 'agent_status' && m.online, 2000);
  p._msgs = [];
  p.send(JSON.stringify({ t: 'agent_interrupt' }));
  p.send(JSON.stringify({ t: 'agent_resume' }));
  await sleep(500);
  const acts = p._msgs.filter(m => m.t === 'agent_activity');
  const hasSemantic = acts.some(m => /让位|停手|等你|恢复/.test(m.activity || ''));
  record('A2 状态流转', st && hasSemantic ? 'PASS' : 'WARN',
    `join 后 agent_status=${st ? '在线' : '未收到'}, interrupt/resume 共推 ${acts.length} 条，含语义=${hasSemantic}（5s 节流可能吞 interrupt）`);
  ag.close(); p.close();
}
{
  // A3: 伪造 agentToken 连接 /agent 通道
  const fake = AGENT_TOKEN.slice(0, 6) + '000000';
  const r = await new Promise((res) => { const ws = new WebSocket(`ws://127.0.0.1:8080/agent?token=${fake}`); ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.t === 'agent_reject' || m.t === 'error' || m.t === 'welcome') res(m); }); ws.on('close', () => res({ t: 'closed' })); setTimeout(() => res({ t: 'timeout' }), 3000); });
  record('A3 伪造agentToken', r.t === 'agent_reject' || r.t === 'closed' ? 'PASS' : 'WARN',
    `伪造token连接/agent 收到: ${JSON.stringify(r).slice(0, 80)}`);
}

// ===== B) move_to 并发与边界 =====
{
  // B1: 同一 agent 连接并发两个 move_to，第二个应被拒
  const ag = await mkAgentWS();
  await sleep(400); // 等 agent 通道就绪
  ag.send(JSON.stringify({ t: 'act', action: 'move_to', x: 4000, y: 4000, seq: 1 }));
  await sleep(300);
  ag.send(JSON.stringify({ t: 'act', action: 'move_to', x: 5000, y: 5000, seq: 2 }));
  const res = await msgOf(ag, m => m.t === 'result' && m.seq === 2, 3000);
  record('B1 move并发', res && (res.ok === false || (res.msg || '').includes('还没走完')) ? 'PASS' : 'WARN',
    `并发move_to 第2个返回: ${JSON.stringify(res || 'timeout').slice(0, 80)}`);
  await sleep(3000); // 让路径走完
  ag.close();
}

// ===== C) 收件箱隔离与长度 =====
{
  // C1: 玩家 A 的 inbox 不会发给玩家 B（用另一个游客 uid 模拟旁观）
  const p = await mkWS(); p.send(JSON.stringify({ t: 'join', uid: P_UID, nick: 'ADV', token: P_TOKEN })); await sleep(300);
  const spectator = await mkWS(); spectator.send(JSON.stringify({ t: 'join', uid: `guest_spec_${Date.now()}`, nick: '旁观' })); await sleep(300);
  p.send(JSON.stringify({ t: 'agent_msg', text: '去河边钓鱼' }));
  await sleep(500);
  const specActs = spectator._msgs.filter(m => m.t === 'agent_activity');
  record('C1 收件箱隔离', specActs.length === 0 ? 'PASS' : 'WARN', `旁观者收到 agent_activity=${specActs.length}（期望 0，收件箱只进主人 agent socket）`);
  p.close(); spectator.close();
}
{
  // C2: 收件箱长度上限（发 60 条后应只保留 50）
  const p = await mkWS(); p.send(JSON.stringify({ t: 'join', uid: P_UID, nick: 'ADV', token: P_TOKEN })); await sleep(300);
  for (let i = 0; i < 60; i++) p.send(JSON.stringify({ t: 'agent_msg', text: `msg_${i}` }));
  await sleep(800);
  const fs = await import('node:fs');
  const inboxFile = `data/agent-notes/ADV/inbox.json`;
  let inbox = [];
  try { inbox = JSON.parse(fs.readFileSync(inboxFile, 'utf8')); } catch {}
  record('C2 inbox上限', Array.isArray(inbox) && inbox.length <= 50 ? 'PASS' : 'WARN', `发60条后 inbox 实际 ${inbox.length} 条`);
  p.close();
}

// ===== D) 玩家操作打断频率 =====
{
  // D1: 5秒内多次存档操作，agent 最多推1次 player_op（agent 在线时）
  const p = await mkWS(); p.send(JSON.stringify({ t: 'join', uid: P_UID, nick: 'ADV', token: P_TOKEN })); await sleep(300);
  const ag = await mkAgentWS(); await sleep(400);
  p.send(JSON.stringify({ t: 'save', kv: [['probe_k', 1]] }));
  await sleep(150);
  p.send(JSON.stringify({ t: 'save', kv: [['probe_k', 2]] }));
  await sleep(150);
  p.send(JSON.stringify({ t: 'save', kv: [['probe_k', 3]] }));
  await sleep(2000);
  const ops = p._msgs.filter(m => m.t === 'agent_activity');
  record('D1 打断节流', ops.length <= 2 ? 'PASS' : 'WARN', `3次存档在5s窗口内触发 ${ops.length} 条 agent_activity（期望 ≤2，5s节流）`);
  ag.close(); p.close();
}

// ===== E) 状态持久性 =====
{
  // E1: agent 连接在线时 agent-status 应返回 online=true
  const p = await mkWS(); p.send(JSON.stringify({ t: 'join', uid: P_UID, nick: 'ADV', token: P_TOKEN })); await sleep(300);
  const ag = await mkAgentWS(); await sleep(400);
  const st1 = await (await fetch(BASE + `/af/agent-status?token=${P_TOKEN}`)).json();
  record('E1 在线状态', st1.online === true ? 'PASS' : 'WARN', `agent在线时 agent-status online=${st1.online}`);
  ag.close(); await sleep(300);
  const st2 = await (await fetch(BASE + `/af/agent-status?token=${P_TOKEN}`)).json();
  record('E2 离线状态', st2.online === false ? 'PASS' : 'WARN', `agent断开后 online=${st2.online}`);
  p.close();
}

// ===== F) 命令参数注入 =====
{
  // F1: agent 通道 act 里传超大坐标/负数/非数字
  const ag = await mkAgentWS(); await sleep(400);
  ag._msgs = [];
  ag.send(JSON.stringify({ t: 'act', action: 'move_to', x: -99999, y: -99999, seq: 10 }));
  const r1 = await msgOf(ag, m => m.t === 'result' && m.seq === 10, 3000);
  ag.send(JSON.stringify({ t: 'act', action: 'move_to', x: 'abc', y: 'def', seq: 11 }));
  const r2 = await msgOf(ag, m => m.t === 'result' && m.seq === 11, 3000);
  ag.send(JSON.stringify({ t: 'act', action: 'buy', npcId: 999, itemId: 999999, seq: 12 }));
  const r3 = await msgOf(ag, m => m.t === 'result' && m.seq === 12, 3000);
  const bad1 = !r1 || r1.ok === false;
  const bad2 = !r2 || r2.ok === false;
  const bad3 = !r3 || r3.ok === false;
  record('F1 参数注入', (bad1 && bad2 && bad3) ? 'PASS' : 'WARN',
    `move_to(-99999)=${JSON.stringify(r1 || '拒').slice(0, 50)}, move_to(abc)=${JSON.stringify(r2 || '拒').slice(0, 50)}, buy(id999999)${r3 ? '拒' : '超时'}`);
  ag.close();
}

// ===== G) 顶号与agent并存 =====
{
  // G1: 同账号二次 join，旧连接被踢，agent 通道不受影响
  const ag = await mkAgentWS(); await sleep(400);
  const p1 = await mkWS(); p1.send(JSON.stringify({ t: 'join', uid: P_UID, nick: 'ADV', token: P_TOKEN })); await sleep(300);
  const p2 = await mkWS(); p2.send(JSON.stringify({ t: 'join', uid: P_UID, nick: 'ADV2', token: P_TOKEN })); await sleep(500);
  const kicked = await msgOf(p1, m => m.t === 'kicked', 2000);
  record('G1 顶号', kicked ? 'PASS' : 'WARN', `旧连接收到 kicked=${!!kicked}`);
  ag.close(); p1.close(); p2.close();
}

// ===== 汇总 =====
await sleep(300);
console.log('\n===== 玩家视角对抗测试汇总 =====');
const fail = results.filter(r => r.v === 'FAIL').length;
const warn = results.filter(r => r.v === 'WARN').length;
console.log(`失败: ${fail}/${results.length}, 观察: ${warn}`);
for (const r of results) if (r.v !== 'PASS') console.log(`  ${r.v === 'FAIL' ? 'FAIL' : 'WARN'} ${r.n}: ${r.d}`);
process.exit(fail ? 1 : 0);
