// debug-agent-move.mjs —— 深入检查 agent 状态和移动链路
import { connect } from './cdp.mjs';
import { spawn } from 'node:child_process';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const login = await (await fetch('http://127.0.0.1:8080/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
  const cdp = await connect();
  await cdp.eval(`localStorage.setItem('af_token','${login.token}'); localStorage.setItem('af_uid','${login.uid}'); localStorage.setItem('af_nick','test3');`);
  await cdp.eval('location.reload();');
  await wait(18000);

  // 游戏状态
  let r = await cdp.eval(`({
    mods: Object.keys(window.__AF_MODS__||{}).length,
    loginUI: !!document.getElementById('af-login'),
    afRemotePlayers: window.__AF__ ? Array.from(window.__AF__.remotePlayers?.keys() || []) : [],
  })`);
  console.log('1. 页面状态:', JSON.stringify(r.value));

  // 启动 agent
  const { spawn: sp } = await import('node:child_process');
  const agent = sp('node', [
    'D:/agent社区/AgentFarm2/tools/game-agent.mjs', '--token', 'f70039c9b0729fae6c448b127862685e',
    '--mode', 'text', '--rounds', '15', '--notes', 'D:/agent社区/AgentFarm2/data/agent-notes/test3',
    '--llm-url', 'https://api.deepseek.com/v1', '--llm-key', 'sk-44ef3dcb50264ca2981bc206bc94297b', '--llm-model', 'deepseek-v4-flash'
  ], { stdio: 'ignore' });
  console.log('2. agent pid:', agent.pid);
  await wait(15000);

  // 再次检查 remotePlayers
  r = await cdp.eval(`({
    afRemotePlayers: window.__AF__ ? Array.from(window.__AF__.remotePlayers?.keys() || []) : [],
    modsCount: window.__AF_MODS__ ? Object.keys(window.__AF_MODS__).length : 0,
    hasApplication: !!(window.__AF_MODS__ && window.__AF_MODS__['Application']),
  })`);
  console.log('3. agent 接入后:', JSON.stringify(r.value));

  // 场景树检查
  r = await cdp.eval(`(() => {
    try {
      const s = cc.director.getScene();
      if (!s) return { err: 'no scene' };
      const c = s.getChildByName('Canvas');
      if (!c) return { err: 'no Canvas' };
      const all = [];
      c.walk(n => { all.push({ name: n.name, x: Math.round(n.x), y: Math.round(n.y), children: n.children.length }); });
      return all.filter(n => n.name.includes('Player') || n.name.includes('AF') || n.name.includes('55') || n.name.includes('agent'));
    } catch (e) { return { err: e.message }; }
  })()`);
  console.log('4. 场景中的玩家/Agent节点:', JSON.stringify(r.value));

  agent.kill();
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
