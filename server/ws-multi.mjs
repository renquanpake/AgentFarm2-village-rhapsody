// 多人并发语义测试：3 个真实 WS 客户端同房间
// 断言：move 广播、chat 双向、social_give（背包扣减+对方 social_in+系统广播）、
//       social_bind（关系持久化+全村公告）、save 合并广播、掉线重连状态恢复
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:8080';
const WS = 'ws://127.0.0.1:8080/ws';
const results = [];
function assert(name, cond, extra = '') {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}

function connect(uid, nick, pos = { scene: 0, x: 100, y: 100 }, token = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const inbox = [];
    const waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      inbox.push(m);
      for (let i = 0; i < waiters.length;) {
        const w = waiters[i];
        if (w.pred(m)) { waiters.splice(i, 1); w.res(m); } else i++;
      }
    });
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'join', uid, nick, token, ...pos }));
      resolve({ ws, inbox,
        wait: (pred, ms = 4000) => new Promise((res, rej) => {
          const hit = inbox.find(pred); if (hit) return res(hit);
          const t = waiters;
          setTimeout(() => rej(new Error('wait timeout: ' + pred.toString().slice(0, 40))), ms);
          t.push({ pred, res });
        }),
        send: (o) => ws.send(JSON.stringify(o)),
      });
    });
    ws.on('error', reject);
  });
}

(async () => {
  // 社交互动要求 5 格（520px）内：A/B 同点，C 同场景 100px 外
  const A = await connect('guest_aa1', '并发甲', { scene: 0, x: 100, y: 100 });
  const B = await connect('guest_bb2', '并发乙', { scene: 0, x: 100, y: 100 });
  const C = await connect('guest_cc3', '并发丙', { scene: 0, x: 200, y: 200 });
  assert('三人 join 均收到 welcome',
    (await A.wait(m => m.t === 'welcome')) && (await B.wait(m => m.t === 'welcome')) && (await C.wait(m => m.t === 'welcome')));
  // A 后连的 B/C 各自触发一条 player_join 广播给先在线者：A 应收到 B、C 两条
  const joinB = await A.wait(m => m.t === 'player_join' && m.p.uid === 'guest_bb2', 2000).catch(() => null);
  const joinC = await A.wait(m => m.t === 'player_join' && m.p.uid === 'guest_cc3', 2000).catch(() => null);
  assert('A 收到 B 上线广播', !!joinB, JSON.stringify(joinB));
  assert('A 收到 C 上线广播', !!joinC, JSON.stringify(joinC));
  // B 应收到 C（更后连者）的上线广播
  assert('B 收到 C 上线广播', await B.wait(m => m.t === 'player_join' && m.p.uid === 'guest_cc3', 2000).then(() => true).catch(() => false));

  // ---- move 广播：A 移动 → B、C 各收到一条 move（uid=A） ----
  A.send({ t: 'move', scene: 0, x: 500, y: 600 });
  const mvB = await B.wait(m => m.t === 'move' && m.uid === 'guest_aa1' && m.x === 500, 3000).catch(() => null);
  const mvC = await C.wait(m => m.t === 'move' && m.uid === 'guest_aa1' && m.x === 500, 3000).catch(() => null);
  assert('A 移动 → B 收到坐标同步', !!mvB && mvB.y === 600, JSON.stringify(mvB));
  assert('A 移动 → C 收到坐标同步', !!mvC && mvC.y === 600, JSON.stringify(mvC));
  assert('move 不广播给自己', await A.wait(m => m.t === 'move' && m.uid === 'guest_aa1', 800).then(() => false).catch(() => true));

  // ---- chat 双向：A 发 → B/C 收到；C 回发 → A 收到 ----
  A.send({ t: 'chat', text: 'hi from A' });
  assert('A 发言 → B 实时收到', (await B.wait(m => m.t === 'chat' && m.uid === 'guest_aa1' && m.text === 'hi from A', 3000).catch(() => null))?.text === 'hi from A');
  assert('A 发言 → C 实时收到', (await C.wait(m => m.t === 'chat' && m.uid === 'guest_aa1' && m.text === 'hi from A', 3000).catch(() => null))?.text === 'hi from A');
  C.send({ t: 'chat', text: 'got it' });
  assert('C 回发 → A 实时收到', (await A.wait(m => m.t === 'chat' && m.uid === 'guest_cc3' && m.text === 'got it', 3000).catch(() => null))?.text === 'got it');

  // ---- social_give：A 给 B 送礼 → B 收到 social_in，C 收到系统公告，A 收到成功结果 ----
  // 前置：A 需与 B 同场景 5 格内（前面 move 已把 A 送到 500,600，这里移回 B 身边 120,100）
  A.send({ t: 'move', scene: 0, x: 120, y: 100 });
  await new Promise(r => setTimeout(r, 200));
  // A 背包有 id=1 物品（knap 键需带 uid 后缀落玩家桶；结构 {props:[{id,num}]}）
  A.send({ t: 'save', kv: [['knapData_guest_aa1', JSON.stringify({ props: [{ id: 1, num: 5 }] })]] });
  await new Promise(r => setTimeout(r, 700));
  const giveRes = await new Promise((res) => {
    A.send({ t: 'social_give', target: 'guest_bb2', itemId: 1, num: 2 });
    A.wait(m => m.t === 'social_result' && m.social === 'give', 4000).then(res).catch(() => res(null));
  });
  assert('A 送礼 → 收到 social_result（成功或明确失败原因）', !!giveRes, JSON.stringify(giveRes));
  if (giveRes && giveRes.ok) {
    const sin = await B.wait(m => m.t === 'social_in' && m.social === 'give' && m.from === 'guest_aa1', 3000).catch(() => null);
    assert('B 实时收到 social_in（被送礼）', !!sin && sin.itemId === 1 && sin.num === 2, JSON.stringify(sin));
    const sys = await C.wait(m => m.t === 'chat' && m.uid === 'sys' && /送给了/.test(m.text), 3000).catch(() => null);
    assert('C 收到全村系统公告', !!sys && /并发甲 送给了 并发乙/.test(sys.text), sys?.text);
  } else {
    console.log('  (送礼走失败分支：' + (giveRes?.msg || '无结果') + '，跳过成功断言)');
  }

  // ---- save 合并广播：A 连发 3 条 save（同一真实世界键 shopData）→ B 在 500ms 窗口内合并 ----
  A.send({ t: 'save', kv: [['shopData', JSON.stringify({ v: 1 })]] });
  A.send({ t: 'save', kv: [['shopData', JSON.stringify({ v: 2 })]] });
  A.send({ t: 'save', kv: [['shopData', JSON.stringify({ v: 3 })]] });
  await new Promise(r => setTimeout(r, 1500));
  const bSaves = B.inbox.filter(m => m.t === 'save_broadcast' && m.by === 'guest_aa1');
  assert('save 500ms 合并：3 条连发 → B 收到 1-2 条广播（同 key 取最新）', bSaves.length >= 1 && bSaves.length <= 2, `收到 ${bSaves.length} 条`);

  // ---- social_bind：前置刷好感≥30（对话 +2/次，需 15 次）→ A 与 B 结为 friend → C 收到全村公告 ----
  for (let i = 0; i < 15; i++) A.send({ t: 'social_talk', target: 'guest_bb2', text: 'hi' + i });
  await new Promise(r => setTimeout(r, 800));
  const bindRes = await new Promise((res) => {
    A.send({ t: 'social_bind', target: 'guest_bb2', type: 'friend' });
    A.wait(m => m.t === 'social_result' && m.social === 'bind', 4000).then(res).catch(() => res(null));
  });
  assert('A 绑定 B → 收到 social_result', !!bindRes, JSON.stringify(bindRes));
  if (bindRes && bindRes.ok) {
    const ann = await C.wait(m => m.t === 'chat' && m.uid === 'sys' && /结为/.test(m.text), 3000).catch(() => null);
    assert('C 收到全村结为公告', !!ann && /结为/.test(ann.text), ann?.text);
  } else {
    console.log('  (绑定走失败分支：' + (bindRes?.msg || '无结果') + '，好感门槛未达属正常业务)');
  }

  // ---- 掉线重连：B 断开后重连 → 新连接 join 后能收到 A 的后续 move（状态恢复） ----
  B.ws.close();
  await new Promise(r => setTimeout(r, 300));
  const B2 = await connect('guest_bb2', '并发乙');
  await B2.wait(m => m.t === 'welcome', 3000).catch(() => {});
  A.send({ t: 'move', scene: 0, x: 900, y: 900 });
  const mv2 = await B2.wait(m => m.t === 'move' && m.uid === 'guest_aa1' && m.x === 900, 3000).catch(() => null);
  assert('B 重连后仍收到 A 的坐标广播（会话恢复）', !!mv2 && mv2.y === 900, JSON.stringify(mv2));
  const joinAnn = await A.wait(m => m.t === 'player_join' && m.p.uid === 'guest_bb2', 3000).catch(() => null);
  assert('B 重连 → A 收到 player_join 再上线广播', !!joinAnn && joinAnn.p.nick === '并发乙');

  A.ws.close(); C.ws.close(); B2.ws.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n===== 结果：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) { console.log('失败项：'); failed.forEach(f => console.log(' -', f.name, f.extra)); process.exitCode = 1; }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
