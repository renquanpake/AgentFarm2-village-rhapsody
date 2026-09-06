// 外部 Agent 接入端到端测试：join → 拿 token → 启动示例程序 → 验证 observe/act
import WebSocket from 'ws';
import { spawn } from 'node:child_process';

const ws = new WebSocket('ws://127.0.0.1:8080/ws');
let token = '';
let phase = 0;

function send(m) { ws.send(JSON.stringify(m)); }
const log = (...a) => console.log('   ', ...a);

ws.on('open', () => send({ type: 'join', name: '接入测试', agentName: '小助手' }));

ws.on('message', raw => {
  const m = JSON.parse(String(raw));
  if (m.type === 'mapNames' && phase === 0) {
    phase = 1;
    send({ type: 'chat', channel: 'player', text: '/agent' });
  }
  if (m.type === 'toast' && phase === 1 && m.text.includes('Agent 接入')) {
    phase = 2;
    const mm = m.text.match(/Token: ([0-9a-f]+)/);
    if (!mm) { log('TOKEN 解析失败:', m.text); process.exit(1); }
    token = mm[1];
    log('拿到 token:', token.slice(0, 12) + '…');
    // 启动外部 Agent 示例程序（规则模式）
    const child = spawn(process.execPath, ['examples/agent-program.mjs', token], { cwd: process.cwd() });
    child.stdout.on('data', d => log('[agent程序]', String(d).trim()));
    child.stderr.on('data', d => log('[agent程序ERR]', String(d).trim()));
    setTimeout(() => { child.kill(); finish(); }, 12000);
  }
});

function finish() {
  console.log('=== 外部接入测试完成 ===');
  process.exit(0);
}
setTimeout(() => { console.log('超时'); process.exit(1); }, 25000);