// agent-program.mjs —— 外部 Agent 接入示例（档2）
// 用法：从 server/ 目录运行：
//   node examples/agent-program.mjs <token> [ws://127.0.0.1:8080/agent]
// 说明：
//   - token 在游戏里生成：聊天框输入 /agent 查看，或游戏内"Agent 设置"面板复制
//   - 程序连接后：服务器每 4s 推一条 observe（世界状态+视野），程序回 act（意图原语）
//   - 本示例内置两种决策：
//       MODE=rule   规则 Agent（免费零依赖，演示协议）
//       MODE=llm    调用你自己的 OpenAI 兼容模型（设置 LLM_BASE_URL / LLM_KEY / LLM_MODEL 环境变量）
//   - 动作原语：move(up|down|left|right) / interact / use(物品id) / chat(文本) / sleep
//   - 服务器校验一切动作合法性；断线后角色自动回内置大脑托管
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const token = process.argv[2];
if (!token) { console.error('用法: node examples/agent-program.mjs <token> [ws地址]'); process.exit(1); }
const url = process.argv[3] || 'ws://127.0.0.1:8081/agent';
const MODE = process.env.MODE || 'rule';

// —— 下载游戏规则到本地（了解玩法；可用 RULES_FILE 指定保存位置） ——
(async () => {
  try {
    // 规则文档在主服务端口 8080 提供（Agent 通道是独立端口 8081）
    const base = process.env.RULES_URL || 'http://127.0.0.1:8080';
    const res = await fetch(`${base}/docs/游戏规则-Agent版.md`);
    if (res.ok) {
      const out = process.env.RULES_FILE || path.join(process.cwd(), 'AgentFarm-游戏规则.md');
      fs.writeFileSync(out, await res.text());
      console.log('📖 游戏规则已保存到：', out);
    } else {
      console.log('⚠️ 未能下载游戏规则（HTTP', res.status, '）');
    }
  } catch { console.log('⚠️ 未能下载游戏规则（服务器 /docs 不可达）'); }
})();

const ws = new WebSocket(url);
let last = { x: 0, y: 0, hunger: 100, hp: 100 };

ws.on('open', () => {
  console.log('🔌 已连接，注册 token…');
  ws.send(JSON.stringify({ type: 'agent_join', token }));
});

ws.on('message', async raw => {
  const m = JSON.parse(String(raw));
  if (m.type === 'ok') { console.log('✅ 绑定角色：', m.name, '（等待观察…）'); return; }
  if (m.type === 'error') { console.error('❌ 注册失败：', m.msg); process.exit(1); }
  if (m.type === 'observe') {
    last = m.you;
    const act = MODE === 'llm' ? await llmDecide(m) : ruleDecide(m);
    if (act) {
      console.log(`  观察@(${m.you.x},${m.you.y}) 饱食${m.you.hunger} → 动作: ${act.action}${act.param ? ' ' + JSON.stringify(act.param) : ''}`);
      ws.send(JSON.stringify({ type: 'act', action: act.action, param: act.param }));
    }
  }
});

ws.on('close', () => { console.log('🔌 连接断开'); process.exit(0); });
ws.on('error', e => { console.error('连接错误:', e.message); process.exit(1); });

// —— 规则 Agent（零依赖参考实现：饿了吃/钓鱼 → 夜晚睡觉 → 挖矿/砍树/散步） ——
function ruleDecide(obs) {
  const hour = obs.world.hour;
  if (obs.you.hunger < 45) {
    // 找吃的：先吃背包食物
    const foodKeys = Object.keys(obs.you.items || {});
    const food = foodKeys.find(k => /小麦|鱼|玉米|土豆|食物/.test(k));
    if (food) return { action: 'use', param: obs.you.items[food] !== undefined ? food : undefined };
    return { action: 'move', param: randomDir() }; // 简化：散步找吃的（完整版应寻路去水边）
  }
  if (hour >= 20 || hour < 5) return { action: 'sleep' };
  const r = Math.random();
  if (r < 0.3) return { action: 'interact' };   // 浇水/收获/开垦/挖矿/砍树/钓鱼（面朝什么做什么）
  if (r < 0.5) return { action: 'move', param: randomDir() };
  if (r < 0.7) return { action: 'chat', param: ['今天天气真好呀', '一起去干活吗？', '这个村子真不错'][Math.floor(Math.random() * 3)] };
  return { action: 'move', param: randomDir() };
}
function randomDir() { return ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)]; }

// —— LLM Agent（接你自己的 OpenAI 兼容模型，需设环境变量） ——
async function llmDecide(obs) {
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_KEY;
  const model = process.env.LLM_MODEL;
  if (!base || !key || !model) { console.error('LLM 模式需要环境变量 LLM_BASE_URL/LLM_KEY/LLM_MODEL'); process.exit(1); }
  const sys = `你是 ${obs.you.name || '农场居民'}，AgentFarm 的 AI 居民。根据观察输出 JSON 动作：
{"action":"move|interact|use|chat|sleep","param":"方向(up/down/left/right) 或 物品名 或 要说的话"}
规则：饥饿<45 先吃背包食物；夜晚(>=20时)睡觉；否则面朝资源交互(挖矿/砍树/钓鱼)或与人聊天。只输出 JSON。`;
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: 80,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `观察：${JSON.stringify(obs)}` }
      ]
    })
  });
  if (!res.ok) return { action: 'move', param: randomDir() };
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content || '';
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return { action: String(parsed.action || 'move'), param: parsed.param };
  } catch { return { action: 'move', param: randomDir() }; }
}

setInterval(() => { /* 保持进程存活 */ }, 60000);