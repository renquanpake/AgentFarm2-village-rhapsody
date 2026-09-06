// 协议冒烟测试：join → 移动 → 交互 → 命令 → 观战FOV → 存档
import WebSocket from 'ws';

const URL = process.env.WS_URL || 'ws://127.0.0.1:8080/ws';
const ws = new WebSocket(URL);
let meId = '';
let step = 0;

function send(m) { ws.send(JSON.stringify(m)); }
const log = (...a) => console.log('   ', ...a);

ws.on('open', () => {
  log('连接成功');
  send({ type: 'join', name: '测试员', color: '#ffd166', agentName: '小助手' });
});

ws.on('message', raw => {
  const m = JSON.parse(String(raw));
  if (m.type === 'mapNames') log('收到 mapNames:', Object.keys(m.map).length, '个场景');
  if (m.type === 'chat') log(`[聊天] ${m.from}: ${m.text}`);
  if (m.type === 'toast') log(`[提示] ${m.text}`);
  if (m.type === 'fov') {
    log('[FOV] 观战视野 3 行示例:'); log(m.grid.slice(5, 9).join('\n       '));
  }
  if (m.type === 'state') {
    if (!meId) {
      meId = m.you.id;
      log(`进入世界：${m.you.name} @ 场景${m.sceneId}(${m.map}) 位置(${m.you.id ? '未知' : '未知'})`);
      log(' actors:', m.actors.map(a => `${a.name}${a.isAgent ? '(AI)' : ''}@(${a.x},${a.y})`).join(' '));
      log(' 初始背包:', JSON.stringify(m.you.items));
      step = 1;
      // 开垦：连走几步面向空地
      send({ type: 'control', dir: 'right' });
    } else if (step === 1) {
      step = 2;
      send({ type: 'control', dir: 'right' });
    } else if (step === 2) {
      step = 3;
      send({ type: 'control', interact: true }); // 开垦
    } else if (step === 3) {
      step = 4;
      // 买种子并播种
      send({ type: 'chat', channel: 'player', text: '/buy 小麦种子 2' });
    } else if (step === 4) {
      step = 5;
      send({ type: 'control', interact: true }); // 播种
    } else if (step === 5) {
      step = 6;
      send({ type: 'chat', channel: 'player', text: '/task' });
    } else if (step === 6) {
      step = 7;
      // 观战 Agent
      const agent = m.actors.find(a => a.isAgent);
      if (agent) send({ type: 'spectate', target: agent.id });
    } else if (step === 7) {
      step = 8;
      // 私聊 Agent
      const agent = m.actors.find(a => a.isAgent);
      if (agent) send({ type: 'talk', target: agent.id, text: '去钓鱼吧' });
    } else if (step === 8) {
      // 数秒后收尾存档
      setTimeout(() => {
        send({ type: 'chat', channel: 'player', text: '/who' });
        setTimeout(() => { console.log('=== 冒烟测试完成 ==='); ws.close(); process.exit(0); }, 2000);
      }, 1500);
    }
    if (step >= 3 && m.you) log(' 状态: 饱食度', Math.round(m.you.hunger), '金币', m.you.gold, '背包', Object.entries(m.you.items).filter(([, v]) => v > 0).map(([k, v]) => k + ':' + v).join(','));
  }
});

ws.on('error', e => { console.error('WS 错误', e.message); process.exit(1); });
setTimeout(() => { console.log('超时未完成'); process.exit(1); }, 30000);