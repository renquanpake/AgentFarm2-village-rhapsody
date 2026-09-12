// 重启后存档持久化恢复（黑盒硬证据）：
// 隔离 slot3 + 端口 8091。phase1 进程写入 farmData=restart:phase1 并落盘 → SIGTERM；
// phase2 新进程从 slot3 重新加载，读 world.json 断言值跨进程存活（未重置为 seed）。
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 8091, WS = `ws://127.0.0.1:${PORT}/ws`, BASE = `http://127.0.0.1:${PORT}`;
const SAVE_FILE = 'data/saves/slot3/world.json';
const KEY = 'farmData';
const results = [];
const check = (n, c, x = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} - ${n}${x ? ' | ' + x : ''}`); };

function startServer() {
  const p = spawn('node', ['server/afserver.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), AF_SLOT: '3', AF_TUNE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { const s = String(d); if (/就绪|地址|存档位/.test(s)) process.stdout.write('  [srv] ' + s.trim() + '\n'); });
  return p;
}
async function waitUp(ms = 8000) { for (let i = 0; i < ms / 200; i++) { try { const r = await fetch(BASE + '/'); if (r.status < 500) return true; } catch {} await sleep(200); } return false; }
const open = () => new Promise((res, rej) => { const s = new WebSocket(WS); s.once('open', () => res(s)); s.once('error', rej); });
const next = (ws, pred, ms = 5000) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), ms); const on = (raw) => { let m; try { m = JSON.parse(String(raw)); } catch { return; } if (pred(m)) { clearTimeout(t); ws.off('message', on); resolve(m); } }; ws.on('message', on); });
const send = (ws, o) => ws.send(JSON.stringify(o));

// ===== phase1：写入并落盘 =====
let srv = startServer();
if (!(await waitUp())) { console.error('phase1 服务未起'); process.exit(1); }
let a = await open();
send(a, { t: 'join', uid: 'guest_rs', nick: '重启者', x: 0, y: 0 });
await next(a, m => m.t === 'welcome');
send(a, { t: 'save', kv: [[KEY, JSON.stringify({ restart: 'phase1' })]] });
await sleep(900); // 等防抖 persist
a.close(); srv.kill('SIGTERM'); await sleep(600);

// 断言1：phase1 值已落盘
const f1 = (() => { try { return readFileSync(SAVE_FILE, 'utf8'); } catch { return null; } })();
check('phase1 写入已落盘 slot3/world.json', !!f1 && f1.includes('phase1'), f1 ? `命中 phase1` : '未命中');

// ===== phase2：新进程重新加载 =====
srv = startServer();
if (!(await waitUp())) { console.error('phase2 服务未起'); process.exit(1); }
a = await open();
send(a, { t: 'join', uid: 'guest_rs', nick: '重启者', x: 0, y: 0 });
const w = await next(a, m => m.t === 'welcome');
check('重启后 join 正常', !!w);
// 断言2：重启后磁盘上仍是 phase1（进程启动加载未把世界键重置回 seed）
const f2 = (() => { try { return readFileSync(SAVE_FILE, 'utf8'); } catch { return null; } })();
check('重启后世界键值跨进程存活（未被 seed 重置）', !!f2 && f2.includes('phase1'), f2 ? '仍含 phase1' : '丢失');
a.close(); srv.kill('SIGTERM'); await sleep(400);

const fails = results.filter(r => !r).length;
console.log(fails ? `结果: ${results.length - fails}/${results.length}` : `结果: 全部 ${results.length} 项通过`);
process.exit(fails ? 1 : 0);
