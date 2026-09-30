import { loadLocalEnv } from './env.mjs'; loadLocalEnv(); // P0: 密钥走 env（.env.local）
// verify-agentself.mjs —— 验证 agent 托管驱动"唯一主角"，不创建第二个化身
import { connect } from './cdp.mjs';
import { spawn } from 'node:child_process';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const login = await (await fetch('http://127.0.0.1:8080/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
  const cdp = await connect();
  // 记录 WS 收到的 t 类型
  await cdp.eval(`(() => {
    window.__AFWSTYPES__ = [];
    const Orig = window.WebSocket;
    window.WebSocket = function(u,p){ const w = p?new Orig(u,p):new Orig(u); const add = w.addEventListener.bind(w); w.addEventListener('message', ev => { try { const m = JSON.parse(ev.data); (window.__AFWSTYPES__||[]).push(m.t); } catch(e){} }); return w; };
    window.WebSocket.prototype = Orig.prototype;
    localStorage.setItem('af_token','${login.token}'); localStorage.setItem('af_uid','${login.uid}'); localStorage.setItem('af_nick','test3');
    return 'ready';
  })()`);
  await cdp.eval('location.reload();');
  await wait(16000);

  // 启动 agent
  const agentTok = (await (await fetch('http://127.0.0.1:8080/af/agent-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:login.token})})).json()).agentToken;
  const agent = spawn('node', ['D:/agent社区/AgentFarm2/tools/game-agent.mjs','--token',agentTok,'--mode','text','--rounds','10','--notes','D:/agent社区/AgentFarm2/data/agent-notes/test3','--llm-url','https://api.deepseek.com/v1','--llm-key',process.env.DEEPSEEK_API_KEY,'--llm-model','deepseek-v4-flash'], { stdio: 'ignore' });
  console.log('agent pid:', agent.pid);
  await wait(25000);

  const r = await cdp.eval(`(() => {
    const types = window.__AFWSTYPES__ || [];
    const stats = {};
    types.forEach(t => stats[t] = (stats[t]||0)+1);
    const remotes = window.__AF__ ? Array.from(window.__AF__.remotePlayers?.keys() || []) : [];
    return { stats, remotes, hasAgentMove: types.includes('agent_move'), hasMove: types.includes('move') };
  })()`);
  console.log('WS 消息统计:', JSON.stringify(r.value));
  const mv = r.value && r.value.stats;
  console.log(mv && mv['agent_move'] > 0
    ? '✅ 收到 agent_move（驱动唯一主角）'
    : '❌ 未收到 agent_move');
  console.log(r.value && r.value.remotes && r.value.remotes.length === 0
    ? '✅ 无远程化身（未创建第二个自己）'
    : '⚠️ remotes=' + JSON.stringify(r.value && r.value.remotes));

  agent.kill();
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
