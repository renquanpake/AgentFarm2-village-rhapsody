import { loadLocalEnv } from './env.mjs'; loadLocalEnv(); // P0: 密钥走 env（.env.local）
// verify-remote5.mjs —— 验证移动同步：派移动任务 → 采样节点位置变化
import { connect } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const login = await (await fetch('http://127.0.0.1:8080/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
  const agentTok = (await (await fetch('http://127.0.0.1:8080/af/agent-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: login.token }) })).json()).agentToken;
  const cdp = await connect();
  await cdp.eval(`(() => {
    try {
      localStorage.setItem('af_token', '${login.token}');
      localStorage.setItem('af_uid', '${login.uid}');
      localStorage.setItem('af_nick', 'test3');
      return 'ok';
    } catch (e) { return 'err: ' + e.message; }
  })()`);
  await cdp.eval('location.reload(); 1');
  await wait(18000);

  // 派任务：去村中心
  const inboxFile = 'D:/agent社区/AgentFarm2/data/agent-notes/test3/inbox.json';
  mkdirSync('D:/agent社区/AgentFarm2/data/agent-notes/test3', { recursive: true });
  writeFileSync(inboxFile, JSON.stringify([{ from: 'test3', text: '去村中心（3500,3000）逛逛，找杂货店老板认识一下', at: Date.now() }], null, 1));

  const agent = spawn('node', ['D:/agent社区/AgentFarm2/tools/game-agent.mjs', '--token', agentTok, '--mode', 'text', '--rounds', '25',
    '--notes', 'D:/agent社区/AgentFarm2/data/agent-notes/test3',
    '--llm-url', 'https://api.deepseek.com/v1', '--llm-key', process.env.DEEPSEEK_API_KEY, '--llm-model', 'deepseek-v4-flash'], { stdio: 'ignore' });
  console.log('agent pid=', agent.pid);

  let prev = null;
  for (let i = 0; i < 8; i++) {
    await wait(10000);
    const r = await cdp.eval(`(() => {
      try {
        const scene = cc.director.getScene();
        if (!scene) return { err: 'no scene' };
        const canvas = scene.getChildByName('Canvas');
        const nodes = [];
        canvas.walk(n => { if (n.name === 'AFName') nodes.push({ x: Math.round(n.parent.x), y: Math.round(n.parent.y), active: n.parent.active }); });
        return { nodes };
      } catch (e) { return { err: e.message }; }
    })()`);
    const cur = r.value && r.value.nodes && r.value.nodes[0];
    const moved = cur && prev && (Math.abs(cur.x - prev.x) > 50 || Math.abs(cur.y - prev.y) > 50);
    console.log(`[采样${i + 1}]`, JSON.stringify(r.value), moved ? ' <<< 在移动!' : '');
    if (cur) prev = cur;
    if (moved) break;
  }
  agent.kill();
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error('verify 异常:', e); process.exit(1); });
