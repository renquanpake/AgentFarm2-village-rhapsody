#!/usr/bin/env node
// tools/f4-acceptance.mjs —— F4 §4.1 本地单机部署验收（docs/tailscale.md 清单 6 项实测）
// 用法：AF_BASE=http://127.0.0.1:8080 AF_AES_KEY=...(需服务端已带) node tools/f4-acceptance.mjs [--out data/eval/f4-4.1-acceptance.json]
// 每项 PASS/FAIL + 证据；全部 PASS 即 4.1 达标（4.2 双机 Tailscale 需用户第二台设备）
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASE = (process.env.AF_BASE || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const OUT = process.argv.includes('--out') ? join(ROOT, process.argv[process.argv.indexOf('--out') + 1]) : join(ROOT, 'data', 'eval', 'f4-4.1-acceptance.json');
// 本地 .env/.env.local（LLM 验收用；不打印密钥）
function loadDotEnv(file) {
  let t; try { t = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv(join(ROOT, '.env'));
loadDotEnv(join(ROOT, '.env.local'));

const results = [];
const item = (name, pass, evidence) => { results.push({ name, pass: !!pass, evidence: String(evidence).slice(0, 300) }); console.log(`[F4] ${pass ? 'PASS' : 'FAIL'} - ${name} | ${String(evidence).slice(0, 160)}`); };

// 0) 注册验收账号
const reg = await (async () => {
  const r = await fetch(BASE + '/af/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify({ username: 'f4acc' + Date.now().toString(36), password: 'f4accept' }) });
  return r.json();
})();
if (!reg.ok) { console.error('[F4] 注册失败', reg.msg, '——无法继续'); process.exit(1); }
const token = reg.token;
const H = { token: encodeURIComponent(token) };
const jget = async (p) => (await fetch(BASE + p, { headers: { Connection: 'close' } })).json();

// 1) 登录进游戏：WS join + move（双连接：B 监听 A 的 move 广播，等价 ws-test）
{
  const A = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  const B = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  await Promise.all([A, B].map(ws => new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); })));
  A.send(JSON.stringify({ t: 'join', uid: reg.uid, nick: 'F4验收', x: 0, y: 0, token }));
  B.send(JSON.stringify({ t: 'join', uid: 'f4observer', nick: 'F4观察', x: 1, y: 1 }));
  const welcomeP = new Promise((res) => {
    const to = setTimeout(() => res(null), 4000);
    A.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'welcome') { clearTimeout(to); res(m); } });
  });
  const moveP = new Promise((res) => {
    const to = setTimeout(() => res(false), 4000);
    B.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'move' && m.uid === reg.uid) { clearTimeout(to); res(true); } });
  });
  const welcome = await welcomeP;
  if (welcome) A.send(JSON.stringify({ t: 'move', scene: 0, x: 5, y: 6 }));
  const moveOk = await moveP;
  A.close(); B.close();
  item('1 登录进游戏（join/welcome + 他人视角 move 广播）', welcome && moveOk, `welcome=${!!welcome} move广播=${moveOk}`);
}

// 2) 交易：/af/economy（货币治理）+ /af/market/1（订单簿 price/depth）
{
  const e = await jget('/af/economy?token=' + H.token);
  const mkt = await jget('/af/market/1?token=' + H.token);
  const mktOk = mkt.ok && (Array.isArray(mkt.book?.bids) || mkt.book || mkt.last7 || mkt.book);
  item('2 交易（/af/economy feeMultiplier/inflationIndex + /af/market/1 订单簿）', e.ok && e.feeMultiplier !== undefined && mktOk,
    `feeMult=${e.feeMultiplier} 通胀=${e.inflationIndex} 订单簿=${JSON.stringify(mkt.book || mkt).slice(0, 100)}`);
}

// 3) 画报：/af/daily-report（响应为 {ok, ...report} 扁平结构）
{
  const d = await jget('/af/daily-report?token=' + H.token);
  item('3 画报（/af/daily-report eventCount/byType/highlights/reportHash）', d.ok && typeof d.reportHash === 'string' && typeof d.eventCount === 'number',
    `eventCount=${d.eventCount} reportHash=${String(d.reportHash).slice(0, 10)}…`);
}

// 4) 影子：/af/shadow
{
  const s = await jget('/af/shadow?days=1&token=' + H.token);
  item('4 影子（/af/shadow?days=1）', s.ok && Array.isArray(s.items), `items=${s.items?.length ?? 0}（14 日观察期数据逐日增长）`);
}

// 5) NPC/动物/天气/游戏日：/af/calendar + /af/npc-schedule（确定性机制验收）+ /af/animals
// 注：快时钟下游戏时恒 21-23 时段（全员在家）+ 雨天亦在家 -> 幂等不换位、无 npc_move 广播；
// npc_move 实现在线观察需生产游戏日钟（AF_GROW_MS=600000 起 ~13h 后换时段），此处以快照端点验收
{
  const c = await jget('/af/calendar?n=7');
  const ns = await jget('/af/npc-schedule');
  const an = await jget('/af/animals');
  const npcsOk = ns.ok && Array.isArray(ns.npcs) && ns.npcs.length > 0;
  item('5 NPC/动物/天气（calendar+npc-schedule 快照+animals）', c.ok && Array.isArray(c.days) && npcsOk && an.ok,
    `day${ns.day} ${ns.hour}时 ${ns.weather}${ns.festival ? '/' + ns.festival : ''} NPC=${ns.npcs?.length} 家（例：${ns.npcs?.[0]?.name} ${ns.npcs?.[0]?.activity}） animals=${an.count}（新存档 0 正常）`);
}

// 6) LLM：/af/llm-key 保存（AF_AES_KEY 保管）+ /af/llm-usage 结构
{
  const imgKey = process.env.AF_LLM_KEY || process.env.USER_IMG_API_KEY;
  const imgUrl = process.env.AF_LLM_URL || process.env.USER_IMG_BASE_URL || '';
  if (!imgKey) { item('6 LLM（/af/llm-key 保存 + 计量端点）', false, '本地 .env 无 LLM Key，跳过保存（端点结构另验）'); }
  else {
    const p = await (await fetch(BASE + '/af/llm-key?token=' + H.token, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: JSON.stringify({ base_url: imgUrl, model: process.env.AF_LLM_MODEL || 'agnes-3.0-flash', api_key: imgKey }),
    })).json();
    const g = await jget('/af/llm-key?token=' + H.token);
    const u = await jget('/af/llm-usage?token=' + H.token);
    item('6 LLM（/af/llm-key 加密保管 + /af/llm-usage 计量）', p.ok === true && g.keySet === true && u.ok, `POST=${p.ok} GET.keySet=${g.keySet} usage端点=${u.ok}（实际用量随 LLM 任务产生）`);
  }
}

const report = { at: new Date().toISOString(), base: BASE, results, pass: results.every(r => r.pass), fail: results.filter(r => !r.pass).map(r => r.name) };
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`[F4] 总结：${report.pass ? '6/6 全过（4.1 达标）' : '通过 ' + results.filter(r => r.pass).length + '/6，失败: ' + report.fail.join(', ')} -> ${OUT}`);
process.exit(report.pass ? 0 : 1);
