// brain.ts —— Agent 大脑（D4）：行为树（免费高频兜底）+ 低频 LLM 决策 + rot.js FOV 视野
// 省钱策略：行为树跑高频（饥饿/睡觉/农活），LLM 只在"空闲决策"时低频调用（默认 40s 一次），
// LLM 超时/失败 → 行为树兜底（看门狗），Agent 永不因 LLM 崩溃。
import type { World, Actor } from './world.ts';
import { data, itemNames, balance, llmConfig, scenesById } from './config.ts';
import { resourceAt } from './maps.ts';
import { doInteract, hasItem } from './actions.ts';
import { pendingTalk } from './social.ts';
import { onEat } from './tasks.ts';
import { chatJson } from './llm.ts';
import fs from 'node:fs';
import path from 'node:path';
import { MEMORY_DIR, DOCS_DIR } from './config.ts';

// —— 游戏规则（内置 Agent 学习用，1 分钟缓存，注入低频决策的 system prompt） ——
const RULES_CACHE = { t: 0, s: '' };
function rulesText(): string {
  try {
    if (Date.now() - RULES_CACHE.t > 60000) {
      RULES_CACHE.s = fs.readFileSync(path.join(DOCS_DIR, '游戏规则-Agent版.md'), 'utf8').slice(0, 1800);
      RULES_CACHE.t = Date.now();
    }
  } catch { /* 规则文件缺失时降级 */ }
  return RULES_CACHE.s;
}

// —— 角色画像（memory/<agentId>/profile.md，简单读取；无则默认） ——
function profileOf(a: Actor): string {
  try {
    const f = path.join(MEMORY_DIR, a.id, 'profile.md');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').slice(0, 600);
  } catch { /* ignore */ }
  return `${a.name}：一个勤劳友善的农场伙伴。`;
}

// —— 观察文本（结构化，简短省 token） ——
function observe(w: World, a: Actor): string {
  const room = w.getRoom(a.sceneId, a.instanceId);
  const others = [...w.actors.values()].filter(o => o.id !== a.id && o.sceneId === a.sceneId && o.instanceId === a.instanceId)
    .map(o => `${o.name}(${o.x},${o.y})${o.isAgent ? 'AI' : '人'}`).join(' ') || '无';
  const day = w.day, hour = Math.floor(w.hour);
  return `第${day}天 ${String(hour).padStart(2, '0')}时 位置(${a.x},${a.y}) 饱食度${Math.round(a.hunger)}/100 体力${Math.round(a.hp)} 金币${a.gold} 背包{${Object.entries(a.items).filter(([, v]) => v > 0).map(([k, v]) => `${itemNames[k] || k}×${v}`).join(',')}} 附近:${others}`;
}

// —— 吃背包里的食物 ——
function eatFood(w: World, a: Actor): boolean {
  for (const [k, v] of Object.entries(a.items)) {
    if (v <= 0) continue;
    const it = data.items.find(x => x.id === +k);
    if (it && (it.type === 8 || it.type === 3)) {
      a.items[k] -= 1;
      const restore = 10 + Math.floor(Math.random() * 31);
      a.hunger = Math.min(100, a.hunger + restore);
      w.broadcast?.({ type: 'chat', channel: 'game', from: a.name, text: `🍽️ 吃了一口${it.name}（饱食度+${restore}）` });
      onEat(w, a);
      return true;
    }
  }
  return false;
}

// —— 附近资源点（扫描 12 格半径） ——
function findNear(w: World, a: Actor, kind: 'ore' | 'tree' | 'water'): [number, number] | null {
  const room = w.getRoom(a.sceneId, a.instanceId);
  w.loadRoomCollide(room);
  let best: [number, number] | null = null, bestD = Infinity;
  for (let d = 1; d <= 12; d++) {
    for (let dc = -d; dc <= d; dc++) for (let dr = -d; dr <= d; dr++) {
      if (Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue;
      const c = a.x + dc, r0 = a.y + dr;
      const res = resourceAt(room.mapName, c, r0);
      if (res?.kind === kind) {
        const dd = Math.abs(dc) + Math.abs(dr);
        if (dd < bestD) { bestD = dd; best = [c, r0]; }
      }
    }
    if (best) return best;
  }
  return null;
}

// —— 移动到目标格（rot-js A* 寻路，每 tick 走一步） ——
async function pathTo(w: World, a: Actor, tx: number, ty: number) {
  if (a.brain.pathing) return;
  a.brain.pathing = true;
  const room = w.getRoom(a.sceneId, a.instanceId);
  w.loadRoomCollide(room);
  try {
    const ROT: any = await import('rot-js');
    const cost = (x: number, y: number) => w.canWalk(room, x, y) ? 1 : 0;
    const astar = new ROT.Path.AStar(tx, ty, cost, { topology: 4 });
    const cells: [number, number][] = [];
    astar.compute(a.x, a.y, (x: number, y: number) => cells.push([x, y]));
    a.brain.path = cells.length > 1 ? cells.slice(1) : [[tx, ty]];
  } catch {
    a.brain.path = [[tx, ty]];
  } finally {
    a.brain.pathing = false;
  }
}

function step(w: World, a: Actor) {
  const path = a.brain.path;
  if (!path?.length) return;
  const [nx, ny] = path[0];
  const room = w.getRoom(a.sceneId, a.instanceId);
  if (w.canWalk(room, nx, ny)) {
    // 简单转向+移动（方向计算）
    const dx = nx - a.x, dy = ny - a.y;
    a.dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
    a.x = nx; a.y = ny; a.moving = true;
    setTimeout(() => { if (a.moving) a.moving = false; }, 200);
  }
  a.brain.path = path.slice(1);
}

// —— 行为树（免费、永不失败） ——
function behave(w: World, a: Actor): void {
  const b = a.brain;
  // NPC：随机散步（每 8 秒换目标），不干活不睡觉
  if (a.isNpc) {
    if (!b.path?.length && !b.pathing && Math.random() < 0.6) {
      const room = w.getRoom(a.sceneId, a.instanceId);
      const tx = Math.max(1, Math.min(room.width - 2, a.x + Math.floor(Math.random() * 13) - 6));
      const ty = Math.max(1, Math.min(room.height - 2, a.y + Math.floor(Math.random() * 13) - 6));
      pathTo(w, a, tx, ty);
      b.plan = 'walk';
    }
    return;
  }
  // 1) 饥饿 → 吃 / 找水钓鱼 / 商店买食
  if (a.hunger < 50) {
    if (eatFood(w, a)) { b.plan = 'eat'; return; }
    const water = findNear(w, a, 'water');
    if (water && hasItem(a, 6)) { pathTo(w, a, water[0], water[1]); b.plan = 'fish'; return; }
    if (a.gold >= 60) {
      // 去买食物（小麦种子→不，直接买食物：商店没有熟食？有杂鱼19/鱼…买种子不行。买个鱼饵+去钓）
      // 简化：去水边挂机等待饥饿好转前重试钓鱼
      b.plan = 'idle'; return;
    }
  }
  // 2) 夜晚 → 睡觉
  if (w.hour >= balance.time.night_start_hour || w.hour < 5) { doInteract(w, a); b.plan = 'sleep'; return; }
  // 3) 农活：帮玩家照料作物（浇水/收获）
  if (a.stats.plant > 0) {
    const room = w.getRoom(a.sceneId, a.instanceId);
    const p = room.plants.find(x => x.grow < 100);
    if (p) {
      pathTo(w, a, p.grid[0], p.grid[1]);
      b.plan = 'water';
      return;
    }
  }
  // 4) 空闲 → 30% 去矿/树干活，否则随机散步
  if (Math.random() < 0.35) {
    const res = findNear(w, a, Math.random() < 0.5 ? 'ore' : 'tree');
    if (res) {
      // 走到旁边的可站格
      const room = w.getRoom(a.sceneId, a.instanceId);
      const cands = [[res[0] - 1, res[1]], [res[0] + 1, res[1]], [res[0], res[1] - 1], [res[0], res[1] + 1]];
      for (const [c, r0] of cands) {
        if (w.canWalk(room, c, r0)) { pathTo(w, a, c, r0); b.plan = 'chop'; break; }
      }
      return;
    }
  }
  // 随机散步
  const room = w.getRoom(a.sceneId, a.instanceId);
  const rx = a.x + Math.floor(Math.random() * 9) - 4;
  const ry = a.y + Math.floor(Math.random() * 9) - 4;
  pathTo(w, a, Math.max(1, Math.min(room.width - 2, rx)), Math.max(1, Math.min(room.height - 2, ry)));
  b.plan = 'wander';
}

// —— 工作完成检查（每 tick 跑：path 走完 + 目标点互动） ——
function workTick(w: World, a: Actor) {
  const b = a.brain;
  if (!b.plan) return;
  if (b.path?.length) return; // 还在走
  if (b.plan === 'water' || b.plan === 'chop' || b.plan === 'fish') {
    // 面向目标格并交互
    const room = w.getRoom(a.sceneId, a.instanceId);
    // 找最近的资源格朝它
    const cands = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [dx, dy] of cands) {
      const res = resourceAt(room.mapName, a.x + dx, a.y + dy);
      if (res?.kind === 'ore' || res?.kind === 'tree' || res?.kind === 'water') {
        a.dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
        doInteract(w, a);
        b.plan = 'idle';
        return;
      }
    }
    // 否则直接面朝前方交互一次（耕地/作物）
    doInteract(w, a);
    b.plan = 'idle';
  }
}

export function brainTick(w: World, dtMs: number) {
  for (const a of w.actors.values()) {
    if (!a.hosted || a.asleep) continue;
    const b = a.brain;

    // 观战者推 FOV（独立节流 2s，与大脑循环无关）
    if (!b.lastFov || Date.now() - b.lastFov > 2000) {
      b.lastFov = Date.now();
      pushFov(w, a);
    }
    if (a.busy && Date.now() < a.busy.until) continue;

    // 外部模式（档2）：应用外部程序指令；断线 → 行为树兜底
    if (a.brainCfg?.mode === 'external') {
      if (b.externalAct) { applyAct(w, a, b.externalAct); b.externalAct = null; }
      else if (!a.brainCfg.externalConnected) behave(w, a);
      continue;
    }

    // 指令队列（玩家指令=最高优先级）
    if (b.cmdQueue.length) {
      const cmd = b.cmdQueue.shift()!;
      handleCmd(w, a, cmd);
      b.nextThink = Date.now() + 4000;
      continue;
    }
    // 走路径
    if (b.path?.length) {
      if (Date.now() - (b.lastStep || 0) > 320) { step(w, a); b.lastStep = Date.now(); }
      continue;
    }
    workTick(w, a);
    if (Date.now() < b.nextThink) continue;
    b.nextThink = Date.now() + 3000;

    // 行为树（同步、免费）
    behave(w, a);

    // 低频 LLM 策略决策（档1：用玩家自己的供应商/模型；40s 一次）
    if (a.brainCfg?.key) {
      const now = Date.now();
      if (!b.lastLLM || now - b.lastLLM > 40000) {
        b.lastLLM = now;
        llmDecide(w, a);
      }
    }
  }
}

// —— 外部 Agent 动作执行（意图原语，服务器校验） ——
export function applyAct(w: World, a: Actor, act: { action: string; param?: any }) {
  switch (act.action) {
    case 'move': {
      const d = String(act.param || 'down');
      if (['up', 'down', 'left', 'right'].includes(d)) w.tryMove(a, d as any);
      break;
    }
    case 'interact': doInteract(w, a); break;
    case 'use': {
      const id = +act.param;
      const it = data.items.find(x => x.id === id);
      if (it && (it.type === 3 || it.type === 8) && (a.items[String(id)] || 0) > 0) {
        a.items[String(id)] -= 1;
        const restore = 10 + Math.floor(Math.random() * 31);
        a.hunger = Math.min(100, a.hunger + restore);
        w.broadcast?.({ type: 'chat', channel: 'game', from: a.name, text: `🍽️ 吃了一口${it.name}` });
        onEat(w, a);
      }
      break;
    }
    case 'chat': {
      const text = String(act.param || '').slice(0, 120);
      if (text) {
        w.broadcast?.({ type: 'chat', channel: 'game', from: a.name, text });
        for (const o of w.actors.values()) {
          if (o.id !== a.id && o.sceneId === a.sceneId && o.instanceId === a.instanceId && Math.abs(o.x - a.x) + Math.abs(o.y - a.y) <= 4) {
            pendingTalk(w, a, o, text); break;
          }
        }
      }
      break;
    }
    case 'sleep': doInteract(w, a); break;
  }
}

// —— 外部 Agent 观察（turn 循环：agentapi 每 4s 调用） ——
export function pushObserve(w: World, a: Actor) {
  const cfg = a.brainCfg!;
  const room = w.getRoom(a.sceneId, a.instanceId);
  w.loadRoomCollide(room);
  const msg = {
    type: 'observe',
    actorId: a.id,
    turn: cfg.vision ? 'vision' : 'text',
    at: Date.now(),
    you: {
      x: a.x, y: a.y, dir: a.dir,
      hunger: Math.round(a.hunger), hp: Math.round(a.hp), gold: a.gold,
      items: Object.fromEntries(Object.entries(a.items).filter(([, v]) => v > 0).map(([k, v]) => [itemNames[k] || k, v]))
    },
    world: {
      sceneId: a.sceneId, instanceId: a.instanceId, map: room.mapName,
      day: w.day, hour: Math.floor(w.hour), scene: scenesById[a.sceneId]?.name
    },
    nearby: [...w.actors.values()]
      .filter(o => o.id !== a.id && o.sceneId === a.sceneId && o.instanceId === a.instanceId && Math.abs(o.x - a.x) + Math.abs(o.y - a.y) <= 5)
      .map(o => ({ name: o.name, x: o.x, y: o.y, agent: o.isAgent, rel: a.relations[o.id] || 0 })),
    fov: buildFovAscii(w, a),
    plants: room.plants.filter(p => Math.abs(p.grid[0] - a.x) <= 3 && Math.abs(p.grid[1] - a.y) <= 3).map(p => ({ grid: p.grid, grow: p.grow, watered: p.watered }))
  };
  try { if (cfg.ws && cfg.ws.readyState === 1) cfg.ws.send(JSON.stringify(msg)); } catch { }
}

// —— 玩家指令解析（关键词匹配行为，简单可靠） ——
function handleCmd(w: World, a: Actor, cmd: { text: string; by: string }) {
  const t = cmd.text;
  w.broadcast?.({ type: 'chat', channel: 'game', from: a.name, text: `（收到 ${cmd.by} 的指令：${t}）` });
  if (t.includes('吃')) { if (!eatFood(w, a)) { const water = findNear(w, a, 'water'); if (water) pathTo(w, a, water[0], water[1]); } }
  else if (t.includes('睡')) { doInteract(w, a); }
  else if (t.includes('矿') || t.includes('挖')) { const r = findNear(w, a, 'ore'); if (r) pathTo(w, a, r[0], r[1]); }
  else if (t.includes('树') || t.includes('砍')) { const r = findNear(w, a, 'tree'); if (r) pathTo(w, a, r[0], r[1]); }
  else if (t.includes('鱼')) { const r = findNear(w, a, 'water'); if (r) pathTo(w, a, r[0], r[1]); }
  else if (t.includes('陪') || t.includes('跟') || t.includes('来')) {
    const who = [...w.actors.values()].find(x => x.name === cmd.by);
    if (who) pathTo(w, a, who.x, who.y);
  }
  else if (t.includes('歇') || t.includes('闲')) { a.brain.path = null; a.brain.plan = 'idle'; }
  else {
    // 兜底：把指令合入观察交给 LLM 决策
    a.brain.lastCmd = cmd.text;
  }
}

async function llmDecide(w: World, a: Actor) {
  try {
    // 档1：玩家自己的供应商/模型（无 key 则不调，行为树兜底）
    const cfg = a.brainCfg!;
    const g = llmConfig();
    const override = cfg.key
      ? { base_url: cfg.baseUrl || g.base_url, model: cfg.model || g.model, key: cfg.key, temperature: cfg.temperature ?? 0.7 }
      : undefined;
    if (!override) return;
    const obs = observe(w, a) + (a.brain.lastCmd ? `。玩家最新指令：${a.brain.lastCmd}` : '');
    const sys = `你是${a.name}，AgentFarm 农场共居世界里的 AI 居民。${profileOf(a)}
【游戏规则摘要】
${rulesText()}
【规则结束】
你在每 3 秒的循环里做决定。输出 JSON（不要其他文字）：{"action":"moveTo|useTool|eat|chat|sleep|idle","param":"目标角色名 或 动作说明或留空"}
规则：饥饿<50 先吃/找水边钓鱼；夜晚必须回家睡觉；有作物就先浇水收获；否则干农活或散步。`;
    const j = await chatJson<any>([
      { role: 'system', content: sys },
      { role: 'user', content: `当前观察：${obs}` }
    ], { timeoutMs: 9000, maxTokens: 120, override });
    if (!j?.action) return;
    const act = String(j.action).toLowerCase();
    if (act === 'moveTo') {
      const who = [...w.actors.values()].find(x => x.name === j.param);
      if (who) pathTo(w, a, who.x, who.y);
    } else if (act === 'useTool') {
      const r = findNear(w, a, Math.random() < 0.5 ? 'ore' : 'tree');
      if (r) pathTo(w, a, r[0], r[1]);
    } else if (act === 'eat') eatFood(w, a);
    else if (act === 'chat') {
      const other = [...w.actors.values()].find(x => x.id !== a.id && x.sceneId === a.sceneId && x.instanceId === a.instanceId && Math.abs(x.x - a.x) + Math.abs(x.y - a.y) <= 4);
      if (other) pendingTalk(w, a, other, '嗨，今天过得怎么样？');
    } else if (act === 'sleep') doInteract(w, a);
    // idle → 无操作
    a.brain.lastThought = j.param || act;
  } catch { /* 看门狗：行为树已兜底，忽略 */ }
}

// —— FOV ASCII（公共：观战者 + 外部 Agent 观察共用；曼哈顿可见简化，资源格标符号） ——
function buildFovAscii(w: World, a: Actor): string[] {
  const room = w.getRoom(a.sceneId, a.instanceId);
  w.loadRoomCollide(room);
  const size = 15, half = 7;
  const grid: string[][] = [];
  for (let i = 0; i < size; i++) grid.push(new Array(size).fill(' '));
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const cx = a.x + dx, cy = a.y + dy;
      const gx = dx + half, gy = dy + half;
      if (cx < 0 || cy < 0 || cx >= room.width || cy >= room.height) continue;
      if (Math.abs(dx) + Math.abs(dy) > half) continue; // 简化可见性（精确阴影见 rot.js 观战路径）
      const walk = w.canWalk(room, cx, cy);
      const res = resourceAt(room.mapName, cx, cy);
      grid[gy][gx] = walk ? (res ? (res.kind === 'ore' ? 'M' : res.kind === 'tree' ? 'T' : '~') : '.') : '#';
    }
  }
  grid[half][half] = '@';
  return grid.map(r => r.join(''));
}

// —— FOV（rot.js，给观战者推 ASCII 视野） ——
async function pushFov(w: World, a: Actor) {
  try {
    const room = w.getRoom(a.sceneId, a.instanceId);
    w.loadRoomCollide(room);
    for (const [ws, c] of w.clients) {
      if (c.spectateId !== a.id) continue;
      const lines = buildFovAscii(w, a);
      w.send(ws, { type: 'fov', actorId: a.id, grid: lines });
      return;
    }
  } catch { /* rot-js 未装则跳过 */ }
}