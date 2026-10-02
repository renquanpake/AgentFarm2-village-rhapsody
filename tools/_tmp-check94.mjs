import WebSocket from 'ws';
const AT = process.argv[2];
const ws = new WebSocket('ws://127.0.0.1:8093/agent?token=' + encodeURIComponent(AT));
let seq = 0;
const waiters = new Map();
const send = (msg) => new Promise((res) => { const s = ++seq; waiters.set(s, res); ws.send(JSON.stringify({ ...msg, seq: s })); });
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.t === 'result' && waiters.has(m.seq)) { waiters.get(m.seq)(m); waiters.delete(m.seq); }
  if (m.t === 'state') { waiters.get(-1)?.(m); waiters.delete(-1); }
});
await new Promise((r) => { ws.on('open', r); });
const observe = () => new Promise((res) => { waiters.set(-1, res); ws.send(JSON.stringify({ t: 'observe' })); });

const goto = async (tx, ty) => {
  for (let guard = 0; guard < 200; guard++) {
    const o = await observe();
    const cx = Math.floor(o.pos.x / 100), cy = Math.floor(o.pos.y / 100);
    if (cx === tx && cy === ty) return true;
    const dir = cx < tx ? 'right' : cx > tx ? 'left' : cy < ty ? 'up' : 'down';
    const r = await send({ t: 'act', action: 'move', dir });
    if (!r.ok) return false;
  }
  return false;
};

const arrived = await goto(81, 80);
const o = await observe();
console.log('到达(81,80):', arrived, '实际格:', Math.floor(o.pos.x / 100) + ',' + Math.floor(o.pos.y / 100));
console.log('observe (81,81) 作物:', JSON.stringify((o.nearbyPlants || []).filter((p) => p.gx === 81 && p.gy === 81)));
console.log('observe plots:', JSON.stringify(o.plots));
const h = await send({ t: 'act', action: 'harvest', x: 81, y: 81 });
console.log('harvest (81,81):', 'ok=' + h.ok, h.msg || '');
ws.close();
process.exit(0);