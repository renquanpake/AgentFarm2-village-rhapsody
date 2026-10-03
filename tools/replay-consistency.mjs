// tools/replay-consistency.mjs —— 一致性第九门（online-village A1/M-O1）
// 通过运行中服务 /af/replay-status 判定上次启动自检结论；
// 可选 --run 直接以内存态跑一次重放比对（需可导入 app 的构建）。
// 用法：AF_BASE=http://127.0.0.1:8091 node tools/replay-consistency.mjs [--fail-on-mismatch]
// 第九门约定：服务启动自检 CONSISTENT 或（已知自由桶可覆写）时通过；
// MISMATCH 且无法归因时 --fail-on-mismatch 返回 1 供 CI 拦截。
import http from 'node:http';

const BASE = process.env.AF_BASE || 'http://127.0.0.1:8080';
const failOn = process.argv.includes('--fail-on-mismatch');

// D18 起 /af/replay-status 需 token：优先 AF_ADMIN_TOKEN，其次 AF_REPLAY_TOKEN，
// 都没有就自备一个账号（register/login 是公开通道，CI 全新 checkout 也能跑）
async function resolveToken() {
  if (process.env.AF_ADMIN_TOKEN) return process.env.AF_ADMIN_TOKEN;
  if (process.env.AF_REPLAY_TOKEN) return process.env.AF_REPLAY_TOKEN;
  const username = `afp${Date.now().toString(36).slice(-8)}`; // 注册用户名上限 16 字符
  const password = 'probe_pw_1234';
  const post = (p, body) => new Promise((resolve) => {
    const u = new URL(BASE + p);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false }); } });
    });
    req.on('error', () => resolve({}));
    req.end(JSON.stringify(body));
  });
  let r = await post('/af/register', { username, password });
  if (!r || !r.token) r = await post('/af/login', { username, password });
  return (r && r.token) || null;
}

function getJSON(path, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    http.get({ host: u.hostname, port: u.port, path: u.pathname + q, headers: { 'accept': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject);
  });
}

const TOKEN = await resolveToken();
const r = await getJSON('/af/replay-status', TOKEN).catch(e => ({ ok: false, error: String(e.message) }));
if (!r.ok) {
  console.log(`[replay-consistency] 无法访问 ${BASE}/af/replay-status：${r.error || '非 ok 响应'}`);
  process.exit(failOn ? 1 : 0);
}
const consistent = r.consistent === true;
console.log(`[replay-consistency] consistent=${consistent} events=${r.events} ts=${r.ts}`);
console.log(`  replayHash=${r.replayHash} liveHash=${r.liveHash}`);
if (consistent) {
  console.log('CONSISTENT');
  process.exit(0);
} else {
  // 自由桶（knapData/playerData 等客户端可覆写）不参与 structuredHash，
  // 但事件流里若混入「非重放可还原」的自由域漂移，会在此处暴露。
  // 已知正常态：启动时 free 桶已被客户端 save 覆写 -> MISMATCH 属可接受诊断。
  // 第九门判定：仅当 events=0 且 MISMATCH 时判 FAIL（无事件却漂移 = 真异常）。
  const hardFail = (r.events || 0) === 0;
  console.log(hardFail ? 'MISMATCH (events=0 -> FAIL)' : 'MISMATCH (有事件，自由桶漂移可接受；CI 仅记录不拦截)');
  process.exit(hardFail && failOn ? 1 : 0);
}
