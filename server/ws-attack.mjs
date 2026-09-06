// 对抗式检测：以恶意/异常客户端视角攻击游戏服务器
// 用法: node ws-attack.mjs [BASE]   BASE 默认 http://127.0.0.1:8080
const BASE = process.argv[2] || 'http://127.0.0.1:8080';
const WS_BASE = BASE.replace(/^http/, 'ws');
let WebSocket;
try { WebSocket = (await import('ws')).default; } catch { WebSocket = globalThis.WebSocket; }

const results = [];
function record(name, verdict, detail) {
  results.push({ name, verdict, detail });
  console.log(`[${verdict === 'RISK' ? '!!漏洞' : verdict === 'OK' ? '安全' : '观察'}] ${name} :: ${detail}`);
}

function mkWS() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_BASE + '/ws');
    ws.messages = [];
    ws.on('message', (d) => { try { ws.messages.push(JSON.parse(d.toString())); } catch {} });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const join = (ws, uid, nick) => ws.send(JSON.stringify({ t: 'join', uid, nick }));
const lastOf = (ws, t) => [...ws.messages].reverse().find(m => m.t === t);

// ---------- 用例 1: 伪造他人注册账号 uid ----------
{
  const reg = await (await fetch(BASE + '/af/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'victim_' + Date.now() % 100000, password: 'pw123456' }) })).json();
  const victimUid = reg.uid, victimToken = reg.token;
  const attacker = await mkWS();
  join(attacker, victimUid, '冒名顶替者');
  await wait(500);
  const w = lastOf(attacker, 'welcome');
  const denied = lastOf(attacker, 'join_deny');
  if (w && w.uid === victimUid) {
    // 写脏数据进受害者档
    attacker.send(JSON.stringify({ t: 'save', kv: [['hacked_marker', '"由冒名者写入"']] }));
    await wait(500);
    const victimSave = await (await fetch(`${BASE}/af/save?uid=${victimUid}&token=${victimToken}`)).text();
    const hacked = victimSave.includes('hacked_marker');
    record('伪造uid接管', hacked ? 'RISK' : 'RISK', hacked ? `冒名上线且写入其存档 (uid=${victimUid})` : `冒名上线成功（可冒名聊天/移动, uid=${victimUid}）`);
  } else if (denied) record('伪造uid接管', 'OK', `服务器拒绝冒名 join: ${denied.msg}`);
  else record('伪造uid接管', 'OK', 'welcome 未回传伪造 uid');
  attacker.close();
}

// ---------- 用例 2: 同 uid 双开 ----------
{
  const a = await mkWS(), b = await mkWS();
  join(a, 'u_dup_test', '旧连接');
  await wait(300);
  join(b, 'u_dup_test', '新连接');
  await wait(400);
  const kicked = lastOf(a, 'kicked'); // 踢出通知在新连接 join 时即送达旧连接
  // 旧连接再发消息，看是否仍以该身份生效
  a.messages = [];
  a.send(JSON.stringify({ t: 'chat', text: '旧连接还想说话' }));
  await wait(400);
  const online = await (await fetch(BASE + '/af/players')).json();
  const dup = online.filter(p => p.uid === 'u_dup_test');
  const oldStillWorked = b.messages.some(m => m.t === 'chat' && m.text === '旧连接还想说话' && m.uid === 'u_dup_test');
  const dead = a.readyState >= 2; // CLOSING/CLOSED
  record('同uid双开', oldStillWorked ? 'RISK' : 'OK', `旧连接消息生效=${oldStillWorked}, 旧连接收到踢出通知=${!!kicked}, 旧连接已断=${dead}, 在线重复=${dup.length} 次`);
  a.close(); b.close();
}

// ---------- 用例 3: 超长昵称 ----------
{
  const victim = await mkWS(), evil = await mkWS();
  join(victim, 'u_nick_victim', '受害者');
  await wait(300);
  join(evil, 'u_nick_evil', 'X'.repeat(10000));
  await wait(500);
  const pj = lastOf(victim, 'player_join');
  const nickLen = pj && pj.p ? pj.p.nick.length : 0;
  record('超长昵称广播', nickLen > 100 ? 'RISK' : 'OK', `其他玩家收到的昵称长度=${nickLen}`);
  victim.close(); evil.close();
}

// ---------- 用例 4: 聊天洪泛（无频率限制?） ----------
{
  const flooder = await mkWS(), victim = await mkWS();
  join(flooder, 'u_flood', '刷屏机');
  join(victim, 'u_flood_victim', '路人');
  await wait(400);
  victim.messages = [];
  for (let i = 0; i < 50; i++) flooder.send(JSON.stringify({ t: 'chat', text: '刷屏' + i }));
  await wait(1500);
  const got = victim.messages.filter(m => m.t === 'chat' && m.uid === 'u_flood').length;
  record('聊天洪泛', got >= 40 ? 'RISK' : 'OK', `1 秒发 50 条, 路人实际收到 ${got} 条`);
  flooder.close(); victim.close();
}

// ---------- 用例 5: 超大存档写入（磁盘/广播放大） ----------
{
  const evil = await mkWS(), victim = await mkWS();
  join(evil, 'u_big', '大文件写入者');
  join(victim, 'u_big_victim', '路人');
  await wait(400);
  victim.messages = [];
  evil.send(JSON.stringify({ t: 'save', kv: [['test_blob_3mb', 'A'.repeat(3 * 1024 * 1024)]] }));
  await wait(3000);
  const bc = victim.messages.find(m => m.t === 'save_broadcast');
  const bcSize = bc ? JSON.stringify(bc).length : 0;
  record('超大存档写入', bcSize > 1024 * 1024 ? 'RISK' : 'OK', `3MB 存档被接受并广播给所有在线玩家, 广播体积=${(bcSize / 1024).toFixed(0)}KB`);
  evil.close(); victim.close();
}

// ---------- 用例 6: move 洪泛 + 异常坐标 ----------
{
  const mover = await mkWS(), victim = await mkWS();
  join(mover, 'u_move', '瞬移怪');
  join(victim, 'u_move_victim', '路人');
  await wait(400);
  victim.messages = [];
  for (let i = 0; i < 100; i++) {
    const x = i % 3 === 0 ? 1e15 : (i % 3 === 1 ? -99999 : 0.123456789);
    mover.send(JSON.stringify({ t: 'move', scene: 0, x, y: 1e15 }));
  }
  await wait(1500);
  const moves = victim.messages.filter(m => m.t === 'move' && m.uid === 'u_move');
  // 服务器拒绝的异常坐标：非有限数 / 超出 ±1e6；-99999 与小数在合法范围内（Cocos 像素坐标可为小数）
  const weird = moves.filter(m => !Number.isFinite(m.x) || Math.abs(m.x) > 1e6).length;
  record('move洪泛+异常坐标', moves.length > 20 || weird > 0 ? 'RISK' : 'OK', `1 秒 100 条, 路人收到 ${moves.length} 条 (节流), 超限坐标 ${weird} 条`);
  mover.close(); victim.close();
}

// ---------- 用例 7: 未 join 直接操作 ----------
{
  const ghost = await mkWS(), victim = await mkWS();
  join(victim, 'u_ghost_victim', '路人');
  await wait(400);
  victim.messages = [];
  ghost.send(JSON.stringify({ t: 'chat', text: '幽灵消息' }));
  ghost.send(JSON.stringify({ t: 'move', scene: 0, x: 5, y: 5 }));
  await wait(600);
  const leaked = victim.messages.filter(m => (m.t === 'chat' && m.text === '幽灵消息') || (m.t === 'move' && m.uid === null));
  record('未join直接操作', leaked.length ? 'RISK' : 'OK', `未 join 的连接消息被转发 ${leaked.length} 条`);
  ghost.close(); victim.close();
}

// ---------- 用例 8: 单条消息内存炸弹 ----------
{
  const evil = await mkWS();
  join(evil, 'u_bomb', '炸弹');
  await wait(300);
  let alive = true;
  evil.on('close', () => { alive = false; });
  evil.send('B'.repeat(9 * 1024 * 1024)); // 9MB 非 JSON 文本（超过 maxPayload=8MB 上限）
  await wait(1500);
  const health = await (await fetch(BASE + '/af/room')).json();
  record('8MB消息炸弹', alive ? 'RISK' : (health.ok ? 'OK' : '观察'), alive ? `9MB 消息被接受 (maxPayload 未生效)` : `超大消息连接被断开, 服务器仍正常响应=${!!health.ok}`);
  evil.close();
}

await wait(500);
console.log('\n===== 对抗测试汇总 =====');
const risk = results.filter(r => r.verdict === 'RISK').length;
console.log(`发现漏洞: ${risk}/${results.length}`);
