// index.ts —— 服务端入口（TS 七模块架构）：HTTP + WS 双通道 + 周期任务 + 隧道
// 行为基准：legacy server/afserver.mjs（已冻结）；协议与客户端完全等价。
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { App } from './app.ts';
import { PORT, WS_HEARTBEAT_MS, BACKUP_SCRIPT, DATA_DIR, SAVES_DIR } from './config.ts';
import { createHttpHandler } from './gateway/http.ts';
import { gameConn, agentConn } from './gateway/ws.ts';
import { startTunnel, stopTunnel } from './gateway/tunnel.ts';
import { sprinklerAutoWater } from './world/farm.ts';
import { checkAutoDmUnlock, cleanupDmMaps } from './world/social.ts';
import { runLocalBackup, needsBackup } from './persistence/backup.ts';
import { runMerchantCycle } from './market/merchants.ts';
import { economyReport } from './market/economy.ts';
import { advanceGameDay } from './world/calendar.ts';
import { runNpcSchedules } from './world/schedule.ts';
import { produceFromAnimals, worldAnimals } from './world/livestock.ts';
import { ANIMALS } from './world/livestock.ts';
import { currentGameDay } from './world/calendar.ts';
import { settleFestival, snapshotFestivalDecor, activeFestival } from './world/festival.ts';

const app = new App();
const server = http.createServer(createHttpHandler(app));
// maxPayload 8MB：单条 WS 消息超过即断开，防内存炸弹
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

// ---------- WS 心跳保活（防隧道/NAT 下空闲连接被中间设备掐断） ----------
type AliveWS = import('ws').WebSocket & { isAlive?: boolean };
function onPong(this: unknown) { /* handler 绑定见 setupAlive */ }
void onPong;
const wsHeartbeatTimer = setInterval(() => {
  let dead = 0, pinged = 0;
  for (const raw of wss.clients) {
    const ws = raw as AliveWS;
    if (ws.isAlive === false) { dead++; try { ws.terminate(); } catch { /* ignore */ } continue; }
    ws.isAlive = false;
    try { ws.ping(); pinged++; } catch { /* ignore */ }
  }
  if (process.env.AF_DEBUG) console.log(`[hb] pinged=${pinged} dead=${dead}`);
}, WS_HEARTBEAT_MS);
if (wsHeartbeatTimer.unref) wsHeartbeatTimer.unref();

server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const setupAlive = (ws: import('ws').WebSocket, handler: (ws: import('ws').WebSocket) => void) => {
    const w = ws as AliveWS;
    w.isAlive = true;
    ws.on('pong', () => { w.isAlive = true; });
    handler(ws);
  };
  if (u.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => setupAlive(ws, (w) => gameConn(app, w, u)));
  } else if (u.pathname === '/agent') {
    wss.handleUpgrade(req, socket, head, (ws) => setupAlive(ws, (w) => agentConn(app, w, u)));
  } else {
    socket.destroy();
  }
});

// D4 看门狗：任何模块异常不得杀死服务器（legacy 无全局捕获，A1 起补齐可观测性）
import { log } from './logging.ts';
process.on('uncaughtException', e => {
  log.write('error', 'watchdog', 'uncaughtException（已捕获，服务器继续运行）', { message: (e as Error)?.message || String(e) });
});
process.on('unhandledRejection', e => {
  log.write('error', 'watchdog', 'unhandledRejection（已捕获，服务器继续运行）', { message: (e as Error)?.message || String(e) });
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log(`  AgentFarm2 服务器就绪（TS 七模块）`);
  console.log(`  本地地址: http://127.0.0.1:${PORT}/`);
  console.log(`  存档位: ${app.state.currentSlot}`);
  console.log('========================================');
  // 洒水器自动浇水：每 5 分钟检查一次
  setInterval(() => {
    const { watered, updates } = sprinklerAutoWater(app.state, app.tables);
    if (watered > 0) {
      app.log.append('crop.autowatered', null, { updates });
      console.log(`[sprinkler] 自动浇水 ${watered} 株作物`);
    }
  }, 5 * 60 * 1000);
  // DM 自动解锁：每 15s 检查同场景共处是否满 10 分钟
  setInterval(() => checkAutoDmUnlock(app.state, app.agentSockets), 15 * 1000);
  // 每 5 分钟清理 DM 相关内存（lastMeetBroadcast / sceneTogether 空壳）
  setInterval(() => cleanupDmMaps(app.state), 5 * 60 * 1000);
  // 存档自动备份：每 10 分钟 git commit + push（AF_NO_GIT=1 跳过）
  if (!process.env.AF_NO_GIT) {
    setInterval(() => {
      try {
        if (existsSync(BACKUP_SCRIPT)) {
          spawn(process.execPath, [BACKUP_SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] })
            .on('close', (code) => { if (code !== 0 && process.env.AF_DEBUG) console.warn('[backup] exit', code); });
        }
      } catch { /* ignore */ }
    }, 10 * 60 * 1000);
  }
  // 本地备份（设计 M6.3）：存档 + 事件库 每日备份到 data/backups/，保留 30 天
  const localBackup = () => {
    try { runLocalBackup(DATA_DIR, SAVES_DIR, app.state.currentSlot, app.db); } catch (e) { console.warn('[backup] 本地备份失败：', (e as Error).message); }
  };
  if (needsBackup(`${DATA_DIR}/backups`, 24 * 3600 * 1000)) localBackup();
  setInterval(() => {
    if (needsBackup(`${DATA_DIR}/backups`, 24 * 3600 * 1000)) localBackup();
  }, 24 * 3600 * 1000);
  // B2 NPC 商人决策周期：1 游戏小时（growDayMs/24，下限 15s，历法 B8 接入前用现实时间控频）
  if (!process.env.AF_NO_MERCHANTS) {
    const hourMs = Math.max(15_000, Math.floor(app.growDayMs / 24));
    setInterval(() => {
      try {
        const n = runMerchantCycle(app);
        if (n > 0) console.log(`[merchant] 决策周期：${n} 家商人挂出意向单`);
      } catch { /* 看门狗兜底，不杀服 */ }
    }, hourMs);
  }
  // B3 货币治理监控：每 1 游戏日算一次通胀指数 + 货币总量，告警（回收档位由 feeMultiplier 供 B8/集市接入）
  if (!process.env.AF_NO_MERCHANTS) {
    const dayMs = Math.max(60_000, app.growDayMs);
    setInterval(() => {
      try {
        const rep = economyReport(app);
        if (rep.alerts.length) for (const a of rep.alerts) console.warn(`[economy] ${a}`);
      } catch { /* 看门狗兜底 */ }
    }, dayMs);
  }
  // B8 历法/天气：日切换推进器（每 30s 或 1/4 游戏日取小者检查；日效应幂等）
  setInterval(() => {
    try {
      const r = advanceGameDay(app);
      if (r.advanced) {
        console.log(`[calendar] 游戏日推进至 ${r.day}（${r.events} 事件）`);
        // B11：节日日结算 + 装饰赛快照（节日日每 1/4 游戏日刷新一次分）
        settleFestival(app);
        if (activeFestival(app)) snapshotFestivalDecor(app);
      }
    } catch { /* 看门狗兜底 */ }
  }, Math.min(30_000, Math.floor(app.growDayMs / 4)));
  // B7 NPC 日程：每 1 游戏小时（growDayMs/24，下限 60s）调度一次（AF_NO_NPC_SCHED=1 跳过）
  if (!process.env.AF_NO_NPC_SCHED) {
    const hourMs = Math.max(60_000, Math.floor(app.growDayMs / 24));
    setInterval(() => {
      try { runNpcSchedules(app); } catch { /* 看门狗兜底 */ }
    }, hourMs);
    try { runNpcSchedules(app); } catch { /* 启动首排 */ }
  }
  // B9 畜牧产出：每 1/4 游戏日检查一次（周期产出 + 品质衰减；跨日才实际产出）
  if (!process.env.AF_NO_NPC_SCHED) {
    const qDayMs = Math.max(15_000, Math.floor(app.growDayMs / 4));
    setInterval(() => {
      try {
        const day = currentGameDay(app.state);
        const produced = produceFromAnimals(app.state, app.tables, day);
        for (const p of produced) {
          app.log.append('animal.produced', p.owner, { uid: p.owner, uId: p.uId, itemId: p.itemId, quality: p.quality, qty: p.quality === 'gold' ? 2 : 1 });
          const an = worldAnimals(app.state).find(a => a.uId === p.uId);
          const nm = an ? ANIMALS[an.animalId]?.name : '动物';
          console.log(`[livestock] ${p.owner} 的${nm} 产出（${p.quality}）`);
        }
      } catch { /* 看门狗兜底 */ }
    }, qDayMs);
  }
  // 自动启动内网穿透（AF_NO_TUNNEL=1 跳过，避免隧道抢占本地连接干扰测试）
  if (!process.env.AF_NO_TUNNEL) startTunnel(app, PORT);
});

// 退出清理：刷盘未落存档 + 杀隧道 + 杀托管 agent 子进程 + 关事件库
process.on('exit', () => {
  app.state.flushPendingPersist();
  stopTunnel(app);
  app.managed.killAll();
  app.close();
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stopTunnel(app);
    app.managed.killAll();
    app.state.flushPendingPersist();
    app.close();
    process.exit(0);
  });
}
