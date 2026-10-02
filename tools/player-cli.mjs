#!/usr/bin/env node
// tools/player-cli.mjs —— 玩家视角通用 CLI（observe 世界 + 任意 act + 看盘/看己方）
// 供 LLM 玩家 agent 游玩 & 挑刺。服务器须已在 AF_BASE 运行。
// 用法：
//   node tools/player-cli.mjs <agentToken> observe                 # 世界状态
//   node tools/player-cli.mjs <agentToken> act <action> [k=v ...]  # 任意 act（till/water/harvest/chop/mine/fish/move/move_to/talk/forecast/train/...）
//   node tools/player-cli.mjs <agentToken> book <item>             # 物品盘口
//   node tools/player-cli.mjs <agentToken> self <uid>              # 自己金币/库存
// 环境变量：AF_BASE（默认 http://127.0.0.1:8091）
import WebSocket from 'ws';

const BASE = process.env.AF_BASE || 'http://127.0.0.1:8091';
const WS_BASE = BASE.replace(/^http/, 'ws');
const [, , agentToken, cmd, ...rest] = process.argv;
if (!agentToken || !cmd) { console.error('用法：node tools/player-cli.mjs <agentToken> <observe|act|book|self|trade> ...'); process.exit(2); }
const out = (o) => { console.log(JSON.stringify(o, null, 1)); };

const openAgent = () => new Promise((res, rej) => {
  const ws = new WebSocket(WS_BASE + '/agent?token=' + encodeURIComponent(agentToken));
  ws.on('open', () => res(ws)); ws.on('error', rej);
  setTimeout(() => rej(new Error('ws open timeout')), 5000);
});

if (cmd === 'observe') {
  const ws = await openAgent();
  await new Promise((res) => {
    let settled = false;
    ws.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!settled && m.t === 'state') { settled = true; out(m); ws.close(); res(); } });
    setTimeout(() => { if (!settled) { out({ error: 'no state within 4s' }); ws.close(); res(); } }, 4000);
    ws.send(JSON.stringify({ t: 'observe' }));
  });
} else if (cmd === 'act') {
  const action = rest[0];
  if (!action) { console.error('act 需 <action>'); process.exit(2); }
  const kv = {};
  for (let i = 1; i < rest.length; i++) {
    const [k, v] = rest[i].split('=');
    const n = Number(v);
    kv[k] = v !== undefined && v !== '' && Number.isFinite(n) && String(n) === v ? n : v;
  }
  const ws = await openAgent();
  await new Promise((res) => {
    let settled = false;
    const on = (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!settled && m.t === 'result' && m.action === action) { settled = true; out(m); ws.close(); res(); } };
    ws.on('message', on);
    setTimeout(() => { if (!settled) { out({ ok: false, action, error: 'no result within 4s' }); ws.close(); res(); } }, 4000);
    ws.send(JSON.stringify({ t: 'act', action, ...kv }));
  });
} else if (cmd === 'book') {
  const item = rest[0];
  // book 需要账号 token（accToken）——这里 agentToken 与 accToken 不同，改用 /agent 的 act trade op=book
  const ws = await openAgent();
  await new Promise((res) => {
    let settled = false;
    const seq = Math.random().toString(36).slice(2, 10);
    const on = (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!settled && m.t === 'result' && m.action === 'trade' && m.seq === seq) { settled = true; out(m); ws.close(); res(); } };
    ws.on('message', on);
    setTimeout(() => { if (!settled) { out({ ok: false, error: 'no book within 4s' }); ws.close(); res(); } }, 4000);
    ws.send(JSON.stringify({ t: 'act', action: 'trade', op: 'book', itemId: Number(item), seq }));
  });
} else if (cmd === 'self') {
  // self 需要 accToken+uid；此 CLI 只带 agentToken，无法直接查 /af/save（要 accToken）。
  console.error('self 需 accToken+uid，请用 llm-player.mjs self <accToken> <uid>');
  process.exit(2);
} else {
  console.error('未知命令：' + cmd);
  process.exit(2);
}
