// AgentFarm2 游戏 MCP server（stdio）—— 供 Hermes / OpenClaw 等 agent 框架接入
// 用法: node agent-mcp.mjs --token <AGENT_TOKEN>
//   或 环境变量 AF_AGENT_TOKEN
// 工具:
//   game_observe()            查看世界状态（位置/时间/金币/背包/NPC/在线玩家）
//   game_act(action, ...)     执行行动: move(dir) / buy(itemId,count) / chat(text)
//   game_chat(text)           说话（广播）
import WebSocket from 'ws';

const args = process.argv.slice(2);
const argVal = (k) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : null);
const token = argVal('--token') || process.env.AF_AGENT_TOKEN || '';
const url = argVal('--url') || `ws://127.0.0.1:8080/agent?token=${token}`;

let ws = null;
let msgSeq = 0;
let lastFramed = false; // 最近请求的 framing 类型（响应跟随）

function sendFrame(obj) {
  const s = JSON.stringify(obj);
  let buf;
  if (lastFramed) {
    buf = Buffer.from(`Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`, 'utf8');
  } else {
    buf = Buffer.from(s + '\n', 'utf8'); // 裸 JSON + 换行（与 hermes 客户端对称）
  }
  dbg('>> ' + s.slice(0, 160));
  process.stdout.write(buf);
}

// ---------- stdin 解析（MCP stdio framing） ----------
let inputBuf = Buffer.alloc(0);
import { appendFileSync } from 'node:fs';
const DBG = 'D:/agent社区/AgentFarm2/tools/_mcp_debug.log';
function dbg(s) { try { appendFileSync(DBG, new Date().toISOString() + ' ' + s + '\n'); } catch (e) {} }
dbg('=== MCP server 启动 (pid ' + process.pid + ') ===');
function handleJson(obj, framed) {
  lastFramed = framed;
  dbg('msg: ' + JSON.stringify(obj).slice(0, 200));
  handle(obj).catch(e => dbg('handle err: ' + e.message));
}
process.stdin.on('data', (chunk) => {
  inputBuf = Buffer.concat([inputBuf, chunk]);
  for (;;) {
    // 标准 framing：Content-Length: N\r\n\r\n{json}
    const h = inputBuf.indexOf('\r\n\r\n');
    if (h >= 0) {
      const m = /Content-Length:\s*(\d+)/i.exec(inputBuf.slice(0, h).toString('utf8'));
      if (m) {
        const len = parseInt(m[1], 10);
        const total = h + 4 + len;
        if (inputBuf.length >= total) {
          const body = inputBuf.slice(h + 4, total).toString('utf8');
          inputBuf = inputBuf.slice(total);
          try { handleJson(JSON.parse(body), true); } catch (e) { dbg('parse err: ' + e.message); }
          continue;
        }
        return;
      }
    }
    // 兼容：裸 JSON（hermes 的 stdio 客户端不带 header，直接写 JSON）
    const s = inputBuf.toString('utf8').trim();
    if (s) {
      try {
        const obj = JSON.parse(s);
        inputBuf = Buffer.alloc(0);
        handleJson(obj, false);
        continue;
      } catch (e) {
        return; // 不完整，等更多数据
      }
    }
    return;
  }
});

async function handle(msg) {
  if (msg.method === 'initialize') {
    sendFrame({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'agentfarm2-game', version: '0.1.0' },
    } });
  } else if (msg.method === 'notifications/initialized' || msg.method === 'ping') {
    // noop
  } else if (msg.method === 'tools/list') {
    sendFrame({ jsonrpc: '2.0', id: msg.id, result: { tools: [
      {
        name: 'game_observe',
        description: '查看当前游戏世界状态：场景/位置/天数/时间/天气/金币/背包物品/NPC好感/在线玩家。返回 JSON。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'game_act',
        description: '在游戏世界里执行行动。action 可选: "move" 走动一格(dir: up/down/left/right)；"buy" 从商店购买物品(itemId: 物品编号, count: 数量)；"chat" 说话(text)。返回执行结果。',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['move', 'buy', 'chat'] },
            dir: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
            itemId: { type: 'number' },
            count: { type: 'number' },
            text: { type: 'string' },
          },
          required: ['action'],
        },
      },
      {
        name: 'game_chat',
        description: '在游戏里说一句话（广播给所有在线玩家）。',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      },
    ] } });
  } else if (msg.method === 'tools/call') {
    const { name, arguments: a = {} } = msg.params;
    let text;
    try {
      if (name === 'game_observe') {
        text = JSON.stringify(await gameCall('observe'), null, 1);
      } else if (name === 'game_act') {
        text = JSON.stringify(await gameCall('act', a), null, 1);
      } else if (name === 'game_chat') {
        text = JSON.stringify(await gameCall('act', { action: 'chat', text: a.text }), null, 1);
      } else {
        text = 'unknown tool: ' + name;
      }
    } catch (e) {
      text = 'ERROR: ' + e.message;
    }
    sendFrame({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } });
  }
}

// ---------- 游戏通道调用（同步等一次响应） ----------
function gameCall(t, params = {}) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== 1) { resolve({ ok: false, msg: '游戏连接未就绪' }); return; }
    const onMsg = (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'result' || m.t === 'state') { cleanup(); resolve(m); }
    };
    const cleanup = () => { ws.off('message', onMsg); };
    ws.on('message', onMsg);
    try { ws.send(JSON.stringify({ t, ...params })); } catch (e) { cleanup(); resolve({ ok: false, msg: '发送失败: ' + e.message }); }
    setTimeout(() => { cleanup(); resolve({ ok: false, msg: '游戏响应超时' }); }, 10000);
  });
}

// ---------- 连接游戏服务器 ----------
ws = new WebSocket(url);
ws.on('open', () => console.error('[mcp] 已连接游戏服务器'));
ws.on('close', () => { console.error('[mcp] 游戏连接断开'); setTimeout(() => process.exit(1), 100); });
ws.on('error', (e) => console.error('[mcp] ws 错误:', e.message));
console.error('[mcp] AgentFarm2 游戏 MCP server 启动' + (token ? '' : '（警告：未提供 --token）'));
