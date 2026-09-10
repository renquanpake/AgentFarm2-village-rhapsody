// 补充对抗测试（基于 afserver.mjs 源码审查的定向用例）
// 用法: node server/ws-attack2.mjs [BASE]   BASE 默认 http://127.0.0.1:8080
import WebSocket from 'ws';
const BASE = process.argv[2] || 'http://127.0.0.1:8080';
const WS_BASE = BASE.replace(/^http/, 'ws');
const results = [];
const record = (n, v, d) => { results.push({ n, v, d }); console.log(`[${v === 'RISK' ? '!!漏洞' : v === 'OK' ? '安全' : '观察'}] ${n} :: ${d}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function mkWS() { return new Promise((res, rej) => { const ws = new WebSocket(WS_BASE + '/ws'); ws._msgs = []; ws.on('open', () => res(ws)); ws.on('error', rej); ws.on('message', (d) => { try { ws._msgs.push(JSON.parse(d.toString())); } catch {} }); }); }
const join = (ws, uid, nick) => ws.send(JSON.stringify({ t: 'join', uid, nick }));
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

// 1) save 洪泛 DoS：300 save/s，每条触发一次全量同步 persist，观测受害者 WS ping/pong 延迟
{
  const victim = await mkWS(); join(victim, 'u2_dos_v', '受害者'); await sleep(400);
  let pongCb = null;
  victim.on('pong', () => { const cb = pongCb; pongCb = null; if (cb) cb(); });
  const pingOnce = () => new Promise((res) => { const t0 = Date.now(); pongCb = () => res(Date.now() - t0); victim.ping(); setTimeout(() => { if (pongCb) { pongCb = null; res(-1); } }, 3000); });
  const baseline = [];
  for (let i = 0; i < 10; i++) { const l = await pingOnce(); if (l >= 0) baseline.push(l); }
  const atk = await mkWS(); join(atk, 'u2_dos_a', '洪泛'); await sleep(300);
  const loadPings = [];
  const pingTask = (async () => { for (let i = 0; i < 25; i++) { const l = await pingOnce(); if (l >= 0) loadPings.push(l); await sleep(30); } })();
  for (let i = 0; i < 300; i++) atk.send(JSON.stringify({ t: 'save', kv: [['flood_probe_' + i, i]] }));
  await pingTask;
  const bP95 = pct(baseline, 0.95), lP95 = pct(loadPings, 0.95);
  const alive = (await fetch(BASE + '/af/room')).ok;
  record('save洪泛DoS', (lP95 > 1000 || lP95 > bP95 * 10 + 50) ? 'RISK' : 'OK', `300 save/s: 基线P95=${bP95}ms, 洪泛中P95=${lP95}ms, 服务器存活=${alive}`);
  atk.close(); victim.close();
}

// 2) save 广播放大：3 在线，1 个发 100 条 save，另外 2 个各收多少广播
{
  const p1 = await mkWS(), p2 = await mkWS(), p3 = await mkWS();
  join(p1, 'u2_amp_s', '发送方'); join(p2, 'u2_amp_v1', '观1'); join(p3, 'u2_amp_v2', '观2');
  await sleep(400); p2._msgs = []; p3._msgs = [];
  for (let i = 0; i < 100; i++) p1.send(JSON.stringify({ t: 'save', kv: [['amp_' + i, i]] }));
  await sleep(1500);
  const n1 = p2._msgs.filter(m => m.t === 'save_broadcast').length;
  const n2 = p3._msgs.filter(m => m.t === 'save_broadcast').length;
  record('save广播放大', (n1 + n2) > 300 ? 'RISK' : '观察', `100 save → 观察者A收${n1}/B收${n2}条广播(放大×2), 未限流会随在线人数线性放大`);
  p1.close(); p2.close(); p3.close();
}

// 3) 畸形消息鲁棒性：非JSON/纯数字/null/数组/缺字段，确认服务器不崩
{
  const v = await mkWS(); join(v, 'u2_mal_v', '受害者'); await sleep(300); v._msgs = [];
  const m = await mkWS(); join(m, 'u2_mal', '畸形'); await sleep(200);
  m.send('{bad json'); m.send('12345'); m.send('null'); m.send('[1,2,3]'); m.send('"str"');
  m.send(JSON.stringify({ t: 'chat' })); m.send(JSON.stringify({ t: 'move', x: null, y: null, scene: null }));
  m.send(JSON.stringify({ t: 'save', kv: 'notarray' })); m.send(JSON.stringify({ t: 'save', kv: [['k', 1], 2, 'x'] }));
  await sleep(800);
  const srv = (await fetch(BASE + '/af/room')).ok;
  const leaked = v._msgs.filter(m => (m.t === 'chat' && !m.nick) || (m.t === 'move' && m.uid === undefined));
  record('畸形消息鲁棒', (!srv || leaked.length) ? 'RISK' : 'OK', `9类畸形消息后 服务器存活=${srv}, 受害者收到垃圾转发=${leaked.length}`);
  m.close(); v.close();
}

// 4) 聊天 HTML 载荷透传（是否 XSS 取决于客户端渲染是否转义）
{
  const v = await mkWS(), x = await mkWS();
  join(v, 'u2_x_v', '受害者'); join(x, 'u2_x', '注入'); await sleep(300); v._msgs = [];
  x.send(JSON.stringify({ t: 'chat', text: '<img src=x onerror=alert(1)><b>bold</b>你好' }));
  x.send(JSON.stringify({ t: 'join', uid: 'u2_x', nick: '<script>x</script>' }));
  await sleep(500);
  const c = v._msgs.find(m => m.t === 'chat' && m.text && m.text.includes('<img'));
  record('聊天HTML透传', c ? '观察' : 'OK', c ? `服务端原样透传HTML载荷="${c.text.slice(0, 30)}…" (客户端需HTML转义渲染才安全)` : '未透传HTML');
  x.close(); v.close();
}

// 5) register 洪泛：无速率限制，每个注册 ensurePlayerData + 落盘
{
  const t0 = Date.now();
  const base = Date.now() % 10000;
  const jobs = [];
  for (let i = 0; i < 50; i++) jobs.push(fetch(BASE + '/af/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `flk${base}_${i}`, password: 'pw123456' }) }).then(r => r.status));
  const stats = await Promise.all(jobs);
  const okn = stats.filter(s => s === 200).length;
  const blocked = stats.filter(s => s === 429).length;
  record('register洪泛', blocked > 0 ? 'OK' : '观察', `50注册/批: 成功${okn}, 限流拦截${blocked}, 耗时${Date.now() - t0}ms (无速率限制, 每账号分配主角档+落盘)`);
}

// 6) 单连接全类型消息炸弹：并发刷 join/save/move/chat/social 混合洪泛
{
  const v = await mkWS(), h = await mkWS();
  join(v, 'u2_mix_v', '受害者'); await sleep(200);
  h.send(JSON.stringify({ t: 'join', uid: 'u2_mix', nick: '混合洪泛' }));
  await sleep(200);
  const start = Date.now();
  for (let i = 0; i < 500; i++) {
    if (i % 5 === 0) h.send(JSON.stringify({ t: 'save', kv: [['mx' + i, i]] }));
    else if (i % 5 === 1) h.send(JSON.stringify({ t: 'move', scene: 0, x: i, y: i }));
    else if (i % 5 === 2) h.send(JSON.stringify({ t: 'chat', text: 'f' + i }));
    else if (i % 5 === 3) h.send(JSON.stringify({ t: 'social_talk', target: 'u2_mix_v', text: 't' }));
    else h.send(JSON.stringify({ t: 'task_list' }));
  }
  await sleep(1200);
  const alive = (await fetch(BASE + '/af/room')).ok;
  record('混合洪泛', alive ? 'OK' : 'RISK', `500混合消息/批 服务器存活=${alive} (各类型独立节流, 观察是否卡顿)`);
  v.close(); h.close();
}

await sleep(300);
console.log('\n===== 补充对抗测试汇总 =====');
const risk = results.filter(r => r.v === 'RISK').length;
const obs = results.filter(r => r.v === '观察').length;
console.log(`漏洞: ${risk}/${results.length}, 观察: ${obs}`);
process.exit(risk ? 1 : 0);
