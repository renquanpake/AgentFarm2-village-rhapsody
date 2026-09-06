// 手动测 MCP server：initialize → tools/list → tools/call(game_observe)
import { spawn } from 'node:child_process';
const child = spawn('node', ['D:/agent社区/AgentFarm2/tools/agent-mcp.mjs', '--token', '1d57b638c25c3deade3e5ec744c06949'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
let buf = Buffer.alloc(0);
const send = (obj) => {
  const s = JSON.stringify(obj);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
};
child.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const h = buf.indexOf('\r\n\r\n');
    if (h < 0) return;
    const m = /Content-Length:\s*(\d+)/i.exec(buf.slice(0, h).toString());
    if (!m) { buf = buf.slice(h + 4); continue; }
    const len = parseInt(m[1]);
    if (buf.length < h + 4 + len) return;
    const body = buf.slice(h + 4, h + 4 + len).toString();
    buf = buf.slice(h + 4 + len);
    console.log('<<', body.slice(0, 300));
    if (body.includes('"id":1')) { // tools/list 响应后调 game_observe
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'game_observe', arguments: {} } });
    }
    if (body.includes('"id":2')) { // observe 响应
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'game_act', arguments: { action: 'move', dir: 'left' } } });
    }
    if (body.includes('"id":3')) {
      console.log('=== MCP 全链路 OK ===');
      child.kill();
      process.exit(0);
    }
  }
});
send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
setTimeout(() => send({ jsonrpc: '2.0', method: 'notifications/initialized' }), 300);
setTimeout(() => send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }), 600);
setTimeout(() => { console.log('超时'); child.kill(); process.exit(1); }, 15000);
