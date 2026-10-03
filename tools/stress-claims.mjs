// tools/stress-claims.mjs —— C 包行为验证：100 并发抢 1 棵树的抢占原子性压测
//
// 事故背景：抢占裁决（C1 tryClaim 先到先得 + 幂等 + 过期抢占）在单测里是 8 例顺序用例，
// 「并发下先到先得」这件事没有行为层验证 —— 而进化书 §1 的收口标准要求
// 「代码侧 ✅ + 行为验证 ✅」。本脚本直接打真实 HTTP/WS 通道，不是内部函数自证。
//
// 用法：
//   AF_BASE=http://127.0.0.1:8155 node tools/stress-claims.mjs [--players 100] [--rounds 3]
// 判定：任一轮出现「同一棵树被两个 uid 同时持有」即 FAIL（exit 1）
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.AF_BASE || 'http://127.0.0.1:8080';
const WS_BASE = BASE.replace(/^http/, 'ws');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const PLAYERS = Math.max(2, Math.min(200, arg('--players', 100)));
const ROUNDS = Math.max(1, Math.min(10, arg('--rounds', 3)));

const jpost = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { ok: false, raw: t.slice(0, 120), status: r.status }; }
};

/**
 * 备号：服务端 accounts.register 有「每秒最多 5 个注册」硬限流（防滥用，见 accounts.ts regWin），
 * 所以这里串行 + 退避重试，而不是并发注册（30 并发只会成功 5 个）。
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function makeAccount(i, stamp) {
  const username = `afst${i}${stamp}`.slice(0, 15);
  const password = 'stress_pw_1';
  for (let attempt = 0; attempt < 8; attempt++) {
    let r = await jpost('/af/register', { username, password });
    if (!r.token) r = await jpost('/af/login', { username, password });
    if (r.token) {
      const ag = await jpost('/af/agent-token', { token: r.token });
      if (ag?.agentToken) return { username, token: r.token, agentToken: ag.agentToken };
    }
    await sleep(260);   // 越过每秒 5 个的限流窗口
  }
  return null;
}

/** 找一块可抢占的目标：优先「可耕地」（plantSoils 掩码），否则退回村中心的树/地块 */
function pickClaimTarget() {
  const farm = path.join(repo, 'data/village-farm.json');
  if (!existsSync(farm)) return null;
  const fd = JSON.parse(readFileSync(farm, 'utf8'));
  const W = fd.soilW || 189;
  const mask = Array.isArray(fd.plantSoils) ? fd.plantSoils : null;
  if (!mask) return null;
  const cands = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const gx = i % W, gy = Math.floor(i / W);
    if (gx > 60 && gx < 130 && gy > 60 && gy < 120) cands.push({ gx, gy, px: gx * 100 + 50, py: gy * 100 + 50 });
  }
  const pick = cands[Math.floor(cands.length / 2)];
  // kind=generic：不要求世界里真有树/已犁地块，直接压 tryClaim 裁决器的原子性
  // （tree/plot 的存在性校验是另一条路径，已由 act claim 的单测与实机覆盖）
  return pick ? { ...pick, kind: 'generic' } : null;
}

const target = pickClaimTarget();
if (!target) { console.error('[stress-claims] 找不到可抢占的耕地候选（data/village-farm.json 缺 soil 掩码）'); process.exit(1); }
console.log(`[stress-claims] 目标：${PLAYERS} 并发抢同一份 ${target.kind} (${target.gx},${target.gy})，共 ${ROUNDS} 轮；BASE=${BASE}`);

let fails = 0;
// 账号只备一次（注册限流 5/s），多轮复用同一批 Agent 通道
const stamp = Date.now().toString(36).slice(-4);
const prepared = [];
for (let i = 0; i < PLAYERS; i++) {
  const a = await makeAccount(i, stamp);
  if (a) prepared.push(a);
  else console.warn(`[stress-claims] 第 ${i + 1} 个账号备号失败（限流或人数上限），继续`);
}
const live = prepared;
console.log(`[stress-claims] 备号完成：${live.length}/${PLAYERS} 个可用 Agent 通道`);
if (live.length < 2) { console.error('[stress-claims] 可用通道不足 2，压测无法进行'); process.exit(1); }

for (let round = 1; round <= ROUNDS; round++) {
  // 每轮换一块地：上一轮的胜者仍持有旧资源时，本轮仍是一场干净的竞争
  const cell = { ...target, gx: target.gx + round, gy: target.gy + round, px: target.px + round * 100, py: target.py + round * 100 };

  // 全部 agent 通道并发发同一条抢占指令：先到先得，期望只有 1 个 ok
  const results = await Promise.all(live.map(a => new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}/agent?token=${encodeURIComponent(a.agentToken)}`);
    const done = (v) => { try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const timer = setTimeout(() => done({ ok: false, timeout: true }), 15000);
    ws.on('error', () => { clearTimeout(timer); done({ ok: false, err: true }); });
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'join', uid: a.username, nick: a.username }));
      setTimeout(() => ws.send(JSON.stringify({ t: 'act', action: 'claim', kind: cell.kind, x: cell.px, y: cell.py })), 300);
    });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'result' && m.action === 'claim') { clearTimeout(timer); done(m); }
    });
  })));

  const okList = results.filter(r => r && r.ok);
  const dup = okList.length > 1;
  if (dup) fails++;
  console.log(`${dup ? 'FAIL' : 'PASS'} 第 ${round} 轮：${live.length} 并发 -> 成功 ${okList.length} 个`
    + `${dup ? '（>1 即原子性破坏！）' : '（先到先得成立）'}`
    + `；样例失败原因：${results.find(r => r && !r.ok)?.msg || results.find(r => r && !r.ok)?.raw || '-'}`);
}

console.log(`[stress-claims] ${fails ? `${fails} 轮出现重复持有 -> 抢占原子性未成立` : '全部轮次先到先得成立'}`);
process.exit(fails ? 1 : 0);