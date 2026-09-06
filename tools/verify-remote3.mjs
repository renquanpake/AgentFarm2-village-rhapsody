// verify-remote3.mjs —— v3：正确检查（Map 用 Array.from）+ 等 agent 移动验证位置同步
import { connect } from './cdp.mjs';
import { spawn } from 'node:child_process';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const login = await (await fetch('http://127.0.0.1:8080/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
  const agentTok = (await (await fetch('http://127.0.0.1:8080/af/agent-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: login.token }) })).json()).agentToken;
  console.log('login ok:', login.uid);

  const cdp = await connect();
  // 注入凭证（页面应已在游戏页）
  let r = await cdp.eval(`(() => {
    try {
      localStorage.setItem('af_token', '${login.token}');
      localStorage.setItem('af_uid', '${login.uid}');
      localStorage.setItem('af_nick', 'test3');
      return 'ok';
    } catch (e) { return 'err: ' + e.message; }
  })()`);
  console.log('注入:', JSON.stringify(r.value));
  await cdp.eval('location.reload(); 1');
  await wait(18000);
  r = await cdp.eval(`({ mods: Object.keys(window.__AF_MODS__ || {}).length, loginUI: !!document.getElementById('af-login') })`);
  console.log('启动:', JSON.stringify(r.value));

  // 启动 agent
  const agent = spawn('node', ['D:/agent社区/AgentFarm2/tools/game-agent.mjs', '--token', agentTok, '--mode', 'text', '--rounds', '20',
    '--notes', 'D:/agent社区/AgentFarm2/data/agent-notes/test3',
    '--llm-url', 'https://api.deepseek.com/v1', '--llm-key', 'sk-44ef3dcb50264ca2981bc206bc94297b', '--llm-model', 'deepseek-v4-flash'], { stdio: 'ignore' });
  console.log('agent pid=', agent.pid);

  // 每 5s 采样节点状态（3 次）
  for (let i = 0; i < 6; i++) {
    await wait(5000);
    r = await cdp.eval(`(() => {
      try {
        const af = window.__AF__;
        const rp = af ? Array.from(af.remotePlayers.keys()) : [];
        const scene = cc.director.getScene();
        if (!scene) return { rp, err: 'no scene' };
        const canvas = scene.getChildByName('Canvas');
        const nodes = [];
        canvas.walk(n => { if (n.name === 'AFName') nodes.push({ x: Math.round(n.parent.x), y: Math.round(n.parent.y), active: n.parent.active }); });
        return { rp, nodes };
      } catch (e) { return { err: e.message }; }
    })()`);
    console.log(`[采样${i + 1}]`, JSON.stringify(r.value));
  }
  agent.kill();
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error('verify 异常:', e); process.exit(1); });
