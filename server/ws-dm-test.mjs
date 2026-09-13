#!/usr/bin/env node
// 多账号 DM 联调验证：2 个注册账号，各连 1 条玩家 WS + 1 条 agent WS
// 验证：social_talk 解锁 → agent dm_send（在线/离线目标）→ dm_in 实时推送 → dm_log 持久化
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// cloudflared 隧道断连时底层 socket ECONNRESET 是已知干扰，静默处理
process.on('uncaughtException', (e) => {
  if (e.code === 'ECONNRESET' || /socket hang up/.test(e.message)) return;
  console.error('UNCAUGHT:', e.message);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  if (e && (e.code === 'ECONNRESET' || /socket hang up/.test(e.message || ''))) return;
  console.error('UNHANDLED REJECTION:', e.message);
  process.exit(1);
});

const PORT = 8080;
const NAMES = ['联甲', '联乙'];
// 从 accounts.json 直接读已有账号（跳过 HTTP 注册流程，避免 keep-alive ECONNRESET）
const accountsPath = join(import.meta.dirname, '..', 'data', 'accounts.json');
const accounts = JSON.parse(readFileSync(accountsPath, 'utf-8'));
// 找已有账号（上次测试创建的）
const existing = NAMES.map(n => accounts[n]).filter(Boolean);
if (existing.length < 2) throw new Error('accounts.json 里缺少联甲/联乙，请先手动注册');
const accs = existing.map(a => ({ uid: a.uid, nick: a.nick, token: a.token, agentToken: a.agentToken }));
console.log(`[setup] ${accs.map(a => `${a.nick}(${a.uid})`).join(' / ')}`);

let pass = 0, fail = 0;
const ok  = (n) => { pass++;  console.log(`PASS  ${n}`); };
const bad = (n, m) => { fail++; console.log(`FAIL  ${n}  ${m || ''}`); };

// ---------- WS ----------
async function openWs(path, qs, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}${qs}`);
        ws._msgs = [];
        let settled = false;
        ws.on('message', (raw) => {
          let m; try { m = JSON.parse(raw.toString()); } catch { return; }
          ws._msgs.push(m);
        });
        ws.on('open', () => { if (!settled) { settled = true; resolve(ws); } });
        ws.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
        ws.on('close', () => {});
        const to = setTimeout(() => { if (!settled) { settled = true; reject(new Error(`connect timeout`)); } }, 5000);
        ws.on('open', () => clearTimeout(to));
      });
    } catch (e) {
      console.log(`[ws] ${path} attempt ${i+1} failed: ${e.message}, retry...`);
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function send(ws, obj) { ws.send(JSON.stringify(obj)); }

function waitMsg(ws, t, ms = 6000) {
  return new Promise((resolve, reject) => {
    const prevLen = ws._msgs.length;
    const iv = setInterval(() => {
      for (let i = prevLen; i < ws._msgs.length; i++) if (ws._msgs[i].t === t) { clearInterval(iv); resolve(ws._msgs[i]); }
    }, 50);
    setTimeout(() => { clearInterval(iv); reject(new Error(`timeout wait ${t}`)); }, ms);
  });
}

async function joinPlayer(ws, uid, nick, token, retries = 5) {
  for (let i = 0; i < retries; i++) {
    send(ws, { t: 'join', uid, nick, token });
    const r = await waitMsg(ws, 'welcome', 3000).catch(e => e);
    if (r && r.t === 'welcome') { ws._msgs.length = 0; console.log(`[join] ${nick} ok (attempt ${i+1})`); return; }
    if (r && r.t === 'join_deny') { console.log(`[join] ${nick} DENY: ${r.msg}`); throw new Error(`join deny: ${r.msg}`); }
    console.log(`[join] ${nick} attempt ${i+1} no welcome, retrying...`);
    await new Promise(res => setTimeout(res, 1000));
  }
  throw new Error(`joinPlayer failed for ${nick}`);
}

function agentCall(ws, type, extra = {}) {
  const prevLen = ws._msgs.length;
  // dm_send 的响应类型是 dm_result；dm_log → dm_log；dm_unlocked → dm_unlocked_list
  const respType = type === 'dm_send' ? 'dm_result' : type;
  return new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      for (let i = prevLen; i < ws._msgs.length; i++) {
        if (ws._msgs[i].t === respType) { clearInterval(iv); resolve(ws._msgs[i]); }
      }
    }, 30);
    send(ws, { t: type, ...extra });
    setTimeout(() => { clearInterval(iv); reject(new Error(`agent timeout ${type}`)); }, 8000);
  });
}

(async () => {
  // 2. 各账号玩家连接（带 token 鉴权）
  const pA = await openWs('/ws', `?uid=${accs[0].uid}`);
  const pB = await openWs('/ws', `?uid=${accs[1].uid}`);
  await joinPlayer(pA, accs[0].uid, accs[0].nick, accs[0].token);
  await joinPlayer(pB, accs[1].uid, accs[1].nick, accs[1].token);
  console.log('--- 2 个玩家已 join ---');

  // 3. 移动 A、B 到同场景近距离
  send(pA, { t: 'move', scene: 0, x: 100, y: 100 });
  send(pB, { t: 'move', scene: 0, x: 110, y: 110 });
  await new Promise(r => setTimeout(r, 400));

  // 4. A social_talk B → 解锁 DM
  send(pA, { t: 'social_talk', target: accs[1].uid, text: '你好' });
  const talkRes = await waitMsg(pA, 'social_result', 6000).catch(e => ({ t: 'social_result', ok: false, msg: String(e) }));
  if (talkRes.ok) ok('A social_talk B → DM 解锁（首次见面）');
  else bad('A social_talk B', talkRes.msg);

  // 5. 验证 dm_unlocked_list
  send(pA, { t: 'dm_unlocked' });
  const dmList = await waitMsg(pA, 'dm_unlocked_list', 5000).catch(() => ({ peers: [] }));
  if (dmList.peers?.length >= 1) ok(`dm_unlocked_list 有 ${dmList.peers.length} 个已解锁对象`);
  else bad('dm_unlocked_list 空', JSON.stringify(dmList));

  // 6. agent 连接（直接用 accounts.json 里的 agentToken）
  if (!accs[0].agentToken || !accs[1].agentToken) throw new Error('accounts.json 里 agentToken 缺失，需先跑一次 /af/agent-token');
  const agA = await openWs('/agent', `?token=${accs[0].agentToken}`);
  const agB = await openWs('/agent', `?token=${accs[1].agentToken}`);
  await new Promise(r => setTimeout(r, 500)); // 等 agent 连接初始化
  console.log('--- 2 条 agent 连接已建立 ---');

  // 7. agent A → B dm_send（在线目标），同时监听 B 玩家 socket 和 agent B socket 的 dm_in
  const pBMsgLenBefore = pB._msgs.length;
  const agBMsgLenBefore = agB._msgs.length;
  const agDmRes = await agentCall(agA, 'dm_send', { target: accs[1].uid, text: 'agent 私信 hello' });
  if (agDmRes.ok) ok('agent A → B dm_send（在线目标）成功');
  else bad('agent A dm_send 在线', JSON.stringify(agDmRes));

  // 8. B 玩家端收到 dm_in（agent → 玩家）
  const pBDmIn = new Promise((resolve) => {
    const iv = setInterval(() => {
      for (let i = pBMsgLenBefore; i < pB._msgs.length; i++) {
        if (pB._msgs[i].t === 'dm_in') { clearInterval(iv); resolve(pB._msgs[i]); }
      }
    }, 30);
    setTimeout(() => { clearInterval(iv); resolve(null); }, 5000);
  });
  const dmIn = await pBDmIn;
  if (dmIn && dmIn.t === 'dm_in' && dmIn.text === 'agent 私信 hello') ok('B 玩家端收到 dm_in（agent → 玩家）');
  else bad('B 未收到 dm_in', JSON.stringify(dmIn));

  // 9. agent B socket 也收到 dm_in（agent → agent）
  const agBDmIn = new Promise((resolve) => {
    const iv = setInterval(() => {
      for (let i = agBMsgLenBefore; i < agB._msgs.length; i++) {
        if (agB._msgs[i].t === 'dm_in') { clearInterval(iv); resolve(agB._msgs[i]); }
      }
    }, 30);
    setTimeout(() => { clearInterval(iv); resolve(null); }, 5000);
  });
  const agDmIn = await agBDmIn;
  if (agDmIn && agDmIn.t === 'dm_in') ok('agent B socket 收到 dm_in（agent → agent）');
  else bad('agent B 未收到 dm_in', JSON.stringify(agDmIn));

  // 10. agent B 回 A
  const agBRes = await agentCall(agB, 'dm_send', { target: accs[0].uid, text: '收到，agent B 回复' });
  if (agBRes.ok) ok('agent B → A dm_send 成功');
  else bad('agent B dm_send', JSON.stringify(agBRes));

  // 11. dm_log 验证持久化（A 侧应看到 2 条：自己发的 + B 回的）
  const logRes = await agentCall(agA, 'dm_log', { target: accs[1].uid });
  if (logRes.msgs?.length >= 2) ok(`agent A dm_log 有 ${logRes.msgs.length} 条（双向消息均持久化）`);
  else bad('agent A dm_log 不足 2 条', `got ${logRes.msgs?.length}`);

  // 12. B 玩家离线，agent A 给 B 发 DM（离线目标，消息入持久化日志）
  pB.close();
  await new Promise(r => setTimeout(r, 800));
  const agOffRes = await agentCall(agA, 'dm_send', { target: accs[1].uid, text: 'B 离线期间的消息' });
  if (agOffRes.ok) ok('agent A → 离线 B dm_send 成功（resolveAnyUid 生效）');
  else bad('agent A → 离线 B', JSON.stringify(agOffRes));

  // 13. B 重新上线，dm_log 能看到离线期间消息（共 3 条）
  const pB2 = await openWs('/ws', `?uid=${accs[1].uid}`);
  await joinPlayer(pB2, accs[1].uid, accs[1].nick, accs[1].token);
  const logRes2 = await agentCall(agA, 'dm_log', { target: accs[1].uid });
  if (logRes2.msgs?.length >= 3) ok(`B 重新上线后 dm_log 有 ${logRes2.msgs.length} 条（含离线期消息）`);
  else bad('dm_log 不足 3 条', `got ${logRes2.msgs?.length}`);

  pA.close(); pB2.close();
  agA.close(); agB.close();
  console.log(`\n结果：${pass}/${pass + fail} 通过，${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})();
