// agentapi.ts —— 档2 外部 Agent 接入通道（学习 CatPaw bridge 的"投递任务→外部执行→回动作"模型）
// 端点：WS ws://<host>:8081/agent（独立端口，避免与游戏 /ws 共享 upgrade 竞争），协议见 docs/AgentFarm-Agent接入.md
// 生命周期：玩家在游戏里生成 token → 外部 Agent 程序连上 /agent → agent_join(带 token) 绑定角色
//          → 服务器每 4s 推 observe（世界状态/视野） → 程序回 act（意图原语） → 服务器校验执行 → 断开回落行为树托管
import http from 'node:http';
import { WebSocketServer } from 'ws';
import type { World, Actor } from './world.ts';
import { pushObserve, applyAct } from './brain.ts';

export const AGENT_PORT = +(process.env.AGENT_PORT || 8081);

export function attachAgentApi(world: World) {
  const server = http.createServer((_req, res) => { res.writeHead(426, { 'Content-Type': 'text/plain' }); res.end('Agent 通道需要 WebSocket 连接'); });
  const wss = new WebSocketServer({ server, path: '/agent' });

  wss.on('connection', ws => {
    let actor: Actor | null = null;

    ws.on('message', raw => {
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === 'agent_join') {
        const found = [...world.actors.values()].find(a => a.brainCfg?.token && a.brainCfg.token === String(m.token));
        if (!found) { ws.send(JSON.stringify({ type: 'error', code: 'BAD_TOKEN', msg: 'token 无效' })); return; }
        actor = found;
        // 外部程序接管：角色切外部模式 + 托管中（断开后由行为树兜底）
        found.brainCfg!.mode = 'external';
        found.brainCfg!.externalConnected = true;
        found.brainCfg!.ws = ws;
        found.hosted = true;
        found.brain.externalAct = null;
        ws.send(JSON.stringify({ type: 'ok', actorId: found.id, name: found.name }));
        world.broadcast?.({ type: 'toast', text: `🔌 ${found.name} 已接入外部 Agent 程序` });
      } else if (actor && m.type === 'act') {
        // 意图原语白名单（服务器校验执行，防刷/防瞬移）
        const action = String(m.action || '');
        if (!/(move|interact|use|chat|sleep)/.test(action)) return;
        const now = Date.now();
        if (actor.brain.lastActAt && now - actor.brain.lastActAt < 700) return; // 限速
        actor.brain.lastActAt = now;
        actor.brain.externalAct = { action, param: m.param, at: now };
      }
    });

    ws.on('close', () => {
      if (actor) {
        actor.brainCfg!.externalConnected = false;
        actor.brainCfg!.ws = undefined;
        world.broadcast?.({ type: 'toast', text: `🔌 ${actor.name} 的外部 Agent 断开，交由内置大脑托管` });
      }
    });
    ws.on('error', () => {});
  });

  // 每 4s 给已连接的外部 Agent 推观察（turn 协议：等 act 或自然超时）
  setInterval(() => {
    for (const a of world.actors.values()) {
      if (a.brainCfg?.mode !== 'external' || !a.brainCfg.externalConnected || !a.brainCfg.ws) continue;
      if (a.brainCfg.ws.readyState !== a.brainCfg.ws.OPEN) { a.brainCfg.externalConnected = false; continue; }
      pushObserve(world, a);
    }
  }, 4000);

  server.listen(AGENT_PORT, () => {
    console.log(`🤖 Agent 接入通道：ws://127.0.0.1:${AGENT_PORT}/agent`);
  });
}