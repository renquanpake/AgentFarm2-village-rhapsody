import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:8093/agent?token=' + encodeURIComponent(process.argv[2]));
await new Promise((r) => { ws.on('open', r); });
const o = await new Promise((res) => { ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t === 'state') res(m); }); ws.send(JSON.stringify({ t: 'observe' })); });
console.log('observe 顶层字段:', Object.keys(o).join(','));
for (const k of Object.keys(o)) {
  const v = o[k];
  if (Array.isArray(v)) console.log('  ' + k + '[] = ' + v.length);
}
console.log('plots:', JSON.stringify(o.plots));
ws.close(); process.exit(0);
