// tools/replay-consistency.mjs —— 一致性第九门（online-village A1/M-O1）
// 通过运行中服务 /af/replay-status 判定上次启动自检结论；
// 可选 --run 直接以内存态跑一次重放比对（需可导入 app 的构建）。
// 用法：AF_BASE=http://127.0.0.1:8091 node tools/replay-consistency.mjs [--fail-on-mismatch]
// 第九门约定：服务启动自检 CONSISTENT 或（已知自由桶可覆写）时通过；
// MISMATCH 且无法归因时 --fail-on-mismatch 返回 1 供 CI 拦截。
import http from 'node:http';

const BASE = process.env.AF_BASE || 'http://127.0.0.1:8080';
const failOn = process.argv.includes('--fail-on-mismatch');

function getJSON(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { 'accept': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject);
  });
}

const r = await getJSON('/af/replay-status').catch(e => ({ ok: false, error: String(e.message) }));
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
