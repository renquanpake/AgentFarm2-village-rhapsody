// 测试 ws://127.0.0.1:8080/agent?token=... 的连接与关闭原因
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { WebSocket } = require('D:\\agent社区\\AgentFarm2\\tools\\node_modules\\ws');

const token = process.env.AF_AGENT_TOKEN || '';
const url = `ws://127.0.0.1:8080/agent?token=${token}`;
console.log('connecting', url);
const ws = new WebSocket(url, { handshakeTimeout: 5000 });

ws.on('open', () => console.log('[ws] open'));
ws.on('message', (d) => console.log('[ws] message:', d.toString().slice(0, 300)));
ws.on('close', (code, reason) => { console.log('[ws] close code=' + code + ' reason=' + reason.toString()); process.exit(0); });
ws.on('error', (e) => { console.log('[ws] error:', e.message); process.exit(1); });
setTimeout(() => { console.log('[ws] timeout'); ws.terminate(); process.exit(0); }, 8000);
