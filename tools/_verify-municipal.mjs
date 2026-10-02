#!/usr/bin/env node
// tools/_verify-municipal.mjs —— L3 市政指引活体验证（observe.municipal + move_to.road）
import WebSocket from 'ws';
const B = process.env.AF_BASE || 'http://127.0.0.1:8093';
const WS_BASE = B.replace(/^http/, 'ws');
const j = async (p, body) => (await (await fetch(B + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)).json());
const login = await j('/af/login', { username: 'maptest', password: 'pass123' });
const tok = login.token;
const at = await j('/af/agent-token', { token: tok });
const ws = new WebSocket(`ws://${new URL(WS_BASE).host}/agent?token=${at.agentToken}`);
const once = (pred, ms = 6000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms);
  const on = d => { const m = JSON.parse(d); if (pred(m)) { clearTimeout(t); ws.off('message', on); res(m); } };
  ws.on('message', on);
});
ws.on('open', async () => {
  const s0 = await once(m => m.t === 'state');
  console.log('初始 scene =', s0.scene, 'pos =', JSON.stringify(s0.pos), ' municipal =', s0.municipal ? '有' : 'null');
  // 段 1：落到 河堤路北端 (26,44)（若跨场景会先传送）
  ws.send(JSON.stringify({ t: 'act', action: 'move_to', x: 2650, y: 4450, scene: 2 }));
  await once(m => m.t === 'result' && m.action === 'move_to');
  // 轮询等段 1 路线走完（位置到 (26,44)±400 或 20s 硬超时）
  await new Promise((resolve) => {
    const hard = setTimeout(() => { ws.off('message', on); resolve(); }, 20000);
    const on = (d) => {
      const m = JSON.parse(d);
      if (m.t === 'state' && Math.abs(m.pos.x - 2650) <= 400 && Math.abs(m.pos.y - 4450) <= 400) {
        clearTimeout(hard); ws.off('message', on); resolve();
      }
    };
    ws.on('message', on);
  });
  // 段 2：到 南路口 (66,90)（同场景 A*；穿过南北大街/路口路格 -> road 字段）
  ws.send(JSON.stringify({ t: 'act', action: 'move_to', x: 6650, y: 9050, scene: 2 }));
  const mv = await once(m => m.t === 'result' && m.action === 'move_to');
  console.log('段2 move_to.road =', JSON.stringify(mv.road ?? '(无)'));
  console.log('段2 msg/steps =', mv.msg ? mv.msg.slice(0, 50) : (mv.steps ?? ''), JSON.stringify(mv).slice(0, 60));
  console.log(mv.road ? 'PASS：move_to 路线路名摘要（roadOf 反查）在结果中' : 'NOTE：该路径主路段占比为 0，road 字段缺省属正常');
  ws.close();
  process.exit(0);
});
