import { loadLocalEnv } from './env.mjs'; loadLocalEnv(); // P0: 密钥走 env（.env.local）
// verify-remote.mjs —— 端到端验证 agent 节点渲染：
// 1. CDP 注入 test3 登录 → 游戏启动
// 2. 启动 test3 的 agent（子进程）
// 3. 在页面里检查 __AF__ 远程玩家表 / cocos 节点 / 位置
import { connect } from './cdp.mjs';
import { spawn } from 'node:child_process';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  // ---- 1. 登录 test3（HTTP 拿 token）----
  const login = await (await fetch('http://127.0.0.1:8080/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
  console.log('login:', login.ok, login.uid);
  const agentTok = (await (await fetch('http://127.0.0.1:8080/af/agent-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: login.token }) })).json()).agentToken;

  // ---- 2. CDP 注入凭证并刷新 ----
  const cdp = await connect();
  let r = await cdp.eval(`localStorage.setItem('af_token', '${login.token}'); localStorage.setItem('af_uid', '${login.uid}'); localStorage.setItem('af_nick', 'test3'); 'injected';`);
  console.log('注入凭证:', JSON.stringify(r));
  r = await cdp.eval('location.reload(); "reloading"');
  console.log('reload:', JSON.stringify(r));
  await wait(12000);

  // ---- 3. 检查游戏启动状态 ----
  r = await cdp.eval(`({
    af: !!window.__AF__,
    mods: Object.keys(window.__AF_MODS__ || {}).length,
    cc: !!window.cc,
    remotePlayers: window.__AF__ ? Object.keys(window.__AF__.remotePlayers || {}) : [],
  })`);
  console.log('游戏状态:', JSON.stringify(r));

  // ---- 4. 启动 agent（后台）----
  const agent = spawn('node', ['D:/agent社区/AgentFarm2/tools/game-agent.mjs', '--token', agentTok, '--mode', 'text', '--rounds', '15',
    '--notes', 'D:/agent社区/AgentFarm2/data/agent-notes/test3',
    '--llm-url', 'https://api.deepseek.com/v1', '--llm-key', process.env.DEEPSEEK_API_KEY, '--llm-model', 'deepseek-v4-flash'], { stdio: 'ignore' });
  console.log('agent 子进程已启动 pid=', agent.pid);
  await wait(8000);

  // ---- 5. 检查远程玩家表与节点 ----
  r = await cdp.eval(`(() => {
    const af = window.__AF__;
    if (!af) return { err: 'no __AF__' };
    const rp = Object.keys(af.remotePlayers || {});
    // remotes 是闭包内的 Map，__AF__ 没暴露 —— 通过场景树找 AF 节点
    let afNodes = [];
    try {
      const scene = cc.director.getScene();
      const canvas = scene.getChildByName('Canvas');
      canvas.walk(n => { if (n.name === 'AFName' || n.name.startsWith('New Player')) afNodes.push(n.name + '@' + n.parent.name); });
    } catch (e) { afNodes = ['walk err: ' + e.message]; }
    return { remotePlayers: rp, afNodes: afNodes.slice(0, 10) };
  })()`);
  console.log('远程玩家/节点:', JSON.stringify(r));

  // ---- 6. 等 agent 移动后看节点位置 ----
  await wait(10000);
  r = await cdp.eval(`(() => {
    try {
      const scene = cc.director.getScene();
      const canvas = scene.getChildByName('Canvas');
      const out = [];
      canvas.walk(n => {
        if (n.name === 'AFName') {
          const p = n.parent;
          out.push({ node: p.name, x: Math.round(p.x), y: Math.round(p.y), active: p.active, valid: p.isValid });
        }
      });
      return out;
    } catch (e) { return { err: e.message }; }
  })()`);
  console.log('AF 节点状态:', JSON.stringify(r, null, 1));

  agent.kill();
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error('verify 异常:', e); process.exit(1); });
