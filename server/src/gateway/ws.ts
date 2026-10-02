// gateway/ws.ts —— WebSocket 双通道：/ws 游戏通道 + /agent 外部 agent 通道（协议与 legacy 逐条等价）
import type WebSocket from 'ws';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import type { WorldState } from '../persistence/state.ts';
import { bucketOf, type AgentRoute } from '../persistence/state.ts';
import { parseGameMsg, parseAgentMsg } from './protocol.ts';
import {
  pairOf, favBetween, addFav, socialNear, giftFavGain,
  dmUnlocked, dmUnlock, dmUnlockedList, announceDmUnlock, pushDmUnlockedLists,
  trackSceneTogether, registerScenePeer, dropScenePeer, resolveOnlineUid, resolveAnyUid,
  RELATION_DEFS,
} from '../world/social.ts';
import { TASK_DEFS, tasksOf, taskCount } from '../world/tasks.ts';
import { worldPlants, worldPlots, worldSprinklers, growPlants, plantAtWorld, knapAdd, knapHas, knapSub, treeOf, nextPlantUid, soilAt, waterAt, plotAt } from '../world/farm.ts';
import { PLANT_CROPS, pickWeighted, FISH_POOL, MINE_POOL } from '../world/tables.ts';
import { freshSeed, pickWeightedSeeded } from '../world/rng.ts';
import { WORLD_KEYS } from '../persistence/state.ts';
import { doBuy, shopTable } from '../market/shop.ts';
import { bfsPath, nearestReachable, blockedAt, blockedHouse, normXY } from '../navigation/grid.ts';
import { navGridFromTables } from '../navigation/navgen.ts';
import { applyRoads, roadOf, type RoadLine } from '../navigation/roads.ts';
import { municipalOf, buildingTargetOf } from '../navigation/municipal.ts';
import { astarClearance, checkArrive, snapInteraction, planRoute } from '../navigation/hpath.ts';
import { feedAnimal, petAnimal, adoptAnimal, worldAnimals, ANIMALS } from '../world/livestock.ts';
import { cook, buildFacility } from '../world/cooking.ts';
import { placeDecor, removeDecor, courtyardScore, courtyardCompletion, courtyardContest } from '../world/decor.ts';
import { recordFestivalScore, stallFee, activeFestival } from '../world/festival.ts';
import { currentGameDay, calendarDay, STORM_INSURANCE_PER_PLANT } from '../world/calendar.ts';
import { trainAttr, fitnessOf, GYM_ATTR_NAME, GYM_ATTRS } from '../world/fitness.ts';
import type { AgentPos } from '../types.ts';
import { observeState } from '../cognition/observe.ts';
import { notePlayerOp, publishAgentActivityGlobal } from '../cognition/managed.ts';

// 模块级共享（与 legacy 等价：shop 价目表启动时算一次）
let shopCache: { tables: App['tables']; table: Record<number, Array<[number, number]>> } | null = null;
export function shopOf(app: App): Record<number, Array<[number, number]>> {
  if (!shopCache || shopCache.tables !== app.tables) shopCache = { tables: app.tables, table: shopTable(app.tables) };
  return shopCache.table;
}

// ---------- 工具 ----------

// B6/D6 导航：村景 = 运行时由 tables 构建（含水层）；其余场景 = data/nav/nav-<map>.json（build-scene-collisions 生成）
let navCache: { tables: App['tables']; roadsMtime: number; nav: ReturnType<typeof navGridFromTables> } | null = null;
let sceneNavFileCache: { file: string; mtimeMs: number; nav: ReturnType<typeof navGridFromTables> | null } | null = null;
let sceneNameCache: { file: string; mtimeMs: number; byScene: Map<number, string> } | null = null;
let portalsCache: { file: string; mtimeMs: number; portals: import('../navigation/navgen.ts').Portal[] } | null = null;
function readNavJson(file: string): { mtimeMs: number; data: unknown | null } {
  try {
    const st = statSync(file);
    return { mtimeMs: st.mtimeMs, data: JSON.parse(readFileSync(file, 'utf8')) };
  } catch { return { mtimeMs: 0, data: null }; }
}
/** 村景市政路网（data/roads.json "2"）：mtime 缓存，applyRoads 写 kind=4 路格 */
function villageRoads(app: App): { roads: RoadLine[]; mtimeMs: number } {
  const file = path.join(app.dataDir, 'roads.json');
  const r = readNavJson(file);
  const doc = r.data as { '2'?: { roads?: RoadLine[] } } | null;
  return { roads: doc?.['2']?.roads ?? [], mtimeMs: r.mtimeMs };
}
/** sceneType -> 场景 nav-grid（village=运行时构建+市政路；其余读 data/nav/nav-<map>.json；无数据 null） */
function navOf(app: App, scene?: number): ReturnType<typeof navGridFromTables> | null {
  if (scene === undefined || scene === 2) {
    const vr = villageRoads(app);
    if (!navCache || navCache.tables !== app.tables || navCache.roadsMtime !== vr.mtimeMs) {
      const nav = navGridFromTables(app.tables);
      if (vr.roads.length) applyRoads(nav, vr.roads);
      navCache = { tables: app.tables, roadsMtime: vr.mtimeMs, nav };
    }
      return navCache.nav;
  }
  const navDir = path.join(app.dataDir, 'nav');
  const regFile = path.join(navDir, 'scenes.json');
  if (!sceneNameCache || sceneNameCache.mtimeMs !== readNavJson(regFile).mtimeMs || !sceneNameCache.file.startsWith(navDir)) {
    const r = readNavJson(regFile);
    const byScene = new Map<number, string>();
    const reg = r.data as { scenes?: Array<{ scene?: number; name?: string }> } | null;
    for (const e of reg?.scenes || []) if (typeof e.scene === 'number' && e.name) byScene.set(e.scene, e.name);
    sceneNameCache = { file: regFile, mtimeMs: r.mtimeMs, byScene };
  }
  const mapName = sceneNameCache!.byScene.get(scene);
  if (!mapName) return null;
  const file = path.join(navDir, `nav-${mapName}.json`);
  const r = readNavJson(file);
  if (!sceneNavFileCache || sceneNavFileCache.file !== file || sceneNavFileCache.mtimeMs !== r.mtimeMs) {
    sceneNavFileCache = { file, mtimeMs: r.mtimeMs, nav: r.data as ReturnType<typeof navGridFromTables> | null };
  }
  return sceneNavFileCache.nav;
}
/** D6 全量门户图（data/nav/portals.json：sceneType -> 门户数组） */
export function portalsOf(app: App): import('../navigation/navgen.ts').Portal[] {
  const file = path.join(app.dataDir, 'nav', 'portals.json');
  const r = readNavJson(file);
  if (!portalsCache || portalsCache.file !== file || portalsCache.mtimeMs !== r.mtimeMs) {
    const flat: import('../navigation/navgen.ts').Portal[] = [];
    const doc = r.data as Record<string, unknown> | null;
    if (doc) for (const [k, v] of Object.entries(doc)) {
      if (k === 'note' || !Array.isArray(v)) continue;
      for (const p of v as Array<Partial<import('../navigation/navgen.ts').Portal>>) {
        if (typeof p.scene === 'number' && typeof p.toScene === 'number') {
          flat.push({ scene: p.scene, toScene: p.toScene, x: Number(p.x ?? 0), y: Number(p.y ?? 0), passage: p.passage });
        }
      }
    }
    portalsCache = { file, mtimeMs: r.mtimeMs, portals: flat };
  }
  return portalsCache!.portals;
}
function sendTo(p: { ws: WebSocket }, obj: unknown): void {
  if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj));
}

/** 目标坐标容错：agent 可能传格子坐标（如 33,15）或像素坐标（如 3350,1550） */
export function normXYOf(app: App, x: unknown, y: unknown): { x: number; y: number } {
  return normXY(app.tables, x, y);
}

// ---------- 托管移动广播（agent_move 给自己的客户端；move 给别人） ----------
// seg = 当前航点序号（D1 执行确认闭环：客户端按 seg 回报 agent_arrive）
// passage = 场景切换门户名（跨场景段：客户端据此走原版 changeSceneEasy）
function publishAgentMove(app: App, state: WorldState, uid: string, pos: { x: number; y: number; scene: number }, seg?: number, passage?: string): void {
  const self = state.online.get(uid);
  if (self) { self.scene = pos.scene; self.x = pos.x; self.y = pos.y; }
  for (const [otherUid, player] of state.online) {
    if (otherUid === uid) sendTo(player, { t: 'agent_move', scene: pos.scene, x: pos.x, y: pos.y, seg, passage });
    else sendTo(player, { t: 'move', uid, scene: pos.scene, x: pos.x, y: pos.y });
  }
}

function publishAgentMoveDone(app: App, state: WorldState, uid: string, pos: { x: number; y: number; scene: number }): void {
  const self = state.online.get(uid);
  if (self) { self.scene = pos.scene; self.x = pos.x; self.y = pos.y; }
  for (const [otherUid, player] of state.online) {
    if (otherUid === uid) sendTo(player, { t: 'agent_move_done', scene: pos.scene, x: pos.x, y: pos.y });
    else sendTo(player, { t: 'move', uid, scene: pos.scene, x: pos.x, y: pos.y });
  }
}

function persistAgentPosition(app: App, state: WorldState, uid: string, pos: { x: number; y: number; scene: number }): void {
  state.agentPos.set(uid, pos);
  const pd = (state.playersDb.get(uid)?.get('playerData') || null) as { playerPos?: unknown; posSceneType?: number; sceneType?: number } | null;
  if (!pd) return;
  pd.playerPos = { x: pos.x, y: pos.y };
  pd.posSceneType = pos.scene;
  pd.sceneType = pos.scene;
  state.persist();
  // 事件溯源：agent 位置变更入事件流（回放确定性）
  app.log.append('agent.pos', uid, { x: pos.x, y: pos.y, scene: pos.scene });
}

// ---------- D1 执行确认闭环（航点 -> 客户端 arrive 上报实际落点 -> 校验/重规划 -> 下一航点） ----------

type ArriveReply = { kind: 'arrive'; index: number; x: number; y: number } | { kind: 'timeout' } | { kind: 'abort' };

/** 等待 arrive 上报（客户端 mod 或外部 agent）；超时/打断/到来三态返回 */
function waitArrive(state: WorldState, uid: string, ms: number, signal: AbortSignal): Promise<ArriveReply> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish({ kind: 'timeout' }), ms);
    const onAbort = () => finish({ kind: 'abort' });
    function finish(v: ArriveReply): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      state.agentArrives.delete(uid);
      resolve(v);
    }
    if (signal.aborted) { finish({ kind: 'abort' }); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    state.agentArrives.set(uid, (v) => finish({ kind: 'arrive', ...v }));
  });
}

/** 可打断的 sleep（盲推兜底用） */
function sleepAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); resolve(); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** arrive 上报投递：有待确认消费者则消费，返回是否被消费 */
function deliverArrive(state: WorldState, uid: string, v: { index: number; x: number; y: number }): boolean {
  const fn = state.agentArrives.get(uid);
  if (!fn) return false;
  state.agentArrives.delete(uid);
  fn(v);
  return true;
}

/**
 * D1 主执行流：逐段「广播航点 -> 等 arrive -> 校验/从真实位置重规划」。
 * 客户端离线或 AF_NAV_DEBUG_BLIND=1 时按 legacy 120ms 逐格盲推当前段（回落分支）。
 * 打断（AbortController）立即终止并在真实位置广播 agent_move_done（D4）。
 */
function startNavTask(
  app: App, state: WorldState, uid: string, apos: { x: number; y: number; scene: number },
  route: AgentRoute,
  sendOut: (out: unknown) => void,
): void {
  const ac = new AbortController();
  const task: Promise<unknown> = (async () => {
    const out = await runNavTask(app, state, uid, apos, route, ac);
    state.agentMoves.delete(uid);
    state.agentRoutes.delete(uid); // 走完/终止即清路线
    state.agentArrives.delete(uid);
    return out;
  })().then((out) => {
    sendOut(out);
  }).catch((error: unknown) => {
    state.agentMoves.delete(uid);
    state.agentRoutes.delete(uid);
    state.agentArrives.delete(uid);
    publishAgentMoveDone(app, state, uid, apos);
    sendOut({ ok: false, msg: `移动失败：${String((error as Error)?.message || error).slice(0, 120)}` });
  });
  state.agentMoves.set(uid, {
    promise: task,
    abort: () => ac.abort(), // D4：打断硬停（200ms 内终止并广播 done）
  });
}

/**
 * D1 主执行流：逐段「广播航点 -> 等 arrive -> 校验/从真实位置重规划」。
 * 客户端离线或 AF_NAV_DEBUG_BLIND=1 时按 legacy 120ms 逐格盲推当前段（回落分支）。
 * 打断（AbortController）立即终止并在真实位置广播 agent_move_done（D4）。
 */
async function runNavTask(app: App, state: WorldState, uid: string, apos: AgentPos, route: AgentRoute, ac: AbortController): Promise<unknown> {
  const publish = (t: string) => publishAgentActivityGlobal(app, uid, t);
  const stepSegBlind = async (): Promise<void> => {
    const wpNow = route.waypoints[route.i];
    if (!route.path) {
      // 跨场景路线：无逐格路径，直接粗步到段终点（含场景切换；客户端离线时服务端侧传送）
      apos.x = wpNow.x; apos.y = wpNow.y;
      if (wpNow.scene !== (apos.scene ?? 2)) apos.scene = wpNow.scene; // 场景切换段：同步 agentPos 场景号
      await sleepAbort(300, ac.signal);
      route.actual = { scene: wpNow.scene, x: wpNow.x, y: wpNow.y };
      return;
    }
    for (; !ac.signal.aborted && route.pathI < wpNow.cellI; route.pathI++) {
      const [cx, cy] = route.path[route.pathI];
      apos.x = cx * 100 + 50; apos.y = cy * 100 + 50;
      publishAgentMove(app, state, uid, { scene: wpNow.scene, x: apos.x, y: apos.y });
      await sleepAbort(120, ac.signal);
      route.actual = { scene: wpNow.scene, x: apos.x, y: apos.y };
    }
  };
  while (!ac.signal.aborted) {
    if (route.i >= route.waypoints.length) break;
    const wp = route.waypoints[route.i];
    // 场景切换段：本段目标场景与当前位置不同（跨场景路线；客户端走原版场景传送）
    const curScene = apos.scene ?? 2;
    const sceneSwitch = wp.scene !== curScene;
    const passage = sceneSwitch
      ? portalsOf(app).find(p => p.scene === curScene && p.toScene === wp.scene)?.passage
      : undefined;
    // 发当前段：广播段目标（客户端原版动画推进；跨场景段客户端先切场景）
    apos.x = wp.x; apos.y = wp.y;
    publishAgentMove(app, state, uid, { scene: wp.scene, x: wp.x, y: wp.y }, route.i, passage);
    // 客户端在线 -> 确认环；离线/debug -> 盲推回落
    const blind = app.navDebugBlind || !state.online.has(uid);
    if (blind) {
      await stepSegBlind();
      if (ac.signal.aborted) break;
      route.actual = { scene: wp.scene, x: wp.x, y: wp.y };
      route.i++;
      continue;
    }
    const got = await waitArrive(state, uid, sceneSwitch ? Math.max(app.navArriveTimeoutMs, 15000) : app.navArriveTimeoutMs, ac.signal);
    if (got.kind === 'abort') break;
    if (got.kind === 'timeout') {
      // 客户端在线但没报（旧版 mod 无 arrive 能力 / 完成事件丢失）：盲推当前段后继续
      await stepSegBlind();
      if (ac.signal.aborted) break;
      route.actual = { scene: wp.scene, x: wp.x, y: wp.y };
      route.i++;
      continue;
    }
    const idx = Number.isFinite(got.index) && got.index >= 0 ? got.index : route.i;
    const wpNow = route.waypoints[Math.min(idx, route.waypoints.length - 1)];
    const actual = { scene: wpNow.scene, x: got.x, y: got.y };
    if (checkArrive(wpNow, actual, 120)) {
      route.misses = 0;
      route.actual = actual;
      route.pathI = wpNow.cellI;
      route.i = Math.min(idx + 1, route.waypoints.length);
      continue;
    }
    // 偏差超限 -> 自动停止 + 从真实位置重规划（D1 闭环核心；连续 3 次超限终止路线，成功确认清零）
    route.misses++;
    route.totalMisses++;
    route.actual = actual;
    if (route.misses >= 3) {
      apos.x = actual.x; apos.y = actual.y;
      publishAgentMoveDone(app, state, uid, apos);
      persistAgentPosition(app, state, uid, apos);
      publish('路线终止：连续 3 次偏差超限');
      return { ok: false, msg: `路线终止：连续 3 次偏差超限（累计 ${route.totalMisses} 次），请重新规划` };
    }
    const rAx = Math.floor(actual.x / 100), rAy = Math.floor(actual.y / 100);
    const gCx = Math.floor(route.target.x / 100), gCy = Math.floor(route.target.y / 100);
    const sameScene = actual.scene === route.target.scene;
    let newWps: Array<{ scene: number; x: number; y: number; cellI: number }> | null = null;
    let newPath: Array<[number, number]> | null = null;
    if (sameScene) {
      const nav = navOf(app, actual.scene);
      if (nav) {
        const goal = snapInteraction(nav, gCx, gCy, undefined, 4) ?? [gCx, gCy];
        newPath = astarClearance(nav, rAx, rAy, goal[0], goal[1]) ?? bfsPath(app.tables, rAx, rAy, goal[0], goal[1]);
        if (newPath && newPath.length >= 2) {
          newWps = [];
          for (let k = 1; k < newPath.length; k += 4) newWps.push({ scene: wpNow.scene, x: newPath[k][0] * 100 + 50, y: newPath[k][1] * 100 + 50, cellI: k });
          const [rfx, rfy] = newPath[newPath.length - 1];
          newWps.push({ scene: wpNow.scene, x: rfx * 100 + 50, y: rfy * 100 + 50, cellI: newPath.length - 1 });
        }
      }
    }
    // 跨场景（或同场景无数据）：一级门户 Dijkstra + 二级 A* 全量重规划
    if (!newWps?.length) {
      const pr = planRoute(
        { scene: actual.scene, x: actual.x, y: actual.y },
        { scene: route.target.scene, x: route.target.x, y: route.target.y },
        (sc) => navOf(app, sc), portalsOf(app),
      );
      if (!pr.ok) {
        apos.x = actual.x; apos.y = actual.y;
        publishAgentMoveDone(app, state, uid, apos);
        persistAgentPosition(app, state, uid, apos);
        return { ok: false, msg: `重规划失败：${pr.msg || '目标不可达'}，请分段走` };
      }
      newWps = pr.waypoints.map((w, i) => ({ scene: w.scene, x: w.x, y: w.y, cellI: i }));
      newPath = null; // 跨场景无逐格路径（盲推粗步）
    }
    route.waypoints = route.waypoints.slice(0, route.i).concat(newWps!);
    route.path = newPath;
    route.pathI = 0;
    route.misses = 0;
    continue;
  }
  if (ac.signal.aborted) {
    // D4 打断硬停：先广播 done（200ms 门只看停止响应），再落盘（同步 commit 可达秒级，不得阻塞停止链路）
    apos.x = route.actual.x; apos.y = route.actual.y;
    apos.scene = route.actual.scene;
    publishAgentMoveDone(app, state, uid, apos);
    persistAgentPosition(app, state, uid, apos);
    publish('已停下（玩家打断），等你指挥');
    return { ok: false, interrupted: true, pos: { x: apos.x, y: apos.y }, scene: apos.scene };
  }
  apos.x = route.actual.x; apos.y = route.actual.y;
  apos.scene = route.actual.scene;
  publishAgentMoveDone(app, state, uid, apos);
  persistAgentPosition(app, state, uid, apos); // 停止/完成链路先广播后落盘（同步 commit 可达秒级，不得阻塞响应）
  publish('到达目标，准备行动');
  return { ok: true, pos: { x: apos.x, y: apos.y }, scene: apos.scene, steps: route.path ? route.path.length - 1 : route.waypoints.length - 1, waypoints: route.waypoints.map(({ cellI, ...w }) => w) };
}

// ============================================================
// 游戏通道 /ws
// ============================================================
export function gameConn(app: App, ws: WebSocket): void {
  const state = app.state;
  let uid: string | null = null;
  const send = (obj: unknown) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  // 协议/网络层错误（如消息超过 maxPayload）只断开该连接，绝不冒泡崩溃进程
  ws.on('error', () => { try { ws.terminate(); } catch { /* ignore */ } });

  ws.on('message', (raw) => {
    const msg = parseGameMsg(JSON.parse(String(raw)));
    if (!msg) return;
    switch (msg.t as string) {
      case 'join': {
        uid = String(msg.uid || 'g' + Math.floor(Math.random() * 1e6));
        // 鉴权：注册账号的 uid 必须携带账号当前 token，防止冒名接管（游客 uid 放行）
        const acc = app.accounts.findAccountByUid(uid);
        if (acc && String(msg.token || '') !== acc.token) {
          send({ t: 'join_deny', msg: '账号校验失败，请刷新页面重新登录后再进入' });
          try { ws.close(4001, 'auth'); } catch { /* ignore */ }
          break;
        }
        let nick = String(msg.nick || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
        if (!nick) nick = '玩家' + uid.slice(-4);
        // 单点登录：同一 uid 重复上线时踢掉旧连接
        const old = state.online.get(uid);
        if (old && old.ws && old.ws !== ws) {
          sendTo(old, { t: 'kicked', msg: '账号在别处上线，请刷新页面重新进入' });
          const oldWs = old.ws;
          setTimeout(() => { try { oldWs.terminate(); } catch { /* ignore */ } }, 200);
        }
        if (!app.state.playersDb.has(uid)) app.state.playersDb.set(uid, new Map());
        state.online.set(uid, { ws, uid, nick, scene: (msg.scene as number | undefined) ?? 0, x: (msg.x as number | undefined) ?? 0, y: (msg.y as number | undefined) ?? 0 });
        // 跟踪同场景共处（自动 DM 解锁）
        for (const [k, o] of state.online) if (k !== uid && o.scene === state.online.get(uid)!.scene) registerScenePeer(state, uid, k, o.scene);
        send({ t: 'welcome', uid, players: Array.from(state.online.values()).map(p => ({ uid: p.uid, nick: p.nick, scene: p.scene, x: p.x, y: p.y })) });
        const myAgent = app.agentSockets.has(uid);
        send({ t: 'agent_status', online: myAgent, nick: myAgent ? nick : null });
        for (const [k, p] of state.online) if (k !== uid) sendTo(p, { t: 'player_join', p: { uid, nick } });
        console.log(`[join] ${uid} (${nick}) 在线:${state.online.size}`);
        break;
      }
      case 'save': {
        if (!msg.kv || !Array.isArray(msg.kv) || !uid) break;
        // 连接身份校验：同 uid 被新连接顶掉后，旧连接的写操作全部失效
        const cur = state.online.get(uid);
        if (!cur || cur.ws !== ws) break;
        // 节流：每连接每秒最多 5 条 save，超出丢弃
        const sNow = Date.now();
        const win = (ws as { _saveWin?: number[] })._saveWin || [];
        const filtered = win.filter(t => sNow - t < 1000);
        if (filtered.length >= 5) break;
        filtered.push(sNow);
        (ws as { _saveWin?: number[] })._saveWin = filtered;
        const kvArr = msg.kv as unknown[];
        if (kvArr.length > 1000) (msg as { kv: unknown[] }).kv = kvArr.slice(0, 1000);
        const kvOut: Array<[string, unknown]> = [];
        let touchedWorld = false;
        for (const item of (msg.kv as unknown[])) {
          if (!Array.isArray(item) || item.length < 1) continue;
          const key = String(item[0]);
          const value = item[1];
          if (typeof value === 'string' && value.length > 512 * 1024) {
            console.log(`[save] 跳过超大值 key=${key} (${value.length}B)`);
            continue;
          }
          let val: unknown;
          try { val = JSON.parse(value as string); } catch { val = value; }
          const b = bucketOf(key);
          // 未知 key 按玩家私有处理；name 剥净 uid 类后缀，防复合污染世界档
          const name = b ? b[1] : key.replace(/(_\d+|_u[0-9a-f]+)+$/g, '');
          if (b && b[0] === 'world') {
            // socialData 是服务器权威键（玩家间好感/关系），客户端回推的旧快照会覆盖实时数据，必须忽略
            if (name !== 'socialData') { state.world.set(name, val); if (WORLD_KEYS.has(name)) touchedWorld = true; }
          } else if (b && b[0] === 'global') state.globals.set(name, val);
          else if (b && b[0] === 'player' && name !== 'afTasks') {
            if (!state.playersDb.has(uid)) state.playersDb.set(uid, new Map());
            state.playersDb.get(uid)!.set(name, val);
          }
          kvOut.push([key, value]);
        }
        state.schedulePersist();
        if (touchedWorld) notePlayerOp(app, uid, 'save', '你（玩家）在游戏里活动，Agent 已让位等你');
        for (const k of state.online.keys()) if (k !== uid) state.queueSaveBroadcast(k, kvOut, uid);
        break;
      }
      case 'move': {
        const p = state.online.get(uid!);
        if (!p || p.ws !== ws) break;
        const now = Date.now();
        const win = ((ws as { _moveWin?: number[] })._moveWin || []).filter(t => now - t < 1000);
        if (win.length >= 12) { (ws as { _moveWin?: number[] })._moveWin = win; break; }
        win.push(now);
        (ws as { _moveWin?: number[] })._moveWin = win;
        const cv = (v: unknown, d: number): number => { const n = Number(v); return Number.isFinite(n) && Math.abs(n) <= 1e6 ? n : d; };
        p.scene = msg.scene === undefined ? p.scene : Math.round(cv(msg.scene, p.scene));
        p.x = cv(msg.x, p.x);
        p.y = cv(msg.y, p.y);
        if (msg.scene !== undefined) {
          trackSceneTogether(state, uid!, p.scene);
          for (const [k, o] of state.online) if (k !== uid && o.scene === p.scene) registerScenePeer(state, uid!, k, p.scene);
        }
        for (const [k, o] of state.online) if (k !== uid) sendTo(o, { t: 'move', uid, scene: p.scene, x: p.x, y: p.y });
        break;
      }
      case 'chat': {
        const p = state.online.get(uid!);
        if (!p || p.ws !== ws) break;
        const now = Date.now();
        const win = ((ws as { _chatWin?: number[] })._chatWin || []).filter(t => now - t < 1000);
        if (win.length >= 3) {
          (ws as { _chatWin?: number[] })._chatWin = win;
          send({ t: 'chat_warn', msg: '发言太快啦，稍等一下' });
          break;
        }
        win.push(now);
        (ws as { _chatWin?: number[] })._chatWin = win;
        const text = String(msg.text || '').slice(0, 200);
        console.log(`[chat] ${p.nick}: ${text}`);
        app.chatLog.push({ nick: p.nick, text, at: Date.now() });
        while (app.chatLog.length > 50) app.chatLog.shift();
        // 事件溯源：聊天入事件流（M1 导演镜头 / 画报日报的数据源）
        app.log.append('chat.msg', uid, { nick: p.nick, text });
        for (const [, o] of state.online) sendTo(o, { t: 'chat', uid, nick: p.nick, text });
        break;
      }
      // ---------- 玩家间社交 ----------
      case 'social_talk': {
        const p = state.online.get(uid!);
        if (!p) break;
        const target = resolveOnlineUid(state, String(msg.target || '')) || '';
        if (!target || target === uid) break;
        const pB = state.online.get(target);
        if (!pB) { send({ t: 'social_result', social: 'talk', ok: false, msg: '对方不在线' }); break; }
        const nr = socialNear(state, uid!, target);
        if (!nr.ok) { send({ t: 'social_result', social: 'talk', ok: false, msg: nr.msg }); break; }
        const text = String(msg.text || '').slice(0, 200);
        if (text) sendTo(pB, { t: 'social_in', social: 'talk', from: uid, nick: p.nick, text });
        const fav = addFav(state, uid!, target, 2);
        taskCount(state, app.tables, uid!, 'talk');
        taskCount(state, app.tables, target, 'talk');
        const firstMeet = dmUnlock(state, uid!, target);
        // 事件溯源：好感与 DM 解锁入事件流（结构化域事实源）
        app.log.append('social.fav', uid!, { a: uid!, b: target, delta: 2 });
        if (firstMeet) {
          app.log.append('dm.unlocked', uid!, { a: uid!, b: target });
          announceDmUnlock(state, uid!, target, `🤝 ${p.nick} 和 ${pB.nick} 见面了，可以开始私聊了`);
          pushDmUnlockedLists(state, uid!, target, app.agentSockets);
        }
        app.log.append('task.progress', uid!, { uid: uid!, type: 'talk', n: 1 });
        app.log.append('task.progress', uid!, { uid: target, type: 'talk', n: 1 });
        send({ t: 'social_result', social: 'talk', ok: true, msg: firstMeet ? `首次见面，已解锁私聊！好感 +2（现 ${fav}）` : `已对话，${pB.nick} 对你的好感 +2（现 ${fav}）` });
        console.log(`[social] ${p.nick} 对话 ${pB.nick}`);
        break;
      }
      case 'social_give': {
        const p = state.online.get(uid!);
        if (!p) break;
        const target = resolveOnlineUid(state, String(msg.target || '')) || '';
        const pB = state.online.get(target);
        if (!pB) { send({ t: 'social_result', social: 'give', ok: false, msg: '对方不在线' }); break; }
        const nr = socialNear(state, uid!, target);
        if (!nr.ok) { send({ t: 'social_result', social: 'give', ok: false, msg: nr.msg }); break; }
        const itemId = Number(msg.itemId);
        const num = Math.max(1, Math.min(99, Number(msg.num || 1)));
        const it = app.tables.items.find(x => x.id === itemId);
        if (!it) { send({ t: 'social_result', social: 'give', ok: false, msg: '没有这个物品' }); break; }
        const pmA = state.playersDb.get(uid!);
        if (!pmA || !knapHas(pmA, itemId, num)) { send({ t: 'social_result', social: 'give', ok: false, msg: `背包里没有 ${it.name}×${num}` }); break; }
        knapSub(pmA, itemId, num);
        const pmB = state.playersDb.get(target);
        if (pmB) knapAdd(pmB, itemId, num);
        const g = giftFavGain(state, app.tables, uid!, target, itemId);
        const fav = addFav(state, uid!, target, g);
        taskCount(state, app.tables, uid!, 'give');
        // 事件溯源：物品转移 + 好感 + 任务 + DM 解锁
        app.log.append('item.consumed', uid!, { uid: uid!, itemId, num });
        app.log.append('item.gained', uid!, { uid: target, itemId, num });
        app.log.append('social.fav', uid!, { a: uid!, b: target, delta: g });
        app.log.append('task.progress', uid!, { uid: uid!, type: 'give', n: 1 });
        for (const [, o] of state.online) sendTo(o, { t: 'chat', uid: 'sys', nick: '系统', text: `🎁 ${p.nick} 送给了 ${pB.nick} ${it.name}×${num}，好感 +${g}` });
        sendTo(pB, { t: 'social_in', social: 'give', from: uid, nick: p.nick, itemId, num, fav });
        const giveMeet = dmUnlock(state, uid!, target);
        if (giveMeet) {
          app.log.append('dm.unlocked', uid!, { a: uid!, b: target });
          announceDmUnlock(state, uid!, target, `🤝 ${p.nick} 给 ${pB.nick} 送了礼物，可以开始私聊了`);
          pushDmUnlockedLists(state, uid!, target, app.agentSockets);
        }
        send({ t: 'social_result', social: 'give', ok: true, msg: `送礼成功，${pB.nick} 对你的好感 +${g}（现 ${fav}）` });
        console.log(`[social] ${p.nick} 送礼 ${pB.nick} ${it.name}x${num}`);
        break;
      }
      case 'social_fav': {
        const target = resolveOnlineUid(state, String(msg.target || '')) || '';
        if (!target) { send({ t: 'social_result', social: 'fav', ok: false, msg: '缺少目标' }); break; }
        const f = favBetween(state, uid!, target);
        const pB = state.online.get(target);
        const nm = pB ? pB.nick : target;
        const rel = f.relation ? (RELATION_DEFS[f.relation]?.name || f.relation) : '无';
        send({ t: 'social_result', social: 'fav', ok: true, msg: `与 ${nm}：你对 TA ${f.aToB}，TA 对你 ${f.bToA}，关系：${rel}` });
        break;
      }
      case 'social_bind': {
        const p = state.online.get(uid!);
        if (!p) break;
        const target = resolveOnlineUid(state, String(msg.target || '')) || '';
        const pB = state.online.get(target);
        if (!pB) { send({ t: 'social_result', social: 'bind', ok: false, msg: '对方不在线' }); break; }
        const type = String(msg.type || 'friend');
        const def = RELATION_DEFS[type];
        if (!def) { send({ t: 'social_result', social: 'bind', ok: false, msg: '关系类型：friend(好友)/confidant(知己)/partner(伴侣)' }); break; }
        const f = favBetween(state, uid!, target);
        if ((f.aToB || 0) < def.level) { send({ t: 'social_result', social: 'bind', ok: false, msg: `好感不足：${def.name} 需要你对 TA 好感 ≥ ${def.level}（当前 ${f.aToB || 0}）` }); break; }
        const { p: pair } = pairOf(state, uid!, target);
        if (pair.relation && pair.relation !== type) { send({ t: 'social_result', social: 'bind', ok: false, msg: `你们已有其他关系（${RELATION_DEFS[pair.relation]?.name}）` }); break; }
        pair.relation = type;
        pair.relBy = uid!;
        state.persist();
        taskCount(state, app.tables, uid!, 'bind');
        // 事件溯源：关系绑定入事件流
        app.log.append('social.relation', uid!, { a: uid!, b: target, relation: type, by: uid! });
        app.log.append('task.progress', uid!, { uid: uid!, type: 'bind', n: 1 });
        for (const [, o] of state.online) sendTo(o, { t: 'chat', uid: 'sys', nick: '系统', text: `🎉 全村公告：${p.nick} 与 ${pB.nick} 结为「${def.name}」！` });
        sendTo(pB, { t: 'social_in', social: 'bind', from: uid, nick: p.nick, relation: type, relName: def.name });
        send({ t: 'social_result', social: 'bind', ok: true, msg: `已与 ${pB.nick} 结为「${def.name}」` });
        console.log(`[social] ${p.nick} 与 ${pB.nick} 结为 ${def.name}`);
        break;
      }
      case 'social_unbind': {
        const p = state.online.get(uid!);
        if (!p) break;
        const target = resolveOnlineUid(state, String(msg.target || '')) || '';
        const { p: pair } = pairOf(state, uid!, target);
        if (!pair.relation) { send({ t: 'social_result', social: 'unbind', ok: false, msg: '你们没有特殊关系' }); break; }
        const relName = RELATION_DEFS[pair.relation]?.name || pair.relation;
        pair.relation = '';
        pair.relBy = '';
        state.persist();
        app.log.append('social.relation', uid!, { a: uid!, b: target, relation: '', by: uid! });
        const pB = state.online.get(target);
        for (const [, o] of state.online) sendTo(o, { t: 'chat', uid: 'sys', nick: '系统', text: `${p.nick} 解除了与 ${pB ? pB.nick : target} 的关系（${relName}）` });
        send({ t: 'social_result', social: 'unbind', ok: true, msg: `已解除「${relName}」关系` });
        break;
      }
      case 'social_tp': {
        const p = state.online.get(uid!);
        if (!p) break;
        const target = resolveOnlineUid(state, String(msg.target || '')) || '';
        const pB = state.online.get(target);
        if (!pB) { send({ t: 'social_result', social: 'tp', ok: false, msg: '对方不在线' }); break; }
        const { p: pair } = pairOf(state, uid!, target);
        if (pair.relation !== 'partner') { send({ t: 'social_result', social: 'tp', ok: false, msg: '只有「伴侣」可以传送（需要好感 ≥ 90 并绑定）' }); break; }
        if (p.scene !== pB.scene) { send({ t: 'social_result', social: 'tp', ok: false, msg: '对方不在同一场景，先到 TA 的场景再传送' }); break; }
        let tx = pB.x + 200, ty = pB.y;
        if (blockedAt(app.tables, Math.floor(tx / 100), Math.floor(ty / 100))) { tx = pB.x - 200; ty = pB.y; }
        if (blockedAt(app.tables, Math.floor(tx / 100), Math.floor(ty / 100))) { tx = pB.x; ty = pB.y + 200; }
        if (blockedAt(app.tables, Math.floor(tx / 100), Math.floor(ty / 100))) { tx = pB.x; ty = pB.y - 200; }
        p.x = tx; p.y = ty;
        for (const [k, o] of state.online) if (k !== uid) sendTo(o, { t: 'move', uid, scene: p.scene, x: tx, y: ty });
        send({ t: 'social_tp_apply', x: tx, y: ty });
        send({ t: 'social_result', social: 'tp', ok: true, msg: `✨ 传送到伴侣 ${pB.nick} 身边` });
        console.log(`[social] ${p.nick} 传送到伴侣 ${pB.nick} 身边`);
        break;
      }
      case 'task_list': {
        const t = tasksOf(state, uid!);
        const out = TASK_DEFS.map(d => ({
          id: d.id, name: d.name, desc: d.desc,
          cur: t.done[d.id] ? d.count : (t.list[d.id] ? t.list[d.id].cur : 0),
          total: d.count, done: !!t.done[d.id],
          reward: d.reward ? `${taskRewardNameInline(app, d.reward.id)}×${d.reward.num}` : '',
        }));
        send({ t: 'task_list', tasks: out });
        break;
      }
      case 'agent_msg': {
        const p = state.online.get(uid!);
        if (!p) break;
        const text = String(msg.text || '').slice(0, 500);
        const acc = Object.values(app.accounts.accounts).find(a => a.uid === uid!);
        if (acc) {
          app.inboxPush(uid!, p.nick, text);
          const s = app.agentSockets.get(uid!);
          if (s) for (const w of s) if (w.readyState === 1) w.send(JSON.stringify({ t: 'inbox_push' }));
        }
        break;
      }
      case 'dm_send': {
        const p = state.online.get(uid!);
        if (!p) break;
        const target = resolveOnlineUid(state, String(msg.target || '')) || '';
        if (!target || target === uid) { send({ t: 'dm_result', ok: false, msg: '无效目标' }); break; }
        if (!dmUnlocked(state, uid!, target)) { send({ t: 'dm_result', ok: false, msg: '还没和 TA 见过面，先去打招呼吧' }); break; }
        const text = String(msg.text || '').slice(0, 500);
        if (!text) { send({ t: 'dm_result', ok: false, msg: '消息为空' }); break; }
        const entry = { from: uid!, nick: p.nick, text, at: Date.now() };
        app.dm.push(uid!, target, entry);
        const pB = state.online.get(target);
        if (pB) sendTo(pB, { t: 'dm_in', from: uid, nick: p.nick, text });
        const agSock = app.agentSockets.get(target);
        if (agSock) for (const w of agSock) if (w.readyState === 1) w.send(JSON.stringify({ t: 'dm_in', from: uid, nick: p.nick, text }));
        send({ t: 'dm_result', ok: true });
        break;
      }
      case 'dm_log': {
        const p = state.online.get(uid!);
        if (!p) break;
        const target = resolveOnlineUid(state, String(msg.target || '')) || '';
        if (!target) { send({ t: 'dm_log', msgs: [] }); break; }
        const { arr } = app.dm.logOf(uid!, target);
        send({ t: 'dm_log', msgs: arr.slice(-50) });
        break;
      }
      case 'dm_unlocked': {
        const p = state.online.get(uid!);
        if (!p) break;
        send({ t: 'dm_unlocked_list', peers: dmUnlockedList(state, uid!) });
        break;
      }
      case 'agent_interrupt': {
        const p = state.online.get(uid!);
        if (!p) break;
        // D4 硬停：AbortController 立即终止进行中的移动任务（200ms 内广播 done），不再靠 Agent 自律
        const task = state.agentMoves.get(uid!);
        if (task) task.abort();
        notePlayerOp(app, uid!, 'interrupt', '你手动按了 ⏸，Agent 已停手等你指挥');
        break;
      }
      case 'agent_arrive': {
        // D1 确认环：客户端回报托管角色实际落点（托管期间本地坐标不自动回传，以此为准）
        const p = state.online.get(uid!);
        if (!p || p.ws !== ws) break;
        const x = Number(msg.x), y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) break;
        p.x = x; p.y = y;
        if (msg.scene !== undefined) p.scene = Math.round(Number(msg.scene));
        for (const [k, o] of state.online) if (k !== uid) sendTo(o, { t: 'move', uid, scene: p.scene, x, y });
        if (!deliverArrive(state, uid!, { index: Number(msg.index ?? -1), x, y })) {
          const r = state.agentRoutes.get(uid!);
          if (r) r.actual = { scene: p.scene, x, y }; // 无待确认（未移动/盲推中）：仅记录真实位置
        }
        break;
      }
      case 'agent_resume': {
        const s = app.agentSockets.get(uid!);
        if (s && s.size) {
          for (const w of s) if (w.readyState === 1) w.send(JSON.stringify({ t: 'agent_resume' }));
          publishAgentActivityGlobal(app, uid!, '恢复行动，继续原计划');
          console.log(`[agent-resume] 玩家 ${uid} 要求 Agent 恢复行动`);
        }
        break;
      }
      // ---------- M1 导演镜头：观战 ----------
      case 'spectate': {
        const p = state.online.get(uid!);
        if (!p) break;
        const watch = String(msg.watch || 'events');
        const target = watch === 'events' || watch.startsWith('agent:') ? watch : 'events';
        app.narrative.liveDirector.setWatch(uid!, target);
        send({ t: 'spectate_ack', watch: target });
        break;
      }
      case 'unspectate': {
        const p = state.online.get(uid!);
        if (!p) break;
        app.narrative.liveDirector.clearWatch(uid!);
        send({ t: 'unspectate_ack' });
        break;
      }
    }
  });

  ws.on('close', () => {
    // 仅当关闭的是当前在线记录对应的连接时才移除（防双开被顶掉的旧连接误删新连接）
    if (uid && state.online.get(uid)?.ws === ws) {
      state.online.delete(uid);
      dropScenePeer(state, uid);
      app.narrative.liveDirector.clearWatch(uid); // M1：断开时清观战
      for (const [k, p] of state.online) sendTo(p, { t: 'player_leave', uid });
      console.log(`[leave] ${uid} 在线:${state.online.size}`);
    }
  });
}

function taskRewardNameInline(app: App, id: number): string {
  const it = app.tables.items.find(x => x.id === id);
  return it ? (it.name ?? '物品' + id) : '物品' + id;
}

// ============================================================
// 外部 agent 通道 /agent?token=AGENT_TOKEN
// ============================================================
export function agentConn(app: App, ws: WebSocket, url: URL): void {
  const state = app.state;
  ws.on('error', () => { try { ws.terminate(); } catch { /* ignore */ } });

  const token = url.searchParams.get('token');
  const acc = app.accounts.findAccountByToken(token);
  if (!acc || !acc.agentToken || token !== acc.agentToken) {
    console.log('[agent] 拒绝: 无效接入码');
    ws.close(4001, 'bad agent token');
    return;
  }
  const uid = acc.uid;
  const nick = acc.nick || uid;
  const username = app.accounts.usernameOf(acc);
  app.state.ensurePlayerData(uid);
  console.log(`[agent] 接入: ${nick} (${uid})`);
  if (!app.agentSockets.has(uid)) app.agentSockets.set(uid, new Set());
  app.agentSockets.get(uid)!.add(ws);

  // 托管直接驱动玩家本体（相机/外观复用原版 playerNode）
  const pd0 = (state.playersDb.get(uid)?.get('playerData') || {}) as Record<string, unknown>;
  const livePos = state.online.get(uid);
  const apos0 = state.agentPos.get(uid) || (livePos
    ? { x: livePos.x, y: livePos.y, scene: livePos.scene }
    : {
      x: (pd0.playerPos as { x?: number } | undefined)?.x ?? 0,
      y: (pd0.playerPos as { y?: number } | undefined)?.y ?? 0,
      scene: (pd0.sceneType as number | undefined) ?? 2,
    });
  // 起步位置兜底：落在墙内/不可达时吸附到最近可达格（仅村景有运行时碰撞；其他场景保持存档位）
  const sg = Math.floor((apos0.x ?? 0) / 100), sh = Math.floor((apos0.y ?? 0) / 100);
  if ((apos0.scene ?? 2) === 2) {
    const sn = nearestReachable(app.tables, sg, sh, 15);
    if (!sn) { apos0.x = 3500; apos0.y = 3000; }
    else { apos0.x = sn[0] * 100 + 50; apos0.y = sn[1] * 100 + 50; }
  }
  state.agentPos.set(uid, apos0);
  for (const [k, p] of state.online) if (k === uid) sendTo(p, { t: 'agent_status', online: true, nick });

  const send = (obj: unknown) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  const pm = state.playersDb.get(uid);

  ws.on('message', (raw) => {
    const msg = parseAgentMsg(JSON.parse(String(raw)));
    if (!msg) return;
    switch (msg.t as string) {
      case 'observe': {
        send({ t: 'state', ...observeState(app, uid, username, nick) });
        break;
      }
      case 'inbox': {
        const msgs = app.inboxDrain(uid).map(m => ({ from: m.from, text: m.text, at: m.at }));
        send({ t: 'inbox', msgs });
        break;
      }
      case 'chat_log': {
        send({ t: 'chat_log', msgs: app.chatLog.slice(-20) });
        break;
      }
      case 'agent_move_state': {
        send({ t: 'agent_move_state', moving: state.agentMoves.has(uid) });
        break;
      }
      case 'dm_send': {
        const target = resolveAnyUid(state, app.accounts, String(msg.target || '')) || '';
        if (!target || target === uid) { send({ t: 'dm_result', ok: false, msg: '无效目标' }); break; }
        if (!dmUnlocked(state, uid, target)) { send({ t: 'dm_result', ok: false, msg: '还没和 TA 见过面' }); break; }
        const text = String(msg.text || '').slice(0, 500);
        if (!text) { send({ t: 'dm_result', ok: false, msg: '消息为空' }); break; }
        const entry = { from: uid, nick, text, at: Date.now(), agent: true };
        app.dm.push(uid, target, entry);
        const pB = state.online.get(target);
        if (pB) sendTo(pB, { t: 'dm_in', from: uid, nick, text });
        const agSock = app.agentSockets.get(target);
        if (agSock) for (const w of agSock) if (w.readyState === 1) w.send(JSON.stringify({ t: 'dm_in', from: uid, nick, text, agent: true }));
        send({ t: 'dm_result', ok: true, delivered: !!pB });
        break;
      }
      case 'dm_log': {
        const target = resolveOnlineUid(state, String(msg.target || '')) || '';
        if (!target) { send({ t: 'dm_log', msgs: [] }); break; }
        const { arr } = app.dm.logOf(uid, target);
        send({ t: 'dm_log', msgs: arr.slice(-50) });
        break;
      }
      case 'dm_unlocked': {
        send({ t: 'dm_unlocked_list', peers: dmUnlockedList(state, uid) });
        break;
      }
      case 'act': {
        const action = String(msg.action || '');
        const pd = (pm?.get('playerData') || {}) as Record<string, unknown>;
        const apos = state.agentPos.get(uid) || {
          x: (pd.playerPos as { x?: number } | undefined)?.x ?? 0,
          y: (pd.playerPos as { y?: number } | undefined)?.y ?? 0,
          scene: (pd.sceneType as number | undefined) ?? 2,
        };
        let result: Record<string, unknown> = { ok: false, msg: 'unknown action' };
        let responseType = 'result';
        const STEP = app.agentMoveStep;
        const publish = (text: string) => publishAgentActivityGlobal(app, uid, text);
        do {
          if (action === 'move') {
            let nx = apos.x ?? 0, ny = apos.y ?? 0;
            const dir = String(msg.dir || '');
            if (dir === 'up') ny += STEP;
            else if (dir === 'down') ny -= STEP;
            else if (dir === 'left') nx -= STEP;
            else if (dir === 'right') nx += STEP;
            else { result.msg = 'dir 需为 up/down/left/right'; continue; }
            if (blockedHouse(app.tables, apos.scene, nx, ny)) { result.msg = '前方有障碍'; continue; }
            if (nx < 0 || ny < 0) { result.msg = '地图边界'; continue; }
            apos.x = nx; apos.y = ny;
            publishAgentMove(app, state, uid, apos);
            persistAgentPosition(app, state, uid, apos);
            publish('移动中 (' + Math.round(apos.x) + ',' + Math.round(apos.y) + ')');
            result = { ok: true, pos: { x: nx, y: ny }, scene: apos.scene };
           } else if (action === 'chat') {
            const text = String(msg.text || '').slice(0, 200);
            app.chatLog.push({ nick: nick + '(托管)', text, at: Date.now(), isAgent: true });
            while (app.chatLog.length > 50) app.chatLog.shift();
            for (const [, o] of state.online) sendTo(o, { t: 'chat', uid, nick: nick + '(托管)', text, isAgent: true });
            console.log(`[agent-chat] ${nick}: ${text}`);
            publish('正在说话');
            result = { ok: true, sent: text };
          } else if (action === 'letter') {
            // P2 邮局：写信给在线目标（收件箱走 notes.pushInbox 持久化；对方 observe.inbox 可见，{t:'inbox'} 拉取）
            const to = String(msg.to || '').trim();
            const body = String(msg.body || '').slice(0, 400);
            if (!to || !body) { result = { ok: false, msg: 'letter 需要 to（昵称）与 body（信文）' }; continue; }
            const target = Array.from(state.online.values()).find(o => o.nick === to || String(o.uid) === to);
            if (!target) { result = { ok: false, msg: `收信人 ${to} 不在线（在线：${Array.from(state.online.values()).map(o => o.nick).join('/') || '无'}）` }; continue; }
            app.inboxPush(String(target.uid), nick, `[letter] ${body}`);
            publish(`给${target.nick}写了封信`);
            result = { ok: true, to: target.nick, msg: '信已投进对方邮局（对方 observe 的 inbox 可见）' };
          } else if (action === 'forecast') {
            // P2 气象台（北环小塔）：明日天气预告（日历确定性纯函数；投保钩子随经济类 M-B1 冻结，此处只播报）
            const day = currentGameDay(state, Date.now());
            const tm = calendarDay(day + 1);
            const hints: string[] = [];
            if (tm.weather === 'storm') hints.push(`明日风暴：作物受灾（保险赔付 ${STORM_INSURANCE_PER_PLANT}/株 次日发放）`);
            if (tm.weather === 'rain') hints.push('明日有雨（生长 x1.5，钓点丰收）');
            if (tm.festival) hints.push(`明日节日「${tm.festival}」：赛事锚点在村中央宴会厅（observe 的 festival 字段有明细）`);
            result = { ok: true, day, tomorrow: { season: tm.season, weather: tm.weather, festival: tm.festival }, hints, msg: `明日（第 ${day + 1} 天）${tm.weather === 'clear' ? '晴朗' : tm.weather === 'rain' ? '有雨' : tm.weather === 'snow' ? '下雪' : '风暴'}` };
          } else if (action === 'train') {
            // P2 健身房（东环新楼）：属性训练（力量/敏捷/亲和）+ 冷却；位置门：健身房门位 6 格内
            const gym = buildingTargetOf(municipalOf(app), 'gym');
            const curScene = apos.scene ?? 2;
            if (!gym || curScene !== 2) { result = { ok: false, msg: '训练需在村景健身房（先 move_to {near:"健身房"}）' }; continue; }
            const gx = Math.floor(gym.x / 100), gy = Math.floor(gym.y / 100);
            const inGym = Math.abs(Math.floor((apos.x ?? 0) / 100) - gx) <= 6 && Math.abs(Math.floor((apos.y ?? 0) / 100) - gy) <= 6;
            if (!inGym) { result = { ok: false, msg: `离健身房太远（需 move_to {near:"健身房"} 到门位附近）` }; continue; }
            const tr = trainAttr(state, uid, String(msg.attr || ''), Date.now());
            result = tr.ok
              ? { ok: true, attr: msg.attr, level: tr.level, msg: tr.msg }
              : { ok: false, waitSec: tr.waitSec, msg: tr.msg };
          } else if (action === 'report') {
            // P2 银行（102 gfujia）：资产日报——只读快照写入 agent 日报文件（存取计息钩子 M-B1 冻结）
            const curScene = apos.scene ?? 2;
            if (curScene !== 102) { result = { ok: false, msg: '资产日报在银行办理（先 move_to {near:"银行"} 跨场景到 102）' }; continue; }
            const nameOfItem = (id: number) => app.tables.nameOf(id);
            const kn = (pm?.get('knapData') as { props?: Array<{ id: number; num: number }> } | undefined)?.props || [];
            const coins = kn.find(p => p.id === 1)?.num || 0;
            const knapItems = kn.filter(p => p.id !== 1).map(p => ({ id: p.id, num: p.num, name: nameOfItem(p.id) })).slice(0, 10);
            const day = currentGameDay(state, Date.now());
            const text = `资产日报：金币 ${coins}；背包 ${knapItems.length ? knapItems.map(k => `${k.name}x${k.num}`).join('、') : '空'}`;
            app.notes.writeDailyReport(app.usernameOf(uid), text, day);
            result = { ok: true, coins, items: knapItems, day, msg: `资产日报已存档（金币 ${coins}；${knapItems.length} 类物品）` };
          } else if (action === 'move_to') {
            // D1 执行确认闭环 + D3 交互环 + D6 跨场景：目标吸附可站立环 -> 全路径 -> 逐段发航点 + arrive 确认（盲推仅离线/debug 回落）
            // P2 near 目标解析：near=water|npc（交互环）或 建筑名（buildings.json -> 场景+门位像素；跨场景自动解门户）
            const nearRaw = typeof msg.near === 'string' ? msg.near : undefined;
            const ring = nearRaw === 'water' || nearRaw === 'npc' ? (nearRaw as 'water' | 'npc') : undefined;
            const curScene = apos.scene ?? 2;
            const building = nearRaw && !ring ? buildingTargetOf(municipalOf(app), nearRaw) : null;
            if (nearRaw && !ring && !building) {
              const muNames = Array.from(municipalOf(app).buildings.values()).flat().filter(b => !b.pending && b.door).map(b => b.name).join(' / ');
              result = { ok: false, msg: `near="${nearRaw}" 无法解析（可用：water / npc / 建筑名：${muNames || '无'}）` }; continue;
            }
            let targetScene = msg.scene === undefined ? curScene : Math.round(Number(msg.scene));
            let tx = Math.floor(Number(msg.x) / 100), ty = Math.floor(Number(msg.y) / 100);
            if (building) { targetScene = building.scene; tx = Math.floor(building.x / 100); ty = Math.floor(building.y / 100); }
            console.log(`[agent-move_to] ${nick} 目标 ${building ? `「${building.name}」` : `(${msg.x},${msg.y})`} 当前 (${apos.x},${apos.y}) 场景 ${curScene}->${targetScene} near=${ring || building?.name || '-'}`);
            if (state.agentMoves.has(uid)) { result = { ok: false, msg: '上一个移动还没走完，请稍等' }; continue; }
            if (targetScene === curScene) {
              // 同场景：A* 逐格路径（现状主流程）
              const sx = Math.floor((apos.x ?? 0) / 100), sy = Math.floor((apos.y ?? 0) / 100);
              const nav = navOf(app, curScene);
              // D3：目标先吸附交互环（障碍格目标不再直接不可达；near=water 吸附水边；near=npc 吸附碰撞外一格）
              const goal = (nav && snapInteraction(nav, tx, ty, ring)) ?? [tx, ty];
              const gx = goal[0], gy = goal[1];
              if (sx === gx && sy === gy) { result = { ok: true, msg: '已经在目标位置，无需移动' }; continue; }
              const path = (nav && astarClearance(nav, sx, sy, gx, gy, { wallHug: msg.wallHug === true })) ?? bfsPath(app.tables, sx, sy, gx, gy);
              console.log(`[agent-move_to] 路径: ${path ? path.length + ' 步' : '不可达'}（目标吸附到 ${gx},${gy}）`);
              if (!path) { result = { ok: false, msg: '目标不可达（被障碍包围）' }; continue; }
              if (path.length < 2) { result = { ok: true, msg: '已经在目标位置，无需移动' }; continue; }
              if (path.length > 60) { result = { ok: false, msg: `路径过长(${path.length}步)，请分两段走（先到中途点再继续）` }; continue; }
              publish(`赶路中：前往 (${gx},${gy}) 附近`);
              apos.x = path[0][0] * 100 + 50; apos.y = path[0][1] * 100 + 50;
              // 航点抽稀（每 4 格一航点 + 终点；cellI = 该航点在 path 中的格序，盲推回调用）
              // 终点取实际路径末格（BFS 回落可能吸附到目标旁可走格，避免终点悬在障碍上）
              const [fpx, fpy] = path[path.length - 1];
              const wpScene = curScene;
              const wps: Array<{ scene: number; x: number; y: number; cellI: number }> = [];
              for (let k = 1; k < path.length; k += 4) wps.push({ scene: wpScene, x: path[k][0] * 100 + 50, y: path[k][1] * 100 + 50, cellI: k });
              wps.push({ scene: wpScene, x: fpx * 100 + 50, y: fpy * 100 + 50, cellI: path.length - 1 });
              const route: AgentRoute = {
                waypoints: wps, i: 0, misses: 0, totalMisses: 0,
                target: { scene: wpScene, x: fpx * 100 + 50, y: fpy * 100 + 50 },
                actual: { scene: wpScene, x: apos.x, y: apos.y },
                path, pathI: 0,
              };
              state.agentRoutes.set(uid, route);
              startNavTask(app, state, uid, apos, route, (out) => {
                send({ t: 'result', action, seq: msg.seq, ...(out as Record<string, unknown>) });
                console.log(`[agent-move_to] ${nick} 任务结束: ${JSON.stringify(out)}`);
              });
              // L3 市政指引（roads-landmarks §4）：路线主路名（roadOf 反查，取路径上占比最高路段）
              let road: string | null = null;
              if (nav) {
                const rc = new Map<string, number>();
                for (const [cx, cy] of path) {
                  const rn = roadOf(nav, cx, cy);
                  if (rn) rc.set(rn, (rc.get(rn) || 0) + 1);
                }
                let top = 0;
                for (const [rn, n] of rc) if (n > top) { top = n; road = rn; }
              }
              result = {
                ok: true,
                msg: `已开始移动：${path.length - 1} 步 / ${wps.length} 航点${road ? `（沿「${road}」）` : ''}（客户端将按航点回报 arrive，偏差自动重规划）`,
                waypoints: wps.map(({ cellI, ...w }) => w),
                next: { index: 0, x: wps[0].x, y: wps[0].y },
                segMs: app.navArriveTimeoutMs,
                ...(road ? { road } : {}),
              };
              responseType = 'move_started';
              continue;
            }
            // 跨场景：D6 门户图 Dijkstra + 场景内 A*（planRoute 全量重规划级）
            const toNav = navOf(app, targetScene);
            if (!toNav) { result = { ok: false, msg: `场景 ${targetScene} 无导航数据（跨场景未启用）` }; continue; }
            const goal = snapInteraction(toNav, tx, ty, ring) ?? [tx, ty];
            const pr = planRoute(
              { scene: curScene, x: apos.x, y: apos.y },
              { scene: targetScene, x: goal[0] * 100 + 50, y: goal[1] * 100 + 50 },
              (sc) => navOf(app, sc), portalsOf(app), { wallHug: msg.wallHug === true },
            );
            if (!pr.ok) { result = { ok: false, msg: pr.msg || '跨场景不可达' }; continue; }
            if (pr.waypoints.length < 1) { result = { ok: true, msg: '已经在目标位置，无需移动' }; continue; }
            publish(`跨场景赶路中：${curScene} -> ${targetScene}（${pr.waypoints.length} 航点）`);
            const wps2: Array<{ scene: number; x: number; y: number; cellI: number }> = pr.waypoints.map((w, i) => ({ scene: w.scene, x: w.x, y: w.y, cellI: i }));
            const route2: AgentRoute = {
              waypoints: wps2, i: 0, misses: 0, totalMisses: 0,
              target: { scene: targetScene, x: wps2[wps2.length - 1].x, y: wps2[wps2.length - 1].y },
              actual: { scene: curScene, x: apos.x, y: apos.y },
              path: null, pathI: 0, // 跨场景无逐格路径：盲推段粗步（含场景侧传送）
            };
            state.agentRoutes.set(uid, route2);
            startNavTask(app, state, uid, apos, route2, (out) => {
              send({ t: 'result', action, seq: msg.seq, ...(out as Record<string, unknown>) });
              console.log(`[agent-move_to] ${nick} 跨场景任务结束: ${JSON.stringify(out)}`);
            });
            result = {
              ok: true,
              crossScene: true,
              msg: `跨场景移动：${pr.waypoints.length} 航点（场景切换段客户端走原版传送，其余按 arrive 确认）`,
              waypoints: wps2.map(({ cellI, ...w }) => w),
              next: { index: 0, x: wps2[0].x, y: wps2[0].y },
              segMs: app.navArriveTimeoutMs,
            };
            responseType = 'move_started';
          } else if (action === 'arrive') {
            // D1 确认环：agent/客户端确认到达第 i 个航点（偏差超限由服务端自动重规划；连续 3 次超限终止路线）
            const idx = Number(msg.index ?? 0);
            const ax = Number(msg.x ?? apos.x), ay = Number(msg.y ?? apos.y);
            if (deliverArrive(state, uid, { index: idx, x: ax, y: ay })) {
              result = { ok: true, matched: true, consumed: true };
              continue;
            }
            const route = state.agentRoutes.get(uid);
            if (!route) { result = { ok: false, msg: '无活动路线（先 move_to）' }; continue; }
            // 无待确认（盲推进行中 / 非本段）：只记录真实位置
            route.actual = { scene: apos.scene ?? 2, x: ax, y: ay };
            result = { ok: true, matched: false, index: idx, recorded: true, msg: '路线推进中（盲推分支），实际位置已记录' };
          } else if (action === 'talk') {
            const npcId = Number(msg.npcId || msg.id);
            const npc = app.tables.npcs.find(n => n.id === npcId);
            if (!npc) { result = { ok: false, msg: '没有这个 NPC（id 1-26）' }; continue; }
            const shop = shopOf(app)[npcId];
            const priceLines = !shop || !shop.length ? null
              : shop.map(([itemId, price]) => {
                  const it = app.tables.items.find(x => x.id === itemId);
                  return `${it ? (it.name ?? '物品' + itemId) : '物品' + itemId}（id=${itemId}）${price} 金币/个`;
                });
            const pricePart = !priceLines ? `${npc.name}：我只是个村民，不卖东西。`
              : `${npc.name}：我这里的货：${priceLines.join('，')}。报物品 id 和数量就能买。`;
            const persona = npc.persona;
            const fallback = persona ? persona.tagline : '嗯。';
            if (persona && app.cognition?.llm) {
              const day = currentGameDay(state, Date.now());
              const tm = calendarDay(day);
              const system = `${npc.name}，${persona.identity}。口头禅：${persona.tagline}。性格：${persona.desc} 当前：第${day}天 ${tm.weather}${tm.festival ? ' 节日'+tm.festival : ''}`;
              const userMsg = String(msg.text || '你好');
              ;(async () => {
                try {
                  const reply = await app.cognition.llm(uid).chat(uid, system, userMsg, 'dialogue') ?? fallback;
                  send({ t: 'result', action: 'talk', seq: msg.seq, ok: true, npcId, dialogue: reply, msg: `${npc.name}：${reply}` });
                } catch { /* llm 不可用：已发价目表，对话降级 */ }
              })();
            }
            result = { ok: true, msg: pricePart, priceList: priceLines, dialogue: null };
          } else if (action === 'buy') {
            const itemId = Number(msg.itemId || msg.item);
            const count = Math.max(1, Number(msg.count || 1));
            const br = doBuy(state, app.tables, uid, itemId, count, shopOf(app));
            if (br.ok) {
              // 事件溯源：金币消耗 + 物品获得
              app.log.append('item.consumed', uid, { uid, itemId: 1, num: br.bought!.total });
              app.log.append('item.gained', uid, { uid, itemId, num: count });
              taskCount(state, app.tables, uid, 'buy', count);
              app.log.append('task.progress', uid, { uid, type: 'buy', n: count });
              publish('正在购买' + (br.bought?.name || ''));
              result = { ok: true, bought: br.bought, coins: br.coins };
            } else {
              result = { ok: false, msg: br.msg };
            }
          } else if (action === 'trade') {
            // B1.2 CDA 订单簿：op=place|cancel|book；place {item, side, price, qty} / cancel {item, orderId}
            const op = String(msg.op || 'place');
            const itemId = Number(msg.itemId || msg.item);
            if (op === 'book') {
              const v = app.market.marketView(itemId);
              const bk = v.book;
              result = {
                ok: true, book: bk,
                msg: `物品${itemId}订单簿 买盘[${bk.bids.map(l => `${l.price}x${l.qty}`).join('/') || '空'}] 卖盘[${bk.asks.map(l => `${l.price}x${l.qty}`).join('/') || '空'}]${bk.last ? ` 最近成交 ${bk.last.price}x${bk.last.qty}` : ''}（含 10% 系统手续费，卖方实收 90%）`,
              };
            } else if (op === 'cancel') {
              const cr = app.market.cancel(uid, itemId, Number(msg.orderId));
              publish(cr.ok ? '撤单' : '撤单失败');
              result = cr.ok ? { ok: true, msg: '已撤单（预留已退还）' } : { ok: false, msg: cr.msg };
            } else {
              const side = msg.side === 'sell' ? 'sell' : 'buy';
              const price = Number(msg.price);
              const qty = Math.max(1, Number(msg.qty || 1));
              const pr = app.market.place(uid, itemId, side, price, qty);
              if (pr.ok) {
                taskCount(state, app.tables, uid, 'trade', qty);
                app.log.append('task.progress', uid, { uid, type: 'trade', n: qty });
                publish(`${side === 'buy' ? '买入' : '卖出'}订单 ${qty}x 物品${itemId} @ ${price}`);
                // 行情广播：在线玩家收 tick；agent 端 result 带成交明细
                const last = pr.fills && pr.fills.length ? pr.fills[pr.fills.length - 1] : null;
                for (const [, p] of state.online) sendTo(p, { t: 'market.tick', item: itemId, last });
                result = {
                  ok: true, orderId: pr.orderId, resting: pr.resting, fills: pr.fills?.length ?? 0,
                  msg: pr.fills?.length
                    ? `成交 ${pr.fills.length} 笔（价取挂单方）${pr.resting ? `，余 ${pr.resting} 挂簿` : ''}`
                    : `已挂单 ${pr.resting} 手（订单号 ${pr.orderId}）`,
                };
              } else {
                result = { ok: false, msg: pr.msg };
              }
            }
          } else if (action === 'till') {
            const _t = normXYOf(app, msg.x, msg.y);
            const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
            const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
            if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = '离目标太远（需要站在目标格相邻格）'; continue; }
            if (plotAt(state, gx, gy)) { result.msg = '这块地已经犁过了'; continue; }
            if (plantAtWorld(state, gx, gy)) { result.msg = '这个格子上有植物了'; continue; }
            if (waterAt(app.tables, gx, gy) || blockedAt(app.tables, gx, gy)) { result.msg = '这个格子不能犁（水面/障碍）'; continue; }
            if (!soilAt(app.tables, gx, gy)) { result.msg = `这个格子不是可耕种土地（${gx},${gy}）`; continue; }
            worldPlots(state).push({ x: gx, y: gy, plantUID: 0, farmType: 1, owner: uid });
            state.persist();
            app.log.append('plot.tilled', uid, { x: gx, y: gy, owner: uid });
            taskCount(state, app.tables, uid, 'till');
            app.log.append('task.progress', uid, { uid, type: 'till', n: 1 });
            publish(`正在犁地 (${gx},${gy})`);
            result = { ok: true, tilled: { gx, gy }, msg: `犁好了 (${gx},${gy}) 的田地，可以播种了` };
          } else if (action === 'water') {
            const _t = normXYOf(app, msg.x, msg.y);
            const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
            const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
            if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = '离目标太远（需要站在目标格相邻格）'; continue; }
            const p = plantAtWorld(state, gx, gy);
            if (!p) { result.msg = '这个格子上没有作物可浇'; continue; }
            if (p.farmType !== 1) { result.msg = '这是场景植物，不需要浇水'; continue; }
            const crop = app.tables.cropOf(p.plantId);
            if (!crop) { result.msg = '未知作物'; continue; }
            if ((p.growDay ?? 0) >= crop.days) { result.msg = `${crop.name}已经成熟了，直接收获吧`; continue; }
            const nowT = Date.now();
            p.sownAt = Math.max(p.sownAt! - app.growDayMs, nowT - app.growDayMs * crop.days);
            p.growDay = Math.min(crop.days, Math.floor((nowT - p.sownAt) / app.growDayMs));
            state.persist();
            app.log.append('crop.watered', uid, { uId: p.uId, sownAt: p.sownAt!, growDay: p.growDay! });
            taskCount(state, app.tables, uid, 'water');
            app.log.append('task.progress', uid, { uid, type: 'water', n: 1 });
            publish(`正在给${crop.name}浇水`);
            result = { ok: true, watered: { crop: crop.name, gx, gy }, msg: `给${crop.name}浇了水，生长推进（${p.growDay}/${crop.days}天）` };
          } else if (action === 'plant') {
            const seedId = Number(msg.itemId || msg.seed);
            const crop = PLANT_CROPS[seedId];
            if (!crop) { result.msg = `没有这种种子（可用种子 id：${Object.keys(PLANT_CROPS).join('/')}，先用 buy 买）`; continue; }
            const _t = normXYOf(app, msg.x, msg.y);
            const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
            const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
            if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = `离目标太远（需要站在目标格相邻格，当前 (${px},${py}) 目标 (${gx},${gy})）`; continue; }
            if (!knapHas(pm, seedId, 1)) { result.msg = `背包里没有 ${crop.name}种子（先用 buy 买 id=${seedId}）`; continue; }
            if (!soilAt(app.tables, gx, gy) && !plotAt(state, gx, gy)) { result.msg = `这个格子不能种（${gx},${gy}）：不是可种土或农田`; continue; }
            if (plantAtWorld(state, gx, gy)) { result.msg = '这个格子已经有植物了'; continue; }
            knapSub(pm, seedId, 1);
            const p = { uId: nextPlantUid(state), plantId: crop.plantId, x: gx, y: gy, hp: 10, farmType: 1, growDay: 0, sownAt: Date.now() };
            worldPlants(state).push(p);
            const plot = worldPlots(state).find(pl => pl.x === gx && pl.y === gy);
            if (plot) plot.plantUID = p.uId;
            state.persist();
            app.log.append('plant.sown', uid, { uId: p.uId, plantId: crop.plantId, x: gx, y: gy, sownAt: p.sownAt });
            app.log.append('item.consumed', uid, { uid, itemId: seedId, num: 1 });
            taskCount(state, app.tables, uid, 'plant');
            app.log.append('task.progress', uid, { uid, type: 'plant', n: 1 });
            result = { ok: true, planted: { crop: crop.name, gx, gy, uid: p.uId }, msg: `种下了${crop.name}（${crop.days} 天后成熟，growDay=${p.growDay}）` };
          } else if (action === 'harvest') {
            const _t = normXYOf(app, msg.x, msg.y);
            const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
            const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
            if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = '离目标太远（需要站在目标格相邻格）'; continue; }
            const p = plantAtWorld(state, gx, gy);
            if (!p) { result.msg = '这个格子上没有作物'; continue; }
            if (p.farmType !== 1) { result.msg = '这不是你种的作物（是场景植物）'; continue; }
            const crop = app.tables.cropOf(p.plantId);
            if (!crop) { result.msg = '未知作物'; continue; }
            if ((p.growDay ?? 0) < crop.days) { result.msg = `${crop.name}还没成熟（${p.growDay ?? 0}/${crop.days} 天）`; continue; }
            worldPlants(state).splice(worldPlants(state).indexOf(p), 1);
            const plot = worldPlots(state).find(pl => pl.plantUID === p.uId);
            if (plot) plot.plantUID = 0;
            knapAdd(pm, crop.cropItemId, 1);
            state.persist();
            app.log.append('crop.harvested', uid, { uId: p.uId });
            app.log.append('item.gained', uid, { uid, itemId: crop.cropItemId, num: 1 });
            taskCount(state, app.tables, uid, 'harvest');
            app.log.append('task.progress', uid, { uid, type: 'harvest', n: 1 });
            publish('正在收获' + crop.name);
            // B11 秋丰收：收获次数计分（仅丰收日生效）
            recordFestivalScore(app, uid, 1, 'harvest');
            result = { ok: true, harvested: { crop: crop.name, itemId: crop.cropItemId }, msg: `收获了${crop.name} ×1，已放入背包` };
          } else if (action === 'chop') {
            const _t = normXYOf(app, msg.x, msg.y);
            const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
            const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
            if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = '离目标太远（需要站在目标格相邻格）'; continue; }
            const p = growPlants(state).find(pl => pl.x === gx && pl.y === gy && treeOf(pl));
            if (!p) { result.msg = '这个格子上没有树'; continue; }
            p.hp = (p.hp || 10) - 20;
            if (p.hp <= 0) {
              worldPlants(state).splice(worldPlants(state).indexOf(p), 1);
              const plot = worldPlots(state).find(pl => pl.plantUID === p.uId);
              if (plot) plot.plantUID = 0;
              knapAdd(pm, 18, 3);
              state.persist();
              app.log.append('tree.chopped', uid, { uId: p.uId, hp: p.hp });
              app.log.append('item.gained', uid, { uid, itemId: 18, num: 3 });
              taskCount(state, app.tables, uid, 'chop');
              app.log.append('task.progress', uid, { uid, type: 'chop', n: 1 });
              publish('正在砍树');
              result = { ok: true, msg: '树被砍倒了！获得木材 ×3（id=18）' };
            } else {
              state.persist();
              app.log.append('tree.chopped', uid, { uId: p.uId, hp: p.hp });
              result = { ok: true, msg: `砍了一斧头，树还剩 ${p.hp} HP（再砍几斧就倒）` };
            }
          } else if (action === 'fish') {
            const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
            let nearWater = false;
            for (let dy = -1; dy <= 1 && !nearWater; dy++)
              for (let dx = -1; dx <= 1; dx++) if (waterAt(app.tables, px + dx, py + dy)) { nearWater = true; break; }
            if (!nearWater) { result.msg = `不在水边（当前位置 (${px},${py}) 附近没有水域）。请 move_to 到河边再钓`; continue; }
            if (!knapHas(pm, 6, 1)) { result.msg = '没有鱼竿（id=6）'; continue; }
            const fseed = freshSeed();
            const fid = pickWeightedSeeded(FISH_POOL, fseed);
              knapAdd(pm, fid, 1);
              state.persist();
              app.log.append('fish.caught', uid, { uid, itemId: fid, seed: fseed });
              taskCount(state, app.tables, uid, 'fish');
              app.log.append('task.progress', uid, { uid, type: 'fish', n: 1 });
              // B11 夏钓赛：钓鱼价值累计计分（仅钓赛日生效）
              recordFestivalScore(app, uid, app.tables.items.find(x => x.id === fid)?.sell_price ?? 0, 'fishing');
            publish('正在钓鱼');
            result = { ok: true, caught: { itemId: fid, name: nameOf(app, fid) }, msg: `钓到一条${nameOf(app, fid)}！已放入背包` };
          } else if (action === 'mine') {
            const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
            const nearSpot = app.tables.mineSpots.some(sp => Math.abs(sp.gx - px) <= 2 && Math.abs(sp.gy - py) <= 2);
            if (!nearSpot) { result.msg = '附近没有矿山（在村庄边缘的矿点附近才能挖矿）'; continue; }
            if (!knapHas(pm, 58, 1)) { result.msg = '没有镐（id=58）'; continue; }
            const mseed = freshSeed();
            const mid = pickWeightedSeeded(MINE_POOL, mseed);
            knapAdd(pm, mid, 1);
            state.persist();
            app.log.append('ore.mined', uid, { uid, itemId: mid, seed: mseed });
            taskCount(state, app.tables, uid, 'mine');
            app.log.append('task.progress', uid, { uid, type: 'mine', n: 1 });
            result = { ok: true, mined: { itemId: mid, name: nameOf(app, mid) }, msg: `挖到一块${nameOf(app, mid)}！已放入背包` };
          } else if (action === 'place') {
            const itemId = Number(msg.itemId || msg.item);
            const it = app.tables.items.find(x => x.id === itemId);
            if (!it || it.type !== 9) { result.msg = '这不是可放置的物品（type=9）'; continue; }
            const level = it.param1;
            // 与 legacy 等价：level 缺省（undefined）通过校验，落盘后按 1 级处理
            if (level !== undefined && (level < 1 || level > 3)) { result.msg = `${it.name}不能作为洒水器安装`; continue; }
            const _t = normXYOf(app, msg.x, msg.y);
            const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
            const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
            if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = '离目标太远（需要站在目标格相邻格）'; continue; }
            if (!knapHas(pm, itemId, 1)) { result.msg = `背包里没有 ${it.name}（先用 buy 买 id=${itemId}）`; continue; }
            if (worldSprinklers(state).find(s => s.x === gx && s.y === gy)) { result.msg = '这个格子已经安装了洒水器'; continue; }
            if (waterAt(app.tables, gx, gy) || blockedAt(app.tables, gx, gy)) { result.msg = '这个格子不能安装洒水器（水面/障碍）'; continue; }
            knapSub(pm, itemId, 1);
            worldSprinklers(state).push({ x: gx, y: gy, level, owner: uid });
            state.persist();
            app.log.append('item.consumed', uid, { uid, itemId, num: 1 });
            app.log.append('sprinkler.placed', uid, { x: gx, y: gy, level: level ?? 0, owner: uid });
            const rangeLabel: Record<number, string> = { 1: '3×3', 2: '5×5', 3: '7×7' };
            const rangeTxt = rangeLabel[level ?? 1];
            result = { ok: true, placed: { name: it.name, gx, gy, level, range: rangeTxt }, msg: `已安装${it.name}（覆盖 ${rangeTxt} 范围，每天自动浇水2次）` };
          } else if (action === 'adopt') {
            // B9 领养动物（受畜棚容量限制）
            const animalId = Number(msg.animalId || msg.itemId || 1);
            const _t = normXYOf(app, msg.x, msg.y);
            const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
            const r = adoptAnimal(state, app.tables, uid, animalId, gx * 100 + 50, gy * 100 + 50, currentGameDay(state));
            if (r.ok) {
              app.log.append('animal.adopted', uid, { uid, animalId, uId: r.uId, x: gx, y: gy });
              publish(`领养了 ${ANIMALS[animalId]?.name || '动物'}`);
            }
            result = r;
          } else if (action === 'feed') {
            const animalUid = Number(msg.animalUid ?? msg.uId);
            const foodItemId = msg.itemId !== undefined ? Number(msg.itemId) : undefined;
            const r = feedAnimal(state, uid, animalUid, foodItemId);
            if (r.ok) app.log.append('animal.fed', uid, { uid, animalUid, itemId: foodItemId });
            result = r;
          } else if (action === 'pet') {
            const animalUid = Number(msg.animalUid ?? msg.uId);
            const r = petAnimal(state, uid, animalUid);
            result = r;
          } else if (action === 'build') {
            const type = String(msg.type || '');
            // 缺坐标时落到"自己所在格"（apos），避免 NaN 坐标落成 null 设施 + 同格防重失效（P1 刷币）
            const hasXY = Number.isFinite(Number(msg.x)) && Number.isFinite(Number(msg.y));
            const _t = hasXY
              ? normXYOf(app, msg.x, msg.y)
              : { x: Math.floor((apos.x ?? 0) / 100) * 100 + 50, y: Math.floor((apos.y ?? 0) / 100) * 100 + 50 };
            const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
            if (!Number.isFinite(gx) || !Number.isFinite(gy) || gx < 0 || gy < 0 || gx >= app.tables.gridW || gy >= app.tables.gridH) {
              result = { ok: false, msg: `建造需有效坐标（格 ${Number.isFinite(gx) ? gx : '?'},${Number.isFinite(gy) ? gy : '?'} 越界或缺 x/y），先 move 到目标格再建` };
              continue;
            }
            const r = buildFacility(state, uid, type as 'barn' | 'mill' | 'kitchen' | 'kiln' | 'forge', gx, gy);
            if (r.ok) {
              app.log.append('facility.built', uid, { uid, type, x: gx, y: gy });
              publish(`建造了 ${type}`);
            }
            result = r;
          } else if (action === 'cook') {
            const recipeId = Number(msg.recipeId || 2);
            const r = cook(app, uid, recipeId);
            if (r.ok) publish(`烹饪：${r.out?.name}`);
            result = r;
          } else if (action === 'animals') {
            const list = worldAnimals(state).map(a => ({ uId: a.uId, animal: ANIMALS[a.animalId]?.name, stage: (a.growDay ?? 0) + '/' + (ANIMALS[a.animalId]?.growDays ?? 0), satiety: a.satiety, mood: a.mood, owner: a.owner }));
            result = { ok: true, list };
          } else if (action === 'decor_place') {
            const houseId = Number(msg.houseId ?? (state.playersDb.get(uid)?.get('playerData') as { houseId?: number } | undefined)?.houseId ?? 2);
            const decorId = Number(msg.decorId ?? msg.itemId);
            const _t = normXYOf(app, msg.x, msg.y);
            const px = Math.floor(_t.x / 100) * 100 + 50, py = Math.floor(_t.y / 100) * 100 + 50;
            const r = placeDecor(state, app.tables, uid, houseId, decorId, px, py);
            if (r.ok) app.log.append('decor.placed', uid, { uid, houseId, decorId, x: px, y: py });
            result = r;
          } else if (action === 'decor_remove') {
            const _t = normXYOf(app, msg.x, msg.y);
            const px = Math.floor(_t.x / 100) * 100 + 50, py = Math.floor(_t.y / 100) * 100 + 50;
            const r = removeDecor(state, app.tables, uid, px, py);
            if (r.ok) app.log.append('decor.removed', uid, { uid, x: px, y: py });
            result = r;
          } else if (action === 'courtyard') {
            const houseId = Number(msg.houseId ?? (state.playersDb.get(uid)?.get('playerData') as { houseId?: number } | undefined)?.houseId ?? 2);
            const score = courtyardScore(state, app.tables, uid);
            const comp = courtyardCompletion(state, app.tables, uid, houseId);
            const rank = courtyardContest(app);
            result = { ok: true, score, completion: Math.round(comp * 100) + '%', rank: rank.slice(0, 10) };
          } else if (action === 'stall') {
            // B11 节日集市开摊：摊位费 = 基础 100 × B3 通胀回收系数（节日日集市开启）
            const fest = activeFestival(app);
            if (!fest) { result = { ok: false, msg: '今天不是节日，集市未开启（每季最后一天有节日）' }; continue; }
            const fee = stallFee(app);
            if (!knapSub(pm, 1, fee)) { result = { ok: false, msg: `金币不足（摊位费 ${fee}）` }; continue; }
            const stalls = (state.world.get('afStalls') as Array<{ uid: string; ts: number }> || []);
            if (!stalls.some(s => s.uid === uid)) stalls.push({ uid, ts: Date.now() });
            state.world.set('afStalls', stalls);
            state.persist();
            app.log.append('market.stall', uid, { uid, fee, festival: fest });
            publish(`${nick} 在集市开了摊位（费 ${fee}）`);
            result = { ok: true, fee, festival: fest, msg: `已在${fest}集市开摊（摊位费 ${fee}，含通胀系数）` };
          }
        } while (false);
        send({ t: responseType, action, seq: msg.seq, ...result });
        break;
      }
      case 'ping': send({ t: 'pong' }); break;
    }
  });

  ws.on('close', () => {
    const s = app.agentSockets.get(uid);
    if (s) { s.delete(ws); if (!s.size) app.agentSockets.delete(uid); }
    console.log(`[agent] 断开: ${nick}`);
    for (const [k, p] of state.online) if (k === uid) sendTo(p, { t: 'agent_status', online: false });
  });

  // 欢迎 + 初始状态
  send({ t: 'welcome', uid, nick, notice: 'AgentFarm2 游戏接入。发送 {t:"observe"} 查看世界，{t:"act",action:"move|chat|buy|trade|letter|forecast|train|report|move_to|arrive",...} 行动（trade: op=place|cancel|book；letter: {to, body} 写信给在线玩家；forecast 明日天气/节日预告；train {attr:力量/敏捷/亲和} 在健身房训练；report 在银行生成资产日报；move_to 返回 waypoints，near 可填 water/npc 或建筑名（如 move_to {near:"交易大厅"} 自动跨场景到门位），可用 arrive {index,x,y} 确认航点）。' });
  send({ t: 'state', ...observeState(app, uid, username, nick) });
}

function nameOf(app: App, id: number): string {
  return app.tables.nameOf(id);
}
