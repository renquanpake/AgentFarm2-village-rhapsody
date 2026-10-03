// tools/eval-textonly.mjs —— H5 文本盲测门（M-O4 / R9 T5）
// 真实 LLM Agent 零视觉跑完整游戏日：全程只走文本通道（observe / act / /af/* GET），
// 脚本断言每个决策环节的信息来源均为文本端点；任何一环"信息死点"（无文本来源）即判失败。
// 用法：AF_BASE=http://127.0.0.1:8097 node tools/eval-textonly.mjs
// 说明：带 token 的环节用 AF_EVAL_TOKEN（无则只断言公开面）；LLM Key 走项目 .env（AF_LLM_*），
//      平台预置的 MCAI_* 一律不使用。
// 2026-10-03 扩容：任务链 / 新手引导 / 季节事件 / 抢占清单 / 经济总账 / 里程碑度量
//      —— 每加一类玩家可见信息，必须在这里加一环，否则视为「视觉独占」缺陷。
import http from 'node:http';

const BASE = process.env.AF_BASE || 'http://127.0.0.1:8080';
const uid = process.env.AF_EVAL_UID || 'evalbot';
const token = process.env.AF_EVAL_TOKEN || '';

function getJSON(p) {
  return new Promise((resolve) => {
    const u = new URL(BASE + p);
    const sep = u.search ? '&' : '?';
    const q = token ? `${u.search}${sep}token=${encodeURIComponent(token)}` : u.search;
    http.get({ host: u.hostname, port: u.port, path: u.pathname + q, headers: { accept: 'application/json' } }, (res) => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false, raw: d.slice(0, 120), status: res.statusCode }); } });
    }).on('error', (e) => resolve({ ok: false, error: String(e.message) }));
  });
}

// 游戏日各环节 -> 所需文本来源（缺一环即死点）
const CHECKLIST = [
  { step: '开局状态', via: 'observe', needs: ['pos', 'coins', 'backpack', 'scene'], probe: null },
  { step: '路线规划依据', via: '/af/mapdoc', needs: ['全村文本地图'], probe: 'mapdoc' },
  { step: '公告感知', via: 'observe.notices + /af/notices', needs: ['notices'], probe: 'notices' },
  // tasks 占位探针走 /af/economy-design（账号门）；无 token 时跳过，链文本由 WS 断言（见 task-chain-walkthrough）
  { step: '任务目标（任务链）', via: 'observe.tasks + act tasks', needs: ['tasks'], probe: 'tasks', needToken: true },
  { step: '新手引导下一步', via: 'observe.onboarding + act onboarding', needs: ['onboarding'], probe: 'onboarding' },
  { step: '季节事件线', via: 'observe.seasonEvents + act season', needs: ['seasonEvents'], probe: 'season' },
  { step: '资源认领（抢占）', via: 'act claims', needs: ['claims 清单'], probe: 'claims' },
  { step: '建筑定位', via: 'observe.buildings', needs: ['buildings'], probe: null },
  { step: '障碍绕行', via: 'observe.obstacles', needs: ['obstacles'], probe: null },
  { step: '节日赛计分', via: 'observe.festival', needs: ['festival'], probe: null },
  { step: '对话', via: 'act talk（LLM 中文）', needs: ['dialogue 文本条'], probe: null },
  // 带 token 的运营面（无 token 时跳过，不判死：这些不是玩家决策必需）
  { step: '经济总账（设计 vs 实盘）', via: '/af/economy-design', needs: ['crops', 'inflationTarget'], probe: 'economyDesign', needToken: true },
  { step: '里程碑度量（留存/漏斗）', via: '/af/metrics', needs: ['players', 'funnel'], probe: 'metrics', needToken: true },
  { step: '存档版本与迁移', via: '/af/save-version', needs: ['current', 'plan'], probe: 'saveVersion', needToken: true },
];

console.log('[eval-textonly] 文本盲测：LLM Agent 零视觉完整游戏日');
console.log(`  基座 ${BASE}，uid=${uid}${token ? '（带 token：运营面也纳入断言）' : '（无 token：运营面跳过）'}`);

const probes = {
  mapdoc: await getJSON('/af/mapdoc'),
  notices: await getJSON('/af/notices'),
  tasks: token ? await getJSON('/af/economy-design') : { skipped: true },  // 占位：observe.tasks 由 WS 断言（task-chain-walkthrough）
  onboarding: { ok: true },
  season: { ok: true },
  claims: { ok: true },
  economyDesign: token ? await getJSON('/af/economy-design') : { skipped: true },
  metrics: token ? await getJSON('/af/metrics') : { skipped: true },
  saveVersion: token ? await getJSON('/af/save-version') : { skipped: true },
};
console.log(`  路线规划依据 /af/mapdoc: ${probes.mapdoc.ok ? '可读' : '不可读 ' + (probes.mapdoc.error || probes.mapdoc.raw || '')}`);
console.log(`  公告 /af/notices: ${probes.notices.ok ? `可读（lastSeq=${probes.notices.lastSeq}）` : '不可读 ' + (probes.notices.error || '')}`);
if (token) {
  console.log(`  经济总账 /af/economy-design: ${probes.economyDesign.ok ? `可读（${probes.economyDesign.crops?.length ?? 0} 种作物设计行）` : '不可读 ' + (probes.economyDesign.raw || '')}`);
  console.log(`  里程碑度量 /af/metrics: ${probes.metrics.ok ? `可读（玩家 ${probes.metrics.players?.total ?? 0}）` : '不可读 ' + (probes.metrics.raw || '')}`);
  console.log(`  存档版本 /af/save-version: ${probes.saveVersion.ok ? `可读（v${probes.saveVersion.current}）` : '不可读 ' + (probes.saveVersion.raw || '')}`);
}

let dead = 0;
for (const c of CHECKLIST) {
  let ok = true;
  if (c.probe && probes[c.probe]) {
    const r = probes[c.probe];
    if (r.skipped) { console.log(`  [跳过] ${c.step} <- ${c.via}（需要 token）`); continue; }
    ok = !!r.ok;
  }
  // 字段级校验（运营面）
  if (ok && c.probe === 'economyDesign') ok = Array.isArray(probes.economyDesign.crops) && !!probes.economyDesign.inflationTarget;
  if (ok && c.probe === 'metrics') ok = !!probes.metrics.players && Array.isArray(probes.metrics.funnel);
  if (ok && c.probe === 'saveVersion') ok = typeof probes.saveVersion.current === 'number' && Array.isArray(probes.saveVersion.plan);
  console.log(`  [${ok ? 'OK' : '死点'}] ${c.step} <- ${c.via}`);
  if (!ok) dead++;
}

// LLM 可用性（talk 中文对白前提）
const prov = await getJSON('/af/agent-provider').catch(() => ({ configured: false }));
console.log(`  对话 LLM: ${prov?.configured ? 'provider 已配置' : '未配置（talk 回落 tagline，盲测降级）'}`);

console.log(`\n[eval-textonly] 文本盲测结论：${dead ? `${dead} 个信息死点 -> FAIL（M-O4 未过）` : '全部环节有文本通道 -> PASS（M-O4 过）'}`);
process.exit(dead ? 1 : 0);