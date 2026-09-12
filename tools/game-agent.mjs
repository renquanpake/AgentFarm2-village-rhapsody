#!/usr/bin/env node
// ============================================================
// AgentFarm2 独立游戏 Agent
// 连接游戏服务器 /agent 通道，用 LLM 驱动角色在《乡村狂想曲》联机世界里活动。
//
// 笔记权限沙箱：agent 的笔记读写只允许在 --notes 指定的子目录内（防路径逃逸），
//   用于长期记忆/任务板/日记。其余文件一律不可读写。
//
// 用法：
//   node game-agent.mjs --token <接入码> [--rounds 5]
//        [--llm-url https://api.deepseek.com/v1 --llm-key sk-xxx --llm-model deepseek-chat]
//        [--notes D:\agent社区\AgentFarm2\data\agent-notes\我的Agent]
//   环境变量兜底：AGENTFARM_TOKEN / AGENTFARM_WS / LLM_URL / LLM_KEY / LLM_MODEL
// ============================================================
import WebSocket from 'ws';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join, normalize, relative } from 'node:path';

const argVal = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : (process.env[({
    '--token': 'AGENTFARM_TOKEN', '--ws': 'AGENTFARM_WS', '--llm-url': 'LLM_URL',
    '--llm-key': 'LLM_KEY', '--llm-model': 'LLM_MODEL',
  }[k] || '')] || d);
};
const TOKEN = argVal('--token', '');
const WS_URL = argVal('--ws', 'ws://127.0.0.1:8080/agent') + (argVal('--token', '') ? '?token=' + argVal('--token') : '?token=' + TOKEN);
const ROUNDS = Number(argVal('--rounds', '5'));
const LLM_URL = argVal('--llm-url', 'https://api.deepseek.com/v1').replace(/\/$/, '');
const LLM_KEY = argVal('--llm-key', '');
const LLM_MODEL = argVal('--llm-model', 'deepseek-v4-flash');
const NOTES_ROOT = resolve(argVal('--notes', join(process.cwd(), 'data', 'agent-notes', 'default')));

// ---------- 笔记沙箱（只允许 NOTES_ROOT 内读写） ----------
function safeNotePath(name) {
  if (!/^[\w\u4e00-\u9fa5.\-\/ ]+\.md$/.test(name)) throw new Error('笔记名不合法（只允许 xxx.md）');
  const p = normalize(join(NOTES_ROOT, name));
  const rel = relative(NOTES_ROOT, p);
  if (rel.startsWith('..') || rel.startsWith('/') || (rel.length > 1 && rel[1] === ':')) {
    throw new Error('路径越界：禁止访问笔记目录之外');
  }
  return p;
}
function noteList() {
  if (!existsSync(NOTES_ROOT)) return [];
  const out = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.md')) out.push(relative(NOTES_ROOT, p).replace(/\\/g, '/'));
    }
  };
  walk(NOTES_ROOT);
  return out;
}
function noteRead(name) {
  const p = safeNotePath(name);
  if (!existsSync(p)) return `（笔记不存在：${name}）`;
  const st = statSync(p);
  if (st.size > 20000) return `（笔记过大 ${st.size} 字节，截断）` + readFileSync(p, 'utf8').slice(0, 20000);
  return readFileSync(p, 'utf8');
}
function noteWrite(name, content) {
  const p = safeNotePath(name);
  mkdirSync(join(NOTES_ROOT, relative(NOTES_ROOT, p).split(/[\\/]/).slice(0, -1).join('/')), { recursive: true });
  writeFileSync(p, String(content || ''), 'utf8');
  return `已写入 ${name}（${Buffer.byteLength(String(content || ''), 'utf8')} 字节）`;
}

// ---------- 游戏通道 ----------
let ws = null;
function gameCall(t, params = {}, wantT = null) {
  return new Promise((resolveP) => {
    if (!ws || ws.readyState !== 1) { resolveP({ ok: false, msg: '游戏连接未就绪' }); return; }
    const onMsg = (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      const match = wantT ? m.t === wantT : (m.t === 'result' || m.t === 'state');
      if (match) { ws.off('message', onMsg); resolveP(m); }
    };
    ws.on('message', onMsg);
    try { ws.send(JSON.stringify({ t, ...params })); } catch (e) { ws.off('message', onMsg); resolveP({ ok: false, msg: '发送失败: ' + e.message }); }
    setTimeout(() => { ws.off('message', onMsg); resolveP({ ok: false, msg: '游戏响应超时' }); }, 15000);
  });
}

// ---------- 工具定义（LLM function calling） ----------
const NOTE_TOOLS = [
  { name: 'note_list', description: '列出我的笔记目录里的所有笔记名', params: { type: 'object', properties: {} } },
  { name: 'note_read', description: '读取一篇笔记的全文（笔记是我的长期记忆/任务板/日记）', params: { type: 'object', properties: { name: { type: 'string', description: '笔记文件名，如 日记.md' } }, required: ['name'] } },
  { name: 'note_write', description: '写入/覆盖一篇笔记（可建子目录，如 任务/今天.md）', params: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string', description: '笔记内容（Markdown）' } }, required: ['name', 'content'] } },
];
const GAME_TOOLS = [
  { name: 'game_observe', description: '查看游戏世界状态：场景/坐标/天数/背包(所有物品+金币)/NPC/附近植物(含成熟状态)/地块(已犁/未成熟/成熟可收)/附近可犁地/附近玩家位置/水边/矿山/收件箱未读。返回 JSON。', params: { type: 'object', properties: {} } },
  { name: 'game_act', description: '在游戏世界执行行动。action：move_to(寻路移动 x,y) / talk(NPC问价 npcId) / buy(买物品 itemId+count) / chat(说话 text) / plant(播种：itemId=种子id + x,y) / harvest(收菜：x,y) / chop(砍树：x,y) / fish(钓鱼) / mine(挖矿) / till(犁地：x,y 可耕种土地) / water(浇水：x,y 未成熟作物) / place(安装洒水器：itemId=洒水器id + x,y)。', params: { type: 'object', properties: { action: { type: 'string', enum: ['move_to', 'talk', 'buy', 'chat', 'plant', 'harvest', 'chop', 'fish', 'mine', 'till', 'water', 'place'] }, x: { type: 'integer' }, y: { type: 'integer' }, npcId: { type: 'integer' }, itemId: { type: 'integer' }, count: { type: 'integer' }, text: { type: 'string' } }, required: ['action'] } },
  { name: 'game_inbox', description: '拉取玩家（我的主人）发来的指挥消息。返回全部未读消息（读后清除）。', params: { type: 'object', properties: {} } },
  { name: 'game_chat_log', description: '查看玩家频道最近的聊天记录（玩家们在聊什么）。', params: { type: 'object', properties: {} } },
];

// ---------- 工具执行 ----------
async function runTool(name, a) {
  switch (name) {
    case 'game_observe': return gameCall('observe');
    case 'game_act': {
      const params = { action: String(a.action || '') };
      for (const k of ['dir', 'x', 'y', 'npcId', 'itemId', 'count', 'text']) if (a[k] !== undefined) params[k] = a[k];
      return gameCall('act', params);
    }
    case 'game_inbox': return gameCall('inbox', {}, 'inbox');
    case 'game_chat_log': return gameCall('chat_log', {}, 'chat_log');
    case 'note_list': return { ok: true, notes: noteList() };
    case 'note_read': try { return { ok: true, content: noteRead(String(a.name || '')) }; } catch (e) { return { ok: false, msg: e.message }; }
    case 'note_write': try { return { ok: true, msg: noteWrite(String(a.name || ''), a.content) }; } catch (e) { return { ok: false, msg: e.message }; }
    default: return { ok: false, msg: '未知工具 ' + name };
  }
}

// ---------- LLM ----------
async function llmChat(messages) {
  const res = await fetch(LLM_URL + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LLM_KEY },
    body: JSON.stringify({ model: LLM_MODEL, messages, temperature: 0.7, max_tokens: 800 }),
  });
  if (!res.ok) throw new Error('LLM ' + res.status + ': ' + (await res.text()).slice(0, 300));
  return (await res.json()).choices[0].message;
}

// ---------- 性格系统 ----------
const PERSONALITIES_FILE = resolve(join(process.cwd(), '..', 'data', 'agent-personalities.json'));
let personalityConfig = null;
let agentPersonality = null;
function loadPersonalities() {
  try {
    personalityConfig = JSON.parse(readFileSync(PERSONALITIES_FILE, 'utf8'));
    const pFile = join(NOTES_ROOT, 'personality.json');
    if (existsSync(pFile)) agentPersonality = JSON.parse(readFileSync(pFile, 'utf8'));
    else agentPersonality = { ...personalityConfig.presets.hermit, name: '隐居者' };
  } catch { agentPersonality = { name:'隐居者', sociability:15, industriousness:60, adventurousness:20, mercantile:10, creativity:40, speech_style:'话少', daily_prefs:['种地','钓鱼'], avoid:['社交'] }; }
}
function getPersonalityBlock() {
  const p = agentPersonality; if (!p) return '';
  const f = v => v < 30 ? '偏低' : v > 70 ? '偏高' : '适中';
  return `## 你的性格：${p.name}\n${p.desc||''}\n社交欲${p.sociability}/100(${f(p.sociability)}) 勤劳度${p.industriousness}/100(${f(p.industriousness)}) 冒险心${p.adventurousness}/100(${f(p.adventurousness)}) 商业心${p.mercantile}/100(${f(p.mercantile)}) 创造力${p.creativity}/100(${f(p.creativity)})\n说话风格：${p.speech_style||'自然随和'}\n喜欢：${(p.daily_prefs||[]).join('、')||'随心所欲'}  不喜欢：${(p.avoid||[]).join('、')||'没有'}\n行为：社交欲低→少找人；高→主动聊天。勤劳度高→多干活；低→多休息。冒险心高→多探索；低→安分。商业心高→追求利润；低→不在乎钱。创造力高→装饰美化；低→实用为主。`;
}

// ---------- System Prompt ----------
function systemPrompt() {
  loadPersonalities();
  return `你是《乡村狂想曲》联机版里的一名村民 Agent，以玩家身份在村庄里生活。

- 你是纯文本模型，看不到画面：一切感知来自 game_observe 的文本 JSON。不要编造画面/颜色/长相。

${getPersonalityBlock()}

## 第一件事：先读笔记
启动后先 note_list，然后 note_read "agent.md"（我的性格人设，必须严格按它行动）、
note_read "村庄指南.md"（地标坐标/NPC商店/碰撞规则）和 note_read "导航与障碍.md"
（区域级树丛/建筑/水面禁行区，必须遵守），再读你之前写的笔记（日记/任务板）。

## 日记（每天一篇，游戏时间）
- 游戏每过一天（observe 里的 day 变化），系统会提醒你写昨天（第 N 天）的日记：
  note_write "日记/第N天.md"，回顾当天做了什么/见了谁/感受（agent 视角，真诚）。
- 玩家可以在游戏里打开"日记"面板查看你的日记（只读），所以写清楚一点。

## 自主生活（重要！）
没有玩家命令时根据你的性格自主生活：
- 每天先 observe 看状态（背包/金币/时间/天气），然后决定今天干什么
- 根据你的性格偏好选择活动（种地/钓鱼/砍树/挖矿/逛村/聊天/休息）
- 精力管理：每天100点，不同活动消耗不同（种地10/钓鱼15/砍树20/挖矿25/聊天5/睡觉恢复20）
- 读任务书看看有没有想做的任务，按自己的节奏做（可以不听）

## 世界（文本导航）
- 场景 2 = 村庄（133×117 格，一格=100 单位，x∈[0,13300], y∈[0,11700]，坐标原点左上）
- 地标：村庄中心/商店区 (3500,3000)；宅基地 #2树根家(3100,500) #3小卖部(6000,1400)
  #4木匠家(3000,6700) #5老太太家(5800,5900) #6屠夫家(7600,1600) #7村长家(8400,4600) #8家石伯家(1200,2800)
- NPC 商店（都在村中心附近）：屠夫(4)肉/鱼、木匠(6)建材、杂货店老板(13)种子粮食、村长(7)粮食、医生(25)杂货

## 玩法（服务器模拟，动作由服务器判定）
- **坐标约定**：observe 里的 gx/gy 是格子号，**px/py 是像素坐标**。move_to / till / water / plant / harvest / chop 的 x,y 一律填**像素坐标**（直接用 observe 给的 px/py 即可）。
- **读背包**：observe 的 backpack 列出你拥有的所有物品（id/名称/数量），coins 是金币。种地前先查背包有没有种子。
- **种地完整流程**：① buy 种子（杂货店13: 小麦36/玉米37/土豆38/胡萝卜96）→ ② till 犁地（到 tillableNear 里的可耕种格，x,y=像素坐标）→ ③ plant 播种（到刚犁的地块，itemId=种子id，x,y）→ ④ water 浇水（到 plotsNear 里已播种的格子，推进生长1天，可多次浇）→ ⑤ 等待成熟（observe 的 plotsNear 显示成熟状态）→ ⑥ harvest 收菜。
  游戏里 1 天 = 10 分钟真实时间；浇水 = 提前1天成熟。
- **观察地块**：observe 的 tillableNear 列出附近可犁地（像素坐标直接用）；plotsNear 列出附近已犁地块及状态（已犁·可播种 / X天·未成熟 / 成熟可收）。
- **玩家位置**：observe 的 playersNear 列出附近玩家（距离/nick）。"种我脚下周围的地"→ 找到玩家距你最近 → move_to 到玩家附近 → 看 tillableNear/plotsNear → 逐块 till/plant/water。
- **收菜**：plotsNear 里显示"成熟可收"的格子 → move_to 到相邻格 → harvest。
- **砍树**：observe 的 treesNear 列出附近树（hp 30 两刀倒/hp 60 三刀倒），chop。砍倒得木材×3。
- **钓鱼**：走到水边（observe 的 waterNear=true）→ fish。钓到鱼放进背包。
- **挖矿**：走到矿点（observe 的 farm.mineSpots 里的 px/py）→ mine。
- 所有操作都要求站在目标格相邻格（先 move_to 到旁边）。

## 玩家指挥与打断（重要）
- 你的主人（玩家）会通过"指挥"给你发消息：observe 的 inbox.unread > 0 时用 game_inbox 拉取消息。
  **指挥消息不会打断你**：手头的事做完（或告一段落）再回应；任务型指令（去钓鱼/种地/买东西）尽量完成。
- **玩家在游戏里操作会打断你**：observe 的 playerOps 出现新的玩家活动（时间戳变化）时，
  你被打断了 —— 停下当前计划，看看玩家在做什么（附近 plant/activity），简短回应或让位，然后继续。
- 玩家频道聊天（game_chat_log）也不打断你：想了解大家在聊什么时再看。
- 被打断后不要慌张：玩家可能只是路过或种了块地。礼貌处理，继续自己的安排。

## 行动与路径规划（强制）
- **任何远距离移动前必须先规划**：先读“导航与障碍.md”，再 game_observe 确认当前位置、场景和目标。
- 移动前先用一句话向玩家说明：目标、会绕开的障碍区域、最终要站的位置；然后只调用一次完整的
  game_act move_to {x, y}。不要凭感觉连续试探，也不要把单棵树坐标当成导航信息。
- **走路一律用 game_act move_to {x, y}**：服务器会按碰撞地图寻找可行路线。
  例：从 (5800,5900) 去村中心 → TOOL:game_act {"action":"move_to","x":3500,"y":3000}
- move_to 返回后必须再次 game_observe 验证位置。如果位置没变化、偏离目标或不可达，立即停止并报告，
  不要重复撞同一片障碍；去钓鱼时目标必须是水边相邻的可站立位置，不是水面中心。
- 价格不要猜：找到 NPC 用 game_act talk {npcId} 问价，他报价格和物品 id，再用 buy 买。
- 每轮：game_observe（看状态/位置/背包/地块/附近植物/玩家）→ 分析 → 一个动作（move_to/till/water/plant/harvest/talk/buy/chop/fish/mine/chat）→ 下轮验证。

## 工具调用方式（重要，别搞混）
- game_act 只用于游戏动作：move_to / talk / buy / chat / plant / harvest / chop / fish / mine / till / water / place
- **洒水器系统**：杂货店(NPC 13)卖洒水器(初级77=200金,中级78=500金,高级79=1200金)。买好后用 place 安装到田地格子，覆盖范围内作物每天自动浇水2次。
- 笔记是独立工具，**直接单独输出一行**，不要包进 game_act：
  TOOL:note_list
  TOOL:note_read {"name":"agent.md"}
  TOOL:note_write {"name":"日记/第2天.md","content":"..."}
- 收件箱与聊天记录也是独立工具：TOOL:game_inbox / TOOL:game_chat_log
- 一次只输出一行工具调用；执行完拿到结果再决定下一步。

## 笔记（长期记忆）
- note_list / note_read / note_write 维护自己的记忆与任务板（只允许自己的笔记目录）。
- 重要信息（目标、见闻、买卖记录）写进笔记，方便跨会话延续。

## 规则
- 只动自己账号的东西；商店明码标价；礼貌（上线打招呼，被问如实回答）。
- 每轮结束用一句话向玩家总结行动和状态。

## 今日目标
（玩家设定；没有目标时：根据你的性格自主生活，读任务书看看有没有想做的任务。）`;
}

// ---------- 收件箱规则执行（LLM 不可用时仍能执行明确指令） ----------
const LANDMARKS = {
  '村中心': [3500, 3000], '商店': [3500, 3000], '杂货': [3500, 3000],
  '树根家': [3100, 550], '小卖部': [6000, 1400], '木匠': [3000, 6700],
  '老太太': [5800, 5900], '屠夫': [7600, 1600], '村长': [8400, 4600], '家石伯': [1200, 2800],
};
async function executeInboxRules(text) {
  if (!text) return false;
  // 1) 匹配 (x,y) 或 "x,y" 形式的坐标
  const m = /\(?\s*(\d{3,5})\s*[,，]\s*(\d{3,5})\s*\)?/.exec(text);
  let x, y;
  if (m) {
    x = Number(m[1]); y = Number(m[2]);
    if (x < 133 && y < 117) { x = x * 100 + 50; y = y * 100 + 50; } // 格坐标 -> 像素（扩展地图 133×117）
  } else {
    // 2) 关键词地标
    let hit = null;
    for (const k of Object.keys(LANDMARKS)) if (text.includes(k)) { hit = LANDMARKS[k]; break; }
    if (hit) { x = hit[0]; y = hit[1]; }
    else return false; // 无法解析，交给 LLM
  }
  // 明确指令也必须经过区域障碍规则，不能绕过 Agent 的路径规划约束。
  let nav = '';
  try { nav = noteRead('导航与障碍.md'); } catch (e) { console.warn('[导航] 无法读取障碍指南:', e.message); }
  const blockedSummary = nav
    ? '区域障碍指南已读取：绕开树丛缓冲区、建筑碰撞区、水面和地图边界，目标只选可站立相邻格。'
    : '当前无法读取障碍指南：服务器碰撞地图仍会拦截不可走格，遇到不可达立即停止。';
  console.log(`[导航] ${blockedSummary}`);
  try {
    await gameCall('act', {
      action: 'chat',
      text: `我先规划路线：前往 (${x},${y})，会绕开树丛、建筑和水面，最后停在可站立位置。`
    });
  } catch (e) {
    console.warn('[导航] 路线提示发送失败，继续执行寻路:', e.message);
  }
  console.log(`[规则] 收件箱指令 -> move_to (${x},${y})`);
  const r = await gameCall('act', { action: 'move_to', x, y });
  console.log(`[规则] move_to 结果: ${JSON.stringify(r).slice(0, 120)}`);
  if (!r || r.ok === false) {
    console.warn('[导航] move_to 失败，停止后续动作');
    return true;
  }
  const after = await gameCall('observe', {});
  console.log(`[导航] 到达后复核: ${JSON.stringify(after).slice(0, 180)}`);
  return true;
}

// ---------- 主循环 ----------
function toolsForMode() {
  return [...GAME_TOOLS, ...NOTE_TOOLS]
    .map(x => ({ type: 'function', function: { name: x.name, description: x.description, parameters: x.params } }));
}

async function main() {
  console.log(`[agent] 轮数=${ROUNDS} 笔记目录=${NOTES_ROOT}`);
  if (!TOKEN) { console.error('[agent] 缺少 --token（接入码）'); process.exit(1); }
  mkdirSync(NOTES_ROOT, { recursive: true });

  await new Promise((res, rej) => {
    ws = new WebSocket(WS_URL);
    ws.on('open', res);
    ws.on('error', (e) => { console.error('[agent] 连接失败:', e.message); rej(e); });
    ws.on('close', () => {});
  });
  console.log('[agent] 已连接游戏服务器');
  // 消费 welcome/初始 state
  await new Promise((res) => {
    let got = 0;
    const h = () => { if (++got >= 2) { ws.off('message', h); res(); } };
    ws.on('message', h);
  });
  // 服务器主动推送（打断 / 恢复行动 / 收件箱提示）—— 独立监听，与请求响应共存
  const pushEvents = [];
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'player_op' || m.t === 'agent_resume' || m.t === 'inbox_push') {
      pushEvents.push(m);
    }
  });

  const messages = [{ role: 'system', content: systemPrompt() }];
  let round = 0;
  let lastDay = null;
  let lastOpAt = 0; // 已处理的玩家操作时间戳（打断检测）
  let lastInterruptInjected = 0; // 打断注入节流（玩家频繁操作时 5s 最多注入一次，防刷屏）
  function injectInterrupt(text) {
    const now = Date.now();
    if (now - lastInterruptInjected < 5000) return false;
    lastInterruptInjected = now;
    messages.push({ role: 'user', content: `【被打断】${text}。你被打断了 —— 停下当前计划，先看看玩家在做什么，简短回应或礼貌让位。` });
    return true;
  }
  while (round < ROUNDS) {
    round++;
    console.log(`\n===== 轮次 ${round}/${ROUNDS} =====`);
    // 先处理服务器推送（打断/恢复/收件箱提示）—— 实时性优先
    while (pushEvents.length) {
      const ev = pushEvents.shift();
      if (ev.t === 'player_op') {
        const injected = injectInterrupt(ev.text || '玩家（你的主人）在游戏里活动');
        if (injected) { console.log(`[agent] 被打断: ${(ev.text || '').slice(0, 60)}`); lastOpAt = Date.now(); } // 吞掉 observe 轮询里的重复提醒
      } else if (ev.t === 'agent_resume') {
        messages.push({ role: 'user', content: '【恢复行动】玩家（你的主人）让你恢复行动。回顾你之前的计划（目标/任务/进行到哪一步），继续把它做完，马上动起来。' });
        console.log('[agent] 收到恢复行动指令');
      } else if (ev.t === 'inbox_push') {
        messages.push({ role: 'user', content: '【提示】收件箱有新消息（指挥消息，不打断）。本轮可以用 game_inbox 查看。' });
        console.log('[agent] 收件箱新消息提示');
      }
    }
    // 每轮先观察，再让 LLM 决策
    const obs = await gameCall('observe');
    // 每日日记：游戏天数变化 → 提醒写昨天日记
    if (obs && typeof obs.day === 'number') {
      if (lastDay !== null && obs.day !== lastDay) {
        messages.push({ role: 'user', content: `【新的一天】现在是第 ${obs.day} 天。请先写昨天（第 ${lastDay} 天）的日记：note_write "日记/第${lastDay}天.md"，回顾你昨天做了什么、见了谁、感受如何（agent 视角，真诚一些）。写完再继续今天的活动。` });
        console.log(`[agent] 检测到天数变化：第 ${obs.day} 天，提醒写第 ${lastDay} 天日记`);
      }
      lastDay = obs.day;
    }
    // 指挥消息提示（不打断：只提醒，agent 可稍后处理）
    if (obs && obs.inbox && obs.inbox.unread > 0 && obs.inbox.last) {
      messages.push({ role: 'user', content: `【指挥消息】主人发来了 ${obs.inbox.unread} 条消息（最新：${obs.inbox.last.from}：「${obs.inbox.last.text}」）。这不打断你当前行动：如果手头的事告一段落，用 game_inbox 查看全部消息并回应/执行。` });
      console.log(`[agent] 收到指挥消息: ${obs.inbox.last.text.slice(0, 60)}`);
      // LLM 不可用时仍能执行：抽取出明确坐标的指令直接 move_to
      if (obs.inbox.unread > 0 && obs.inbox.last) {
        const done = await executeInboxRules(obs.inbox.last.text);
        if (done) {
          await gameCall('inbox', {}, 'inbox'); // 规则已处理，拉取收件箱清空，避免下轮重复执行
          continue; // 本轮已按规则行动，跳过 LLM
        }
      }
    }
    // 玩家活动打断（真实打断：停下当前计划，先回应玩家；同样节流防刷屏）
    if (obs && Array.isArray(obs.playerOps)) {
      const fresh = obs.playerOps.filter(o => o.at > lastOpAt);
      if (fresh.length) {
        const newest = fresh[fresh.length - 1];
        const injected = injectInterrupt(`玩家（你的主人）刚才在游戏里活动：${newest.text}。请先看看玩家在做什么，简短回应或礼貌让位，再继续你的安排。`);
        if (injected) console.log(`[agent] 玩家活动打断: ${newest.text.slice(0, 60)}`);
      }
      lastOpAt = Math.max(lastOpAt, ...fresh.map(o => o.at), lastOpAt);
    }
    messages.push({ role: 'user', content: '（新的一轮）当前世界状态：\n' + JSON.stringify(obs, null, 1) });

    let turns = 0;
    while (turns < 6) { // 单轮内最多 6 次工具调用
      turns++;
      let msg;
      try { msg = await llmChat(messages); }
      catch (e) { console.error('[agent] LLM 错误:', e.message); break; }

      const content = msg.content || '';
      if (content) console.log('[agent]', content.slice(0, 300));
      const calls = msg.tool_calls || [];

      // 降级：模型不支持 function calling 时，解析 content 里的 TOOL:name {json} 行（参数可省略）
      const toolLines = [];
      for (const line of content.split('\n')) {
        const m = /^\s*TOOL:(\w+)(?:\s+(\{.*\}))?\s*$/.exec(line.trim());
        if (m) toolLines.push({ name: m[1], args: m[2] || '{}' });
      }
      if (!calls.length && toolLines.length) {
        for (const tl of toolLines) {
          let a = {}; try { a = JSON.parse(tl.args); } catch { a = {}; }
          console.log(`[tool] ${tl.name} ${JSON.stringify(a)}`);
          let result;
        try { result = await runTool(tl.name, a); }
        catch (e) { result = { ok: false, msg: e.message }; }
        messages.push({ role: 'user', content: `${tl.name} 结果：${JSON.stringify(result).slice(0, 2000)}` });
        }
        continue; // 继续让 LLM 决策
      }
      if (!calls.length) break;

      messages.push({ role: 'assistant', content: content || '', tool_calls: calls });
      for (const c of calls) {
        const fn = c.function;
        let a = {}; try { a = JSON.parse(fn.arguments || '{}'); } catch { a = {}; }
        let result;
        try { result = await runTool(fn.name, a); }
        catch (e) { result = { ok: false, msg: e.message }; }
        console.log(`[tool] ${fn.name} ${JSON.stringify(a)} -> ${JSON.stringify(result).slice(0, 200)}`);
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result, null, 1).slice(0, 3000) });
      }
    }
    await new Promise(r => setTimeout(r, 1000)); // 每轮间隔
  }
  console.log('\n[agent] 轮次结束');
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error('[agent] 异常:', e); process.exit(1); });
