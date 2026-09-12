// 顶号（单点登录）语义：同一 uid 二次 join，旧连接收 kicked 并被 terminate，新连接接管
import WebSocket from 'ws';
const WS = 'ws://127.0.0.1:8080/ws';
const results = [];
const check = (n, c, x = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} - ${n}${x ? ' | ' + x : ''}`); };
const open = () => new Promise((res, rej) => { const s = new WebSocket(WS); s.once('open', () => res(s)); s.once('error', rej); });
const next = (ws, pred, ms = 4000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), ms);
  const on = (raw) => { let m; try { m = JSON.parse(String(raw)); } catch { return; } if (pred(m)) { clearTimeout(t); ws.off('message', on); resolve(m); } };
  ws.on('message', on);
});
const send = (ws, o) => ws.send(JSON.stringify(o));

const c1 = await open();
send(c1, { t: 'join', uid: 'guest_dup', nick: '重复者', x: 0, y: 0 });
await next(c1, m => m.t === 'welcome');
check('首次 join 成功', true);

// 第二个连接同 uid 上线：c2 先拿 welcome，c1 收 kicked
const c2 = await open();
const w2P = next(c2, m => m.t === 'welcome', 5000);
const kickedP = next(c1, m => m.t === 'kicked', 5000);
send(c2, { t: 'join', uid: 'guest_dup', nick: '重复者', x: 0, y: 0 });
const w2 = await w2P;
check('新连接 welcome 正常', !!w2);
const kicked = await kickedP.catch(() => null);
check('旧连接收到 kicked 提示', !!kicked, JSON.stringify(kicked));
check('kicked 文案正确', !!kicked && /别处上线/.test(kicked.msg));

// 旧连接应在 ~200ms 后被关闭
const closed = await new Promise((res) => { const t = setTimeout(() => res(false), 4000); c1.once('close', () => { clearTimeout(t); res(true); }); });
check('旧连接被服务器关闭', closed);

// 在线列表 uid 唯一
const pl = await (await fetch('http://127.0.0.1:8080/af/players')).json();
const dups = pl.filter(p => p.uid === 'guest_dup');
check('在线列表 uid 唯一（无残留旧连接）', dups.length === 1, `匹配 ${dups.length} 条`);

c2.close();
const fails = results.filter(r => !r).length;
console.log(fails ? `结果: ${results.length - fails}/${results.length}` : `结果: 全部 ${results.length} 项通过`);
process.exit(fails ? 1 : 0);
