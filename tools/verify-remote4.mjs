import { loadLocalEnv } from './env.mjs'; loadLocalEnv(); // P0: 密钥走 env（.env.local）
// verify-remote4.mjs —— 完整验证：hook WS 消息 + agent 接入初始位置 + 移动同步
import { connect } from './cdp.mjs';
import { spawn } from 'node:child_process';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const login = await (await fetch('http://127.0.0.1:8080/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'test3', password: '1234' }) })).json();
  const agentTok = (await (await fetch('http://127.0.0.1:8080/af/agent-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: login.token }) })).json()).agentToken;
  console.log('login ok:', login.uid);

  const cdp = await connect();
  // 先 patch WebSocket 记录消息，再注入凭证，再 reload
  await cdp.eval(`(() => {
    window.__WSLOG__ = [];
    const Orig = window.WebSocket;
    window.WebSocket = function (url, protocols) {
      const w = protocols ? new Orig(url, protocols) : new Orig(url);
      const origSend = w.send.bind(w);
      const origOnMsg = w.onmessage;
      Object.defineProperty(w, 'onmessage', {
        set(fn) {
          w.addEventListener('message', (ev) => {
            try { const m = JSON.parse(ev.data); window.__WSLOG__.push({ t: m.t, uid: m.uid, x: m.x, y: m.y }); } catch (e) {}
            fn && fn(ev);
          });
        },
        get() { return null; },
      });
      w.send = (data) => { try { window.__WSLOG__.push({ sent: JSON.parse(data).t }); } catch (e) {} return origSend(data); };
      return w;
    };
    window.WebSocket.prototype = Orig.prototype;
    window.__WSLOG__.push({ boot: 'patched' });
    try {
      localStorage.setItem('af_token', '${login.token}');
      localStorage.setItem('af_uid', '${login.uid}');
      localStorage.setItem('af_nick', 'test3');
    } catch (e) { window.__WSLOG__.push({ lsErr: e.message }); }
    return 'patched+injected';
  })()`);
  await cdp.eval('location.reload(); 1');
  await wait(18000);
  let r = await cdp.eval(`({ mods: Object.keys(window.__AF_MODS__ || {}).length, loginUI: !!document.getElementById('af-login'), wslog: window.__WSLOG__ })`);
  console.log('启动:', JSON.stringify(r.value));

  // 启动 agent
  const agent = spawn('node', ['D:/agent社区/AgentFarm2/tools/game-agent.mjs', '--token', agentTok, '--mode', 'text', '--rounds', '30',
    '--notes', 'D:/agent社区/AgentFarm2/data/agent-notes/test3',
    '--llm-url', 'https://api.deepseek.com/v1', '--llm-key', process.env.DEEPSEEK_API_KEY, '--llm-model', 'deepseek-v4-flash'], { stdio: 'ignore' });
  console.log('agent pid=', agent.pid);

  // 采样：节点位置 + WS 消息统计（10 次 × 10s）
  for (let i = 0; i < 10; i++) {
    await wait(10000);
    r = await cdp.eval(`(() => {
      try {
        const af = window.__AF__;
        const rp = af ? Array.from(af.remotePlayers.keys()) : [];
        const scene = cc.director.getScene();
        if (!scene) return { rp, err: 'no scene' };
        const canvas = scene.getChildByName('Canvas');
        const nodes = [];
        canvas.walk(n => { if (n.name === 'AFName') nodes.push({ x: Math.round(n.parent.x), y: Math.round(n.parent.y), active: n.parent.active, valid: n.parent.isValid }); });
        const moves = (window.__WSLOG__ || []).filter(m => m.t === 'move');
        return { rp, nodes, wsMoveCount: moves.length, wsTypes: [...new Set((window.__WSLOG__ || []).map(m => m.t || m.sent))].slice(0, 10) };
      } catch (e) { return { err: e.message }; }
    })()`);
    console.log(`[采样${i + 1}]`, JSON.stringify(r.value));
    if (r.value && r.value.nodes && r.value.nodes.length && r.value.nodes[0].x !== 0) break; // 已动
  }
  agent.kill();
  cdp.close();
  process.exit(0);
}
main().catch(e => { console.error('verify 异常:', e); process.exit(1); });
