// verify-remote2.mjs —— v2：等页面就绪 → 注入凭证 → 游戏 boot → agent → 检查节点
import { connect } from './cdp.mjs';
import { spawn } from 'node:child_process';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const login = await (await fetch('http://127.0.0.1:8080/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
  const agentTok = (await (await fetch('http://127.0.0.1:8080/af/agent-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: login.token }) })).json()).agentToken;
  console.log('login ok:', login.uid);

  const cdp = await connect();
  // 等页面就绪（location 是游戏页）
  let href = '';
  for (let i = 0; i < 20; i++) {
    const r = await cdp.eval('location.href');
    if (r.value && r.value.includes('8080')) { href = r.value; break; }
    await wait(1000);
  }
  console.log('页面:', href);
  if (!href) { console.error('页面未就绪'); process.exit(1); }

  // 注入凭证
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
  console.log('已刷新，等待游戏启动...');
  await wait(18000);

  // 游戏 boot 状态
  r = await cdp.eval(`({ href: location.href, af: !!window.__AF__, mods: Object.keys(window.__AF_MODS__ || {}).length, cc: !!window.cc, loginUI: !!document.getElementById('af-login') })`);
  console.log('启动状态:', JSON.stringify(r.value));

  // 启动 agent
  const agent = spawn('node', ['D:/agent社区/AgentFarm2/tools/game-agent.mjs', '--token', agentTok, '--mode', 'text', '--rounds', '15',
    '--notes', 'D:/agent社区/AgentFarm2/data/agent-notes/test3',
    '--llm-url', 'https://api.deepseek.com/v1', '--llm-key', 'sk-44ef3dcb50264ca2981bc206bc94297b', '--llm-model', 'deepseek-v4-flash'], { stdio: 'ignore' });
  console.log('agent pid=', agent.pid);
  await wait(10000);

  // 检查远程玩家表
  r = await cdp.eval(`Object.keys(window.__AF__ ? window.__AF__.remotePlayers || {} : {})`);
  console.log('remotePlayers:', JSON.stringify(r.value));

  // 检查场景树里的 AF 节点（等 agent 移动）
  await wait(12000);
  r = await cdp.eval(`(() => {
    try {
      const scene = cc.director.getScene();
      if (!scene) return { err: 'no scene' };
      const canvas = scene.getChildByName('Canvas');
      if (!canvas) return { err: 'no canvas' };
      const out = [];
      canvas.walk(n => { if (n.name === 'AFName') out.push({ name: n.parent.name, x: Math.round(n.parent.x), y: Math.round(n.parent.y), active: n.parent.active }); });
      return out;
    } catch (e) { return { err: e.message }; }
  })()`);
  console.log('AF 节点:', JSON.stringify(r.value, null, 1));

  agent.kill();
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error('verify 异常:', e); process.exit(1); });
