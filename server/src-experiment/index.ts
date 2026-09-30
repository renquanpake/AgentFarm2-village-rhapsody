// index.ts —— 服务端入口：HTTP 静态 + WebSocket（自研，C3 协议）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { world } from './world.ts';
import { STATIC_DIR, scenesById, DOCS_DIR, obsidianDir } from './config.ts';
import { acceptFirst } from './tasks.ts';
import { attachAgentApi } from './agentapi.ts';
import { saveGame } from './save.ts';

const PORT = +(process.env.PORT || 8080);

// —— 静态文件（生产：server/public/client 由 vite build 产出；开发用 vite dev） ——
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.map': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.ttf': 'font/ttf'
};
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  // 规则文档（外部 Agent 获取游戏规则：http://<host>:8080/docs/游戏规则-Agent版.md）
  if (p.startsWith('/docs/')) {
    const f = path.resolve(DOCS_DIR, '.' + p.slice('/docs'.length));
    if (f.startsWith(path.resolve(DOCS_DIR)) && fs.existsSync(f) && !fs.statSync(f).isDirectory()) {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      fs.createReadStream(f).pipe(res);
      return;
    }
    res.writeHead(404); res.end('Not Found'); return;
  }
  if (!fs.existsSync(STATIC_DIR)) { res.writeHead(503); res.end('静态资源未构建：先 npm run build（开发请用 vite dev :5173）'); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(STATIC_DIR, '.' + p);
  if (!file.startsWith(path.resolve(STATIC_DIR))) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not Found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws' });
// 档2：外部 Agent 接入通道（独立端口 8081，避免共享 upgrade 竞争）
attachAgentApi(world);

// 单发
world.io = (target: any, msg: any) => {
  if (target && target.readyState === 1) target.send(JSON.stringify(msg));
};
// 广播
world.broadcast = (msg: any, room?: any) => {
  for (const [ws] of world.clients) {
    const c = world.clients.get(ws)!;
    const a = world.actors.get(c.actorId);
    if (!room || (a && a.sceneId === room.sceneId && a.instanceId === room.instanceId)) world.io!(ws, msg);
  }
};

// 文件级调试日志（stdout 缓冲不影响）
const dbgFd = fs.openSync(path.join(import.meta.dirname, 'debug.log'), 'a');
function dbg(s: string) { try { fs.writeSync(dbgFd, `[${new Date().toISOString()}] ${s}\n`); } catch { } }

wss.on('connection', ws => {
  dbg('connection 建立');
  ws.on('message', raw => {
    dbg('message: ' + String(raw).slice(0, 100));
    console.log('[msg]', String(raw).slice(0, 80));
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.type === 'join') {
      const a = world.join(ws, m);
      acceptFirst(world, a);
      // 把场景→地图/名字映射发给客户端
      world.io!(ws, { type: 'mapNames', map: scenesById });
    }
    world.handle(ws, m);
  });
  ws.on('close', () => {
    world.clients.delete(ws);
  });
  ws.on('error', () => world.clients.delete(ws));
});

setInterval(() => {
  try { world.tick(100); } catch (e) { console.error('[tick] 异常（已隔离，不影响服务器）：', e); }
}, 100);
setInterval(() => saveGame(world), 60000);

// Agent 大脑的任何异常不得杀死服务器（D4 看门狗）
process.on('uncaughtException', e => console.error('[uncaught] 已捕获（服务器继续运行）：', e?.message));
process.on('unhandledRejection', e => console.error('[rejection] 已捕获（服务器继续运行）：', e));

// 分发游戏规则文件（外部 Agent 学习用）：游戏目录 docs/ 静态可下载 + 可选同步 Obsidian
try {
  const rulesFile = path.join(DOCS_DIR, '游戏规则-Agent版.md');
  const od = obsidianDir();
  if (od && fs.existsSync(rulesFile)) {
    fs.mkdirSync(od, { recursive: true });
    fs.copyFileSync(rulesFile, path.join(od, 'AgentFarm-游戏规则.md'));
    console.log('[rules] 已同步游戏规则到 Obsidian：', od);
  }
} catch (e: any) { console.error('[rules] Obsidian 同步失败：', e?.message); }

server.listen(PORT, () => {
  console.log(`🌾 AgentFarm 服务端已启动：http://127.0.0.1:${PORT}  (WS: /ws)`);
  console.log(`   开发模式请另开 vite dev → http://127.0.0.1:5173`);
  console.log(`   📖 规则文档：http://127.0.0.1:${PORT}/docs/游戏规则-Agent版.md`);
});