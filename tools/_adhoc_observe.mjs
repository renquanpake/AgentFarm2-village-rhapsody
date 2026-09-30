// 临时脚本：通过 MCP stdio 协议调用 game_observe
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const token = process.env.AF_AGENT_TOKEN || '';
const child = spawn('node', ['D:\\agent社区\\AgentFarm2\\tools\\agent-mcp.mjs', '--connect-timeout', '20'], {
  env: { ...process.env, AF_AGENT_TOKEN: token },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
let pending = new Map();

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }
});
child.stderr.on('data', (d) => process.stderr.write('[mcp-stderr] ' + d));

function call(method, params = {}) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

try {
  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'hermes-cli-adhoc', version: '1.0' },
  });
  // 通知 initialized
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const result = await call('tools/call', { name: 'game_observe', arguments: {} });
  const parsed = JSON.parse(result.content?.[0]?.text ?? '{}');
  console.log(JSON.stringify(parsed, null, 2));
} finally {
  child.kill();
}
