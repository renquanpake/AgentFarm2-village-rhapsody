// AgentFarm2 同步服务器 —— 原版外壳联机版
// 职责（P0）：
//   HTTP  GET  /af/save        返回权威存档 JSON（按客户端 uid 重组 key：世界数据共享一份，玩家数据按 uid 分）
//   HTTP  GET  /af/players     在线玩家列表
//   WS    /ws                  join / save / move / chat
// 数据桶：
//   world:*   世界共享（mapData/plantData/farmData/npcData/shopData/plotData/makeData/castingData/audioData/gameData）
//   player:{uid}:*  玩家私有（playerData/knapData/taskData/attributeData/settingData/buffData/achvData）
// 下发时：world 桶 key 重写为 {name}_{clientUid}，玩家桶取自己那份 —— 客户端无感，以为在读写自己的存档。
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream, statSync, readdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import localtunnel from 'localtunnel';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const SAVES_DIR = join(DATA_DIR, 'saves');
const SEED_FILE = join(DATA_DIR, 'seed-villagedb.json');
const ACCOUNTS_FILE = join(DATA_DIR, 'accounts.json');
const PROVIDER_FILE = join(DATA_DIR, 'agent-provider.json');
const PORT = Number(process.env.PORT || 8080);
// 存档位：--slot 1/2/3 或 AF_SLOT 环境变量，默认1
// 使用 var 以便 switch-slot 时可以动态更新
var CURRENT_SLOT = Number(process.env.AF_SLOT || (process.argv.find(a => a.startsWith('--slot='))?.split('=')[1]) || 1);
var SLOT_DIR = join(SAVES_DIR, `slot${CURRENT_SLOT}`);
var SAVE_FILE = join(SLOT_DIR, 'world.json');
var SLOT_META_FILE = join(SLOT_DIR, 'meta.json');
const GROW_DAY_MS = Number(process.env.AF_GROW_MS || 10 * 60 * 1000); // 作物 1 天 = 10 分钟真实时间（AF_GROW_MS 可调快测试）
let providerConfig = {};
try { providerConfig = JSON.parse(readFileSync(PROVIDER_FILE, 'utf8')); } catch {}
let AGENT_LLM_URL = process.env.AF_LLM_URL || process.env.LLM_URL || providerConfig.url || '';
let AGENT_LLM_KEY = process.env.AF_LLM_KEY || process.env.LLM_KEY || providerConfig.key || '';
let AGENT_LLM_MODEL = process.env.AF_LLM_MODEL || process.env.LLM_MODEL || providerConfig.model || 'deepseek-v4-flash';
// 农场网格（水格/可种土，世界坐标 105x89）与坐标偏移（扩展 14 格）
const FARM = loadJson(join(DATA_DIR, 'village-farm.json'), null);
const MAP_OFFSET = (FARM && FARM.LEFT) || 14; // 原版存档格 -> 世界格 的偏移（迁移后统一世界坐标）

// ---------- 账号系统 ----------
// accounts: { username: { salt, hash, uid, nick, token, agentToken, createdAt } }
let accounts = loadJson(ACCOUNTS_FILE, {});
function saveAccounts() { writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 1)); }
function hashPw(pw, salt) { return createHash('sha256').update(salt + '::' + pw).digest('hex'); }
function genToken() { return randomBytes(16).toString('hex'); }
function findAccountByToken(t) {
  if (!t) return null;
  for (const [uname, a] of Object.entries(accounts)) if (a.token === t || a.agentToken === t) return a;
  return null;
}
function uidOfToken(t) { const a = findAccountByToken(t); return a ? a.uid : null; }
const managedAgents = new Map(); // uid -> ChildProcess，由服务器负责生命周期

function startManagedAgent(acc) {
  if (!AGENT_LLM_URL || !AGENT_LLM_KEY) return { ok: false, msg: '服务端未配置 AF_LLM_URL 和 AF_LLM_KEY，无法启动托管' };
  const existing = managedAgents.get(acc.uid);
  if (existing && !existing.killed) return { ok: false, msg: '该账号的 Agent 已在启动或运行中' };
  if (!acc.agentToken) { acc.agentToken = genToken(); saveAccounts(); }
  const username = Object.keys(accounts).find(k => accounts[k] === acc) || acc.nick || acc.uid;
  const child = spawn(process.execPath, [join(__dirname, '..', 'tools', 'game-agent.mjs'), '--token', acc.agentToken,
    '--mode', 'text', '--rounds', '999999', '--notes', join(DATA_DIR, 'agent-notes', username)], {
    cwd: join(__dirname, '..'), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, LLM_URL: AGENT_LLM_URL, LLM_KEY: AGENT_LLM_KEY, LLM_MODEL: AGENT_LLM_MODEL },
  });
  managedAgents.set(acc.uid, child);
  child.once('exit', () => { if (managedAgents.get(acc.uid) === child) managedAgents.delete(acc.uid); });
  return { ok: true };
}
function stopManagedAgent(uid) {
  const child = managedAgents.get(uid);
  if (!child) return { ok: false, msg: '该账号没有由服务器启动的 Agent' };
  child.kill(); managedAgents.delete(uid);
  return { ok: true };
}

const WORLD_KEYS = new Set(['mapData', 'plantData', 'farmData', 'npcData', 'shopData', 'plotData', 'makeData', 'castingData', 'socialData']);
const PLAYER_KEYS = new Set(['playerData', 'knapData', 'taskData', 'attributeData', 'settingData', 'buffData', 'achvData', 'storage', 'afTasks']);
const GLOBAL_KEYS = new Set(['audioData', 'gameData', 'afSpawnCount', 'afCoordMigrated']);

// ---------- 存档 ----------
const world = new Map();      // name -> val
const players = new Map();    // uid -> Map(name -> val)   在线玩家同时存这里
const globals = new Map();
let playersDb = new Map();    // 离线玩家存档（从 seed/文件加载）

function bucketOf(key) {
  // key 形如 "name_12345" 或 "name"
  const i = key.lastIndexOf('_');
  const name = i > 0 ? key.slice(0, i) : key;
  if (WORLD_KEYS.has(name)) return ['world', name];
  if (PLAYER_KEYS.has(name)) return ['player', name];
  if (GLOBAL_KEYS.has(name)) return ['global', name];
  return null; // 未知 key 按玩家私有处理
}
function loadJson(p, fallback) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } }
function persist() {
  mkdirSync(SLOT_DIR, { recursive: true });
  const datas = [];
  for (const [name, val] of world) datas.push({ key: name, val });
  for (const [name, val] of globals) datas.push({ key: name, val });
  for (const [uid, m] of playersDb) for (const [name, val] of m) datas.push({ key: `${name}_${uid}`, val });
  writeFileSync(SAVE_FILE, JSON.stringify({ version: 4, datas }, null, 1));
  // 更新 meta
  const meta = loadJson(SLOT_META_FILE, {});
  meta.lastPlayed = Date.now();
  meta.createdAt = meta.createdAt || Date.now();
  writeFileSync(SLOT_META_FILE, JSON.stringify(meta, null, 1));
}

// 初始化：从 seed 导入（原版存档格式，拆桶）
function importSave(s) {
  for (const d of (s.datas || [])) {
    const b = bucketOf(d.key);
    if (!b) continue;
    const [kind, name] = b;
    if (kind === 'world') world.set(name, d.val);
    else if (kind === 'global') globals.set(name, d.val);
    else {
      const uid = d.key.slice(name.length + 1);
      if (!playersDb.has(uid)) playersDb.set(uid, new Map());
      playersDb.get(uid).set(name, d.val);
    }
  }
}
if (existsSync(SAVE_FILE)) importSave(loadJson(SAVE_FILE, null));
else if (existsSync(SEED_FILE)) importSave(loadJson(SEED_FILE, null));

// 主角初始档模板：seed 里 uid=100001 的玩家私有数据（新玩家继承主角初始状态 —— "每个玩家都是主角"）
const SEED_PLAYER_UID = '100001';
let heroTemplate = null;
if (playersDb.has(SEED_PLAYER_UID)) {
  heroTemplate = new Map();
  for (const [name, val] of playersDb.get(SEED_PLAYER_UID)) {
    heroTemplate.set(name, JSON.parse(JSON.stringify(val)));
  }
}

// ★ 坐标迁移（一次性）：地图已扩展 14 格（77x61 -> 105x89），但 seed 存档里
//   plantData 植物 / farmData 农田 仍是原版网格坐标（0-76/0-60）。
//   不迁移的话，客户端会把树和农田画在左上角偏移处（村庄主体看不到树）。
//   迁移后服务器内部统一使用世界格坐标（与 tmx / 玩家位置 / 碰撞网格一致）。
const MIGRATED_KEY = 'afCoordMigrated';
function migrateWorldCoords() {
  const pd = world.get('plantData');
  if (pd) for (const sc of (pd.datas || [])) {
    for (const p of (sc.plants || [])) { p.x += MAP_OFFSET; p.y += MAP_OFFSET; }
  }
  const fd = world.get('farmData');
  if (fd) for (const sc of (fd.plotDatas || [])) {
    for (const pl of (sc.plots || [])) { pl.x += MAP_OFFSET; pl.y += MAP_OFFSET; }
  }
  globals.set(MIGRATED_KEY, { val: 1 });
  persist();
  console.log('[migrate] 世界坐标已迁移（植物/农田 +14 格）');
}
if (!(globals.get(MIGRATED_KEY) || {}).val) migrateWorldCoords();
// 出生点表：新玩家按加入顺序分配到村扩展区宅基地（第 1 个玩家保留原版家门口 scene1）
const SPAWNS = loadJson(join(DATA_DIR, 'spawn-points.json'), null);
let spawnCount = Number((globals.get('afSpawnCount') || {}).val || 0); // 已出生玩家数（持久化）
const houseAssign = new Map(); // uid -> house id
function assignHouse(uid, idx) {
  if (!SPAWNS || !SPAWNS.houses || !SPAWNS.houses.length) return null;
  const h = SPAWNS.houses[(idx - 2) % SPAWNS.houses.length]; // 第 2 个玩家 -> houses[0]（id=2）
  if (!h) return null;
  houseAssign.set(uid, h.id);
  // ★ 持久化 houseId 到玩家数据，重连时可恢复
  const pm = playersDb.get(uid);
  if (pm) {
    const pd = pm.get('playerData');
    if (pd) pd.houseId = h.id;
  }
  return h.id;
}
function ensurePlayerData(uid) {
  if (!playersDb.has(uid)) playersDb.set(uid, new Map());
  const pm = playersDb.get(uid);
  if (pm.size === 0 && heroTemplate) {
    for (const [name, val] of heroTemplate) pm.set(name, JSON.parse(JSON.stringify(val)));
    // 每个玩家一份自己的 uid 与昵称
    const pd = pm.get('playerData');
    if (pd) { pd.uID = uid; pd.nickName = pd.nickName || ('玩家' + String(uid).slice(-4)); }
    // 出生点：第 1 个玩家保留原版家门口(scene1)；第 2 个起出生在村扩展区宅基地
    if (spawnCount === 0) {
      spawnCount = 1;
      globals.set('afSpawnCount', { val: 1 });
      console.log('[spawn] 首位玩家保留原版家门口 (scene1)');
    } else {
      spawnCount++;
      globals.set('afSpawnCount', { val: spawnCount });
      const houseId = assignHouse(uid, spawnCount);
      if (houseId && SPAWNS && pd) {
        const h = SPAWNS.houses.find(x => x.id === houseId);
        if (h) {
          pd.sceneType = SPAWNS.scene || 2;
          pd.posSceneType = SPAWNS.scene || 2;
          pd.playerPos = { x: h.door.x, y: h.door.y, z: 0 };
          pd.playerPlace = 1;
          console.log(`[spawn] 玩家 ${uid} (#${spawnCount}) 出生在 ${h.type} 门口 (${h.door.x},${h.door.y})`);
        }
      }
    }
    persist();
    console.log(`[hero] 新玩家 ${uid} 继承主角初始档`);
  }
  // ★ 重连恢复：如果玩家已有 houseId 存档，恢复 houseAssign 映射
  const pd = pm.get('playerData');
  if (pd && pd.houseId && !houseAssign.has(uid)) {
    houseAssign.set(uid, pd.houseId);
  }
  return pm;
}

// ---------- HTTP ----------
const CLIENT_ROOT = join(__dirname, '..', 'client');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.css': 'text/css', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.fnt': 'application/octet-stream', '.plist': 'application/octet-stream',
  '.fire': 'application/octet-stream', '.prefab': 'application/octet-stream', '.anim': 'application/octet-stream',
  '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};
function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = join(CLIENT_ROOT, urlPath);
  if (!filePath.startsWith(CLIENT_ROOT) || !existsSync(filePath)) { res.writeHead(404); return res.end('not found'); }
  const st = statSync(filePath);
  const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  res.setHeader('Cache-Control', 'no-cache');
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? parseInt(m[1]) : 0;
    const end = m && m[2] ? parseInt(m[2]) : st.size - 1;
    res.writeHead(206, { 'Content-Type': mime, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}` });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    createReadStream(filePath).pipe(res);
  }
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (process.env.AF_DEBUG) console.log('[http]', req.method, u.pathname);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  // ---------- 账号 API ----------
  if (u.pathname === '/af/register' || u.pathname === '/af/login') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(body); } catch { res.writeHead(400); return res.end('bad json'); }
      const uname = String(b.username || '').trim();
      const pw = String(b.password || '');
      if (!/^[\w\u4e00-\u9fa5-]{2,16}$/.test(uname) || pw.length < 4) {
        res.writeHead(400); res.end('bad account'); return;
      }
      const existing = accounts[uname];
      if (u.pathname === '/af/register') {
        if (existing) { res.writeHead(409); return res.end('exists'); }
        const salt = randomBytes(8).toString('hex');
        const uid = 'u' + randomBytes(6).toString('hex');
        const a = { salt, hash: hashPw(pw, salt), uid, nick: uname, token: genToken(), createdAt: Date.now() };
        accounts[uname] = a;
        saveAccounts();
        ensurePlayerData(uid); // 分配主角档+宅基地
        console.log(`[account] 注册 ${uname} -> ${uid}`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, token: a.token, uid, nick: uname }));
      } else {
        if (!existing || existing.hash !== hashPw(pw, existing.salt)) {
          res.writeHead(401); return res.end('bad login');
        }
        existing.token = genToken(); // 换新 token
        saveAccounts();
        console.log(`[account] 登录 ${uname} -> ${existing.uid}`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, token: existing.token, uid: existing.uid, nick: existing.nick || uname }));
      }
    });
    return;
  }
  if (u.pathname === '/af/me') {
    const a = findAccountByToken(u.searchParams.get('token'));
    if (!a) { res.writeHead(401); return res.end('bad token'); }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, uid: a.uid, nick: a.nick, username: Object.keys(accounts).find(k => accounts[k] === a) }));
    return;
  }
  // 模型配置（房主/玩家在游戏内配置 Agent 大脑的 LLM；key 不回显）
  if (u.pathname === '/af/agent-provider') {
    if (req.method === 'POST') {
      const a = findAccountByToken(u.searchParams.get('token'));
      if (!a) { res.writeHead(401); return res.end('bad token'); }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let b; try { b = JSON.parse(body); } catch { res.writeHead(400); return res.end('bad json'); }
        const url = String(b.url || '').trim();
        const model = String(b.model || '').trim() || 'deepseek-v4-flash';
        if (!/^https?:\/\//.test(url)) { res.writeHead(400); return res.end('url must start with http(s)://'); }
        const next = { url, model };
        if (b.key && String(b.key).trim()) next.key = String(b.key).trim();
        else if (providerConfig.key) next.key = providerConfig.key; // 保留旧 key
        providerConfig = next;
        mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(PROVIDER_FILE, JSON.stringify(providerConfig, null, 1));
        // 运行时热更新（agent 子进程启动时读取）
        AGENT_LLM_URL = next.url;
        AGENT_LLM_KEY = next.key || '';
        AGENT_LLM_MODEL = next.model;
        console.log(`[provider] ${a.nick || a.uid} 更新模型配置: ${next.url} / ${next.model}`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, msg: `模型已配置：${next.url} / ${next.model}` }));
      });
      return;
    }
    // GET：返回当前配置（key 脱敏）
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      url: AGENT_LLM_URL || '',
      model: AGENT_LLM_MODEL || 'deepseek-v4-flash',
      keySet: !!(AGENT_LLM_KEY || '').length,
    }));
    return;
  }
  // 生成 agent 接入码（需要玩家 token）
  if (u.pathname === '/af/agent-token' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(body); } catch { b = {}; }
      const a = findAccountByToken(b.token || u.searchParams.get('token'));
      if (!a) { res.writeHead(401); return res.end('bad token'); }
      if (!a.agentToken) { a.agentToken = genToken(); saveAccounts(); }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, agentToken: a.agentToken, ws: `ws://${req.headers.host}/agent?token=${a.agentToken}` }));
    });
    return;
  }
  if (u.pathname === '/af/agent-control' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(body); } catch { b = {}; }
      const a = findAccountByToken(b.token);
      if (!a) { res.writeHead(401); return res.end(JSON.stringify({ ok: false, msg: 'bad token' })); }
      const result = b.action === 'start' ? startManagedAgent(a) : b.action === 'stop' ? stopManagedAgent(a.uid) : { ok: false, msg: 'action 必须是 start 或 stop' };
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(result));
    });
    return;
  }
  // ★ 存档位列表 API（主界面用）
  if (u.pathname === '/af/saves') {
    const saves = [];
    for (let i = 1; i <= 3; i++) {
      const slotDir = join(SAVES_DIR, `slot${i}`);
      const metaFile = join(slotDir, 'meta.json');
      const worldFile = join(slotDir, 'world.json');
      const meta = loadJson(metaFile, {});
      const exists = existsSync(worldFile);
      let playerCount = 0;
      if (exists) {
        const wd = loadJson(worldFile, null);
        if (wd && wd.datas) playerCount = wd.datas.filter(d => d.key.startsWith('playerData_')).length;
      }
      saves.push({
        slot: i,
        name: meta.name || `存档${i}`,
        exists,
        playerCount,
        createdAt: meta.createdAt || null,
        lastPlayed: meta.lastPlayed || null,
      });
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, currentSlot: CURRENT_SLOT, saves }));
    return;
  }
  // ★ 设置存档名
  if (u.pathname === '/af/saves/rename' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(body); } catch { b = {}; }
      const a = findAccountByToken(b.token);
      if (!a) { res.writeHead(401); return res.end(JSON.stringify({ ok: false, msg: 'bad token' })); }
      const slot = Number(b.slot) || CURRENT_SLOT;
      const slotDir2 = join(SAVES_DIR, `slot${slot}`);
      const metaFile2 = join(slotDir2, 'meta.json');
      const meta2 = loadJson(metaFile2, {});
      meta2.name = String(b.name || `存档${slot}`).slice(0, 20);
      meta2.createdAt = meta2.createdAt || Date.now();
      mkdirSync(slotDir2, { recursive: true });
      writeFileSync(metaFile2, JSON.stringify(meta2, null, 1));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  // ★ 切换存档位 API（房主选存档时调用）
  if (u.pathname === '/af/switch-slot' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(body); } catch { b = {}; }
      const a = findAccountByToken(b.token);
      if (!a) { res.writeHead(401); return res.end(JSON.stringify({ ok: false, msg: 'bad token' })); }
      const newSlot = Number(b.slot);
      if (newSlot < 1 || newSlot > 3) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, msg: 'slot must be 1-3' })); }
      if (newSlot === CURRENT_SLOT) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, msg: 'already on slot ' + newSlot })); }
      // 保存当前存档
      persist();
      console.log(`[slot] 切换存档: ${CURRENT_SLOT} -> ${newSlot}`);
      // 更新全局 slot 变量（注意：这里只更新文件路径相关变量，实际切换需要重启）
      // 为了简单，我们直接返回让前端重新连接到新端口的服务器
      // 更好的方案：动态重载数据
      const oldSlot = CURRENT_SLOT;
      // 重置内存
      world.clear(); globals.clear(); playersDb.clear(); playerOps.clear(); lastOpPush.clear();
      houseAssign.clear(); spawnCount = 0;
      // 更新文件路径（通过重新赋值模块级变量）
      // 注意：SAVE_FILE 和 SLOT_DIR 是 const，不能直接改。我们需要用动态查找
      // 方案：用一个 slotDirMap 来管理
      const newSlotDir = join(SAVES_DIR, `slot${newSlot}`);
      const newSaveFile = join(newSlotDir, 'world.json');
      // 加载新存档
      if (existsSync(newSaveFile)) importSave(loadJson(newSaveFile, null));
      else if (existsSync(SEED_FILE)) importSave(loadJson(SEED_FILE, null));
      // 重新初始化 heroTemplate
      heroTemplate = null;
      if (playersDb.has(SEED_PLAYER_UID)) {
        heroTemplate = new Map();
        for (const [n, v] of playersDb.get(SEED_PLAYER_UID)) heroTemplate.set(n, JSON.parse(JSON.stringify(v)));
      }
      // 迁移检查
      if (!(globals.get(MIGRATED_KEY) || {}).val) migrateWorldCoords();
      // 重新加载 FARM
      // 更新模块级变量
      CURRENT_SLOT = newSlot;
      SLOT_DIR = newSlotDir;
      SAVE_FILE = newSaveFile;
      SLOT_META_FILE = join(newSlotDir, 'meta.json');
      console.log(`[slot] 已切换到存档${newSlot}，世界数据已重载`);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, slot: newSlot }));
    });
    return;
  }
  // ★ 房间码 API：获取当前房间码和穿透地址
  if (u.pathname === '/af/room') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      roomCode: roomCode || null,
      tunnelUrl: tunnelUrl || null,
      localUrl: `http://127.0.0.1:${PORT}`,
    }));
    return;
  }
  // ★ 输入房间码加入房间：解析6位码得到服务器地址
  if (u.pathname === '/af/join-room' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 512) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(body); } catch { b = {}; }
      const code = String(b.code || '').trim();
      if (code.length !== 6) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, msg: '房间码为6位数字' })); }
      const url = roomCodes.get(code);
      if (!url) { res.writeHead(404); return res.end(JSON.stringify({ ok: false, msg: '房间码无效或已过期' })); }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, url }));
    });
    return;
  }
  // Dev: 给玩家加金币（测试用）
  if (u.pathname === '/af/dev/give-coins' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(body); } catch { b = {}; }
      const a = findAccountByToken(b.token);
      if (!a) { res.writeHead(401); return res.end(JSON.stringify({ ok: false, msg: 'bad token' })); }
      const pm = playersDb.get(a.uid);
      if (!pm) { res.writeHead(404); return res.end(JSON.stringify({ ok: false, msg: 'no player data' })); }
      const kn = pm.get('knapData') || { props: [] };
      kn.props = kn.props || [];
      const coinsProp = kn.props.find(p => p.id === 1);
      const add = Number(b.amount) || 5000;
      if (coinsProp) coinsProp.num += add; else kn.props.push({ id: 1, num: add });
      pm.set('knapData', kn);
      persist();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, coins: coinsProp ? coinsProp.num : add }));
    });
    return;
  }
  if (u.pathname === '/af/save') {
    // 鉴权：token 必须与 uid 匹配（未带 token 的旧客户端拒绝）
    const uid = u.searchParams.get('uid');
    const tok = u.searchParams.get('token');
    const a = findAccountByToken(tok);
    if (!uid || !a || a.uid !== uid) { res.writeHead(401); return res.end('bad token'); }
    const datas = [];
    for (const [name, val] of world) {
      // 防御：跳过曾被复合污染的世界 key（storage_uXXX 类），旧污染随重启/持久化自动清除
      if (/_[a-z][0-9a-f]{6,}/i.test(name)) continue;
      datas.push({ key: `${name}_${uid || '0'}`, val });
    }
    for (const [name, val] of globals) datas.push({ key: name, val });
    const pm = ensurePlayerData(uid || '0');
    for (const [name, val] of pm) datas.push({ key: `${name}_${uid || '0'}`, val });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ version: 4, datas, _af: { spawns: SPAWNS } }));
    return;
  }
  // agent 性格设定：按预设/自定义生成 data/agent-notes/<username>/agent.md
  if (u.pathname === '/af/agent-setup' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(body); } catch { b = {}; }
      const a = findAccountByToken(b.token || u.searchParams.get('token'));
      if (!a) { res.writeHead(401); return res.end('bad token'); }
      const uname = Object.keys(accounts).find(k => accounts[k] === a) || a.nick || 'default';
      const dir = join(DATA_DIR, 'agent-notes', uname);
      mkdirSync(dir, { recursive: true });
      const PRESETS = {
        '活泼开朗': '我是一个活泼开朗的村民，见人就打招呼，喜欢热闹，玩家让我帮忙我马上就去。',
        '沉稳寡言': '我话少但靠谱，说话简洁，做事踏实，是村里靠得住的人。',
        '好奇宝宝': '我什么都想看看，爱探索村庄每个角落，碰到新鲜事就想弄清楚。',
        '热心肠': '我乐于助人，玩家有要求马上去办，村里谁需要帮忙我都愿意搭把手。',
        '守财奴': '我精打细算，买东西前先问价货比三家，攒钱是我的乐趣。',
        '自由灵魂': '我随性自在，想干啥干啥，经常有突发奇想，讨厌被安排得明明白白。',
      };
      const p = String(b.personality || '').trim();
      const personality = PRESETS[p] || p || PRESETS['活泼开朗'];
      const name = String(b.name || '').trim() || '无名村民';
      const md = `# agent.md —— 我的角色人设（agent 启动必读）\n\n## 我的名字\n${name}\n\n## 我的性格\n${personality}\n\n## 我的玩法偏好\n${String(b.playstyle || '爱逛村庄、结识玩家、按时写日记。').trim()}\n\n## 我的自我介绍（对玩家说的话）\n你好呀，我是${name}！${personality.slice(0, 40)}…\n\n## 我的口头禅\n${String(b.phrase || '交给我吧！').trim()}\n`;
      writeFileSync(join(dir, 'agent.md'), md, 'utf8');
      console.log(`[agent-setup] ${uname} 性格=${p || '自定义'}`);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, username: uname, name, personality }));
    });
    return;
  }
  if (u.pathname === '/af/players') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(Array.from(online.values()).map(p => ({ uid: p.uid, nick: p.nick, scene: p.scene, x: p.x, y: p.y }))));
    return;
  }
  // Agent 托管状态（玩家轮询兜底）
  if (u.pathname === '/af/agent-status') {
    const a = findAccountByToken(u.searchParams.get('token'));
    if (!a) { res.writeHead(401); return res.end('bad token'); }
    const s = agentSockets.get(a.uid);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ online: !!(s && s.size), nick: a.nick || null }));
    return;
  }
  // 地图网格（mod 生成扩展版小地图用）：水面/障碍/宅基地
  if (u.pathname === '/af/mapgrid') {
    const a = findAccountByToken(u.searchParams.get('token'));
    if (!a) { res.writeHead(401); return res.end('bad token'); }
    const g = FARM ? {
      W: FARM.waterW, H: FARM.waterH,
      water: FARM.water,
      blocked: COLLISION ? COLLISION.blocked : null,
      houses: ((SPAWNS && SPAWNS.houses) || []).map(h => ({ x: h.rect.x, y: h.rect.y, w: h.rect.w, h: h.rect.h, type: h.type })),
      LEFT: FARM.LEFT, TOP: FARM.TOP, origW: 77, origH: 61,
    } : null;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(g));
    return;
  }
  // 客户端画面上传（多模态 agent 的"眼睛"：存 data/screenshots/latest.png）
  if (u.pathname === '/af/upload-shot' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 6 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const buf = Buffer.from(body.trim(), 'base64');
        if (!buf.length || buf.length > 5 * 1024 * 1024) { res.writeHead(400); return res.end('bad'); }
        const dir = join(DATA_DIR, 'screenshots');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'latest.png'), buf);
        res.end('ok');
      } catch (e) { res.writeHead(400); res.end('bad'); }
    });
    return;
  }
  // agent 日记（只读）：返回该账号 agent 的日记列表与内容（读 data/agent-notes/<username>/日记/）
  if (u.pathname === '/af/diary') {
    const a = findAccountByToken(u.searchParams.get('token'));
    if (!a) { res.writeHead(401); return res.end('bad token'); }
    const uname = Object.keys(accounts).find(k => accounts[k] === a) || a.nick || 'default';
    const notesRoot = join(DATA_DIR, 'agent-notes', uname);
    const diaryDir = join(notesRoot, '日记');
    const out = { username: uname, days: [] };
    if (existsSync(diaryDir)) {
      for (const f of readdirSync(diaryDir).filter(x => x.endsWith('.md')).sort()) {
        const content = readFileSync(join(diaryDir, f), 'utf8');
        out.days.push({ file: f, title: f.replace(/\.md$/, ''), content: content.slice(0, 3000) });
      }
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(out));
    return;
  }
  serveStatic(req, res);
});

// ---------- WebSocket（noServer：手动按 path 路由 /ws 游戏通道 + /agent 外部 agent 通道） ----------
const wss = new WebSocketServer({ noServer: true });
const online = new Map(); // uid -> { ws, nick, scene, x, y }

server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => gameConn(ws));
  } else if (u.pathname === '/agent') {
    wss.handleUpgrade(req, socket, head, (ws) => agentConn(ws, u));
  } else {
    socket.destroy();
  }
});

function gameConn(ws) {
  let uid = null;
  const send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.t) {
      case 'join': {
        uid = String(msg.uid || 'g' + Math.floor(Math.random() * 1e6));
        const nick = String(msg.nick || '玩家' + uid.slice(-4));
        if (!playersDb.has(uid)) playersDb.set(uid, new Map());
        online.set(uid, { ws, uid, nick, scene: msg.scene ?? 0, x: msg.x ?? 0, y: msg.y ?? 0 });
        send({ t: 'welcome', uid, players: Array.from(online.values()).map(p => ({ uid: p.uid, nick: p.nick, scene: p.scene, x: p.x, y: p.y })) });
        // 回传我的 Agent 托管状态（在线/离线）
        const myAgent = agentSockets.has(uid);
        send({ t: 'agent_status', online: myAgent, nick: myAgent ? nick : null });
        for (const [k, p] of online) if (k !== uid) sendTo(p, { t: 'player_join', p: { uid, nick } });
        console.log(`[join] ${uid} (${nick}) 在线:${online.size}`);
        break;
      }
      case 'save': {
        if (!msg.kv || !Array.isArray(msg.kv) || !uid) break;
        const kvOut = [];
        let touchedWorld = false;
        for (const [key, value] of msg.kv) {
          let val; try { val = JSON.parse(value); } catch { val = value; }
          const b = bucketOf(key);
          // 未知 key（如游戏 storage_100001 经客户端翻译后的 storage_uXXX）一律按玩家私有处理；
          // name 必须剥净一切 uid 类后缀（_uXXXX / _数字），防止二次翻译复合污染世界档
          const name = b ? b[1] : key.replace(/(_\d+|_u[0-9a-f]+)+$/g, '');
          if (b && b[0] === 'world') {
            // socialData 是服务器权威键（玩家间好感/关系），客户端回推的旧快照会覆盖实时数据，必须忽略
            if (name !== 'socialData') { world.set(name, val); if (WORLD_KEYS.has(name)) touchedWorld = true; }
          }
          else if (b && b[0] === 'global') globals.set(name, val);
          else if (b && b[0] === 'player' && name !== 'afTasks') {
            if (!playersDb.has(uid)) playersDb.set(uid, new Map());
            playersDb.get(uid).set(name, val);
          }
          kvOut.push([key, value]);
        }
        persist();
        // 玩家在游戏里做了操作（存档变化）→ 打断自己的 agent（指挥消息/聊天不打断，走收件箱/聊天记录）
        if (touchedWorld) notePlayerOp(uid, 'save', '玩家在游戏里活动（存档变化）');
        for (const [k, p] of online) if (k !== uid) sendTo(p, { t: 'save_broadcast', kv: kvOut, by: uid });
        break;
      }
      case 'move': {
        const p = online.get(uid); if (!p) break;
        p.scene = msg.scene ?? p.scene; p.x = msg.x ?? p.x; p.y = msg.y ?? p.y;
        for (const [k, o] of online) if (k !== uid) sendTo(o, { t: 'move', uid, scene: p.scene, x: p.x, y: p.y });
        break;
      }
      case 'chat': {
        const p = online.get(uid); if (!p) break;
        const text = String(msg.text || '').slice(0, 200);
        console.log(`[chat] ${p.nick}: ${text}`);
        CHAT_LOG.push({ nick: p.nick, text, at: Date.now() });
        while (CHAT_LOG.length > 50) CHAT_LOG.shift();
        for (const [, o] of online) sendTo(o, { t: 'chat', uid, nick: p.nick, text });
        break;
      }
      // ---------- 玩家间社交 ----------
      case 'social_talk': {
        const p = online.get(uid); if (!p) break;
        const target = resolveOnlineUid(String(msg.target || '')) || '';
        if (!target || target === uid) break;
        const nr = socialNear(uid, target);
        const pB = online.get(target);
        if (!pB) { send({ t: 'social_result', social: 'talk', ok: false, msg: '对方不在线' }); break; }
        if (!nr.ok) { send({ t: 'social_result', social: 'talk', ok: false, msg: nr.msg }); break; }
        const text = String(msg.text || '').slice(0, 200);
        if (text) sendTo(pB, { t: 'social_in', social: 'talk', from: uid, nick: p.nick, text });
        const fav = addFav(uid, target, 2); // 对话 +2 好感（主动方）
        taskCount(uid, 'talk');
        taskCount(target, 'talk');
        send({ t: 'social_result', social: 'talk', ok: true, msg: `已对话，${pB.nick} 对你的好感 +2（现 ${fav}）` });
        console.log(`[social] ${p.nick} 对话 ${pB.nick}`);
        break;
      }
      case 'social_give': {
        const p = online.get(uid); if (!p) break;
        const target = resolveOnlineUid(String(msg.target || '')) || '';
        const pB = online.get(target);
        if (!pB) { send({ t: 'social_result', social: 'give', ok: false, msg: '对方不在线' }); break; }
        const nr = socialNear(uid, target);
        if (!nr.ok) { send({ t: 'social_result', social: 'give', ok: false, msg: nr.msg }); break; }
        const itemId = Number(msg.itemId);
        const num = Math.max(1, Math.min(99, Number(msg.num || 1)));
        const it = ITEM_LIST.find(x => x.id === itemId);
        if (!it) { send({ t: 'social_result', social: 'give', ok: false, msg: '没有这个物品' }); break; }
        const pmA = playersDb.get(uid);
        if (!pmA || !knapHas(pmA, itemId, num)) { send({ t: 'social_result', social: 'give', ok: false, msg: `背包里没有 ${it.name}×${num}` }); break; }
        knapSub(pmA, itemId, num);
        const pmB = playersDb.get(target);
        if (pmB) knapAdd(pmB, itemId, num);
        const g = giftFavGain(uid, target, itemId);
        const fav = addFav(uid, target, g);
        taskCount(uid, 'give');
        for (const [, o] of online) sendTo(o, { t: 'chat', uid: 'sys', nick: '系统', text: `🎁 ${p.nick} 送给了 ${pB.nick} ${it.name}×${num}，好感 +${g}` });
        sendTo(pB, { t: 'social_in', social: 'give', from: uid, nick: p.nick, itemId, num, fav });
        send({ t: 'social_result', social: 'give', ok: true, msg: `送礼成功，${pB.nick} 对你的好感 +${g}（现 ${fav}）` });
        console.log(`[social] ${p.nick} 送礼 ${pB.nick} ${it.name}x${num}`);
        break;
      }
      case 'social_fav': {
        const target = resolveOnlineUid(String(msg.target || '')) || '';
        if (!target) { send({ t: 'social_result', social: 'fav', ok: false, msg: '缺少目标' }); break; }
        const f = favBetween(uid, target);
        const pB = online.get(target);
        const nm = pB ? pB.nick : target;
        const rel = f.relation ? RELATION_DEFS[f.relation]?.name || f.relation : '无';
        send({ t: 'social_result', social: 'fav', ok: true, msg: `与 ${nm}：你对 TA ${f.aToB}，TA 对你 ${f.bToA}，关系：${rel}` });
        break;
      }
      case 'social_bind': {
        const p = online.get(uid); if (!p) break;
        const target = resolveOnlineUid(String(msg.target || '')) || '';
        const pB = online.get(target);
        if (!pB) { send({ t: 'social_result', social: 'bind', ok: false, msg: '对方不在线' }); break; }
        const type = String(msg.type || 'friend');
        const def = RELATION_DEFS[type];
        if (!def) { send({ t: 'social_result', social: 'bind', ok: false, msg: '关系类型：friend(好友)/confidant(知己)/partner(伴侣)' }); break; }
        const f = favBetween(uid, target);
        if ((f.aToB || 0) < def.level) { send({ t: 'social_result', social: 'bind', ok: false, msg: `好感不足：${def.name} 需要你对 TA 好感 ≥ ${def.level}（当前 ${f.aToB || 0}）` }); break; }
        const { p: pair } = pairOf(uid, target);
        if (pair.relation && pair.relation !== type) { send({ t: 'social_result', social: 'bind', ok: false, msg: `你们已有其他关系（${RELATION_DEFS[pair.relation]?.name}）` }); break; }
        pair.relation = type; pair.relBy = uid;
        persist();
        taskCount(uid, 'bind');
        for (const [, o] of online) sendTo(o, { t: 'chat', uid: 'sys', nick: '系统', text: `🎉 全村公告：${p.nick} 与 ${pB.nick} 结为「${def.name}」！` });
        sendTo(pB, { t: 'social_in', social: 'bind', from: uid, nick: p.nick, relation: type, relName: def.name });
        send({ t: 'social_result', social: 'bind', ok: true, msg: `已与 ${pB.nick} 结为「${def.name}」` });
        console.log(`[social] ${p.nick} 与 ${pB.nick} 结为 ${def.name}`);
        break;
      }
      case 'social_unbind': {
        const p = online.get(uid); if (!p) break;
        const target = resolveOnlineUid(String(msg.target || '')) || '';
        const { p: pair } = pairOf(uid, target);
        if (!pair.relation) { send({ t: 'social_result', social: 'unbind', ok: false, msg: '你们没有特殊关系' }); break; }
        const relName = RELATION_DEFS[pair.relation]?.name || pair.relation;
        pair.relation = ''; pair.relBy = '';
        persist();
        const pB = online.get(target);
        for (const [, o] of online) sendTo(o, { t: 'chat', uid: 'sys', nick: '系统', text: `${p.nick} 解除了与 ${pB ? pB.nick : target} 的关系（${relName}）` });
        send({ t: 'social_result', social: 'unbind', ok: true, msg: `已解除「${relName}」关系` });
        break;
      }
      case 'social_tp': {
        const p = online.get(uid); if (!p) break;
        const target = resolveOnlineUid(String(msg.target || '')) || '';
        const pB = online.get(target);
        if (!pB) { send({ t: 'social_result', social: 'tp', ok: false, msg: '对方不在线' }); break; }
        const { p: pair } = pairOf(uid, target);
        if (pair.relation !== 'partner') { send({ t: 'social_result', social: 'tp', ok: false, msg: '只有「伴侣」可以传送（需要好感 ≥ 90 并绑定）' }); break; }
        if (p.scene !== pB.scene) { send({ t: 'social_result', social: 'tp', ok: false, msg: '对方不在同一场景，先到 TA 的场景再传送' }); break; }
        // 传送到伴侣身边（偏移 2 格，避开重叠与障碍）
        let tx = pB.x + 200, ty = pB.y;
        if (blockedAt(Math.floor(tx / 100), Math.floor(ty / 100))) { tx = pB.x - 200; ty = pB.y; }
        if (blockedAt(Math.floor(tx / 100), Math.floor(ty / 100))) { tx = pB.x; ty = pB.y + 200; }
        if (blockedAt(Math.floor(tx / 100), Math.floor(ty / 100))) { tx = pB.x; ty = pB.y - 200; }
        p.x = tx; p.y = ty;
        for (const [k, o] of online) if (k !== uid) sendTo(o, { t: 'move', uid, scene: p.scene, x: tx, y: ty });
        send({ t: 'social_tp_apply', x: tx, y: ty });
        send({ t: 'social_result', social: 'tp', ok: true, msg: `✨ 传送到伴侣 ${pB.nick} 身边` });
        console.log(`[social] ${p.nick} 传送到伴侣 ${pB.nick} 身边`);
        break;
      }
      case 'task_list': {
        const t = tasksOf(uid);
        const out = TASK_DEFS.map(d => ({
          id: d.id, name: d.name, desc: d.desc,
          cur: t.done[d.id] ? d.count : (t.list[d.id] ? t.list[d.id].cur : 0),
          total: d.count, done: !!t.done[d.id],
          reward: d.reward ? `${taskRewardName(d.reward.id)}×${d.reward.num}` : '',
        }));
        send({ t: 'task_list', tasks: out });
        break;
      }
      case 'agent_msg': {
        // 指挥消息：发给自己的 agent（进收件箱，不打断 agent 当前行动）
        const p = online.get(uid); if (!p) break;
        const text = String(msg.text || '').slice(0, 500);
        const acc = Object.values(accounts).find(a => a.uid === uid);
        if (acc) pushInbox(acc, p.nick, text);
        break;
      }
      case 'agent_interrupt': {
        // 显式打断：立即打断 agent 当前行动（等同玩家游戏操作）
        const p = online.get(uid); if (!p) break;
        notePlayerOp(uid, 'interrupt', `${p.nick} 要求你立刻停下`);
        break;
      }
      case 'agent_resume': {
        // 恢复行动：通知 agent 继续原计划（等同"解除打断"）
        const s = agentSockets.get(uid);
        if (s && s.size) {
          for (const w of s) if (w.readyState === 1) w.send(JSON.stringify({ t: 'agent_resume' }));
          console.log(`[agent-resume] 玩家 ${uid} 要求 Agent 恢复行动`);
        }
        break;
      }
    }
  });
  ws.on('close', () => {
    if (uid && online.has(uid)) {
      online.delete(uid);
      for (const [k, p] of online) sendTo(p, { t: 'player_leave', uid });
      console.log(`[leave] ${uid} 在线:${online.size}`);
    }
  });
}
function sendTo(p, obj) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); }

// ============================================================
// 玩家间社交：好感 / 送礼 / 关系绑定 / 伴侣传送 / 任务书
// 数据存 world.socialData（世界级）与玩家 afTasks（私有）
// ============================================================
const RELATION_DEFS = {
  friend: { level: 30, name: '好友' },
  confidant: { level: 60, name: '知己' },
  partner: { level: 90, name: '伴侣' },
};
function socialData() {
  let s = world.get('socialData');
  if (!s) { s = { pairs: {} }; world.set('socialData', s); }
  if (!s.pairs) s.pairs = {};
  return s;
}
function pairOf(a, b) {
  const k = [a, b].sort().join('_');
  const p = socialData().pairs;
  if (!p[k]) p[k] = { fav: { [a]: 0, [b]: 0 }, relation: '', relBy: '' };
  return { k, p: p[k] };
}
function favBetween(a, b) { const { p } = pairOf(a, b); return { aToB: p.fav[a] || 0, bToA: p.fav[b] || 0, relation: p.relation || '', relBy: p.relBy || '' }; }
function addFav(giver, target, n) {
  const { p } = pairOf(giver, target);
  const prev = p.fav[giver] || 0;
  p.fav[giver] = Math.min(100, prev + n);
  persist();
  const now = p.fav[giver];
  if (Math.floor(now / 20) !== Math.floor(prev / 20)) {
    const pA = online.get(giver), pB = online.get(target);
    const na = pA ? pA.nick : giver, nb = pB ? pB.nick : target;
    for (const [, o] of online) sendTo(o, { t: 'chat', uid: 'sys', nick: '系统', text: `❤️ ${na} 对 ${nb} 的好感提升（${now}）` });
  }
  return now;
}
function socialNear(aUid, bUid) {
  const A = online.get(aUid), B = online.get(bUid);
  if (!A || !B) return { ok: false, msg: '对方不在线' };
  if (A.scene !== B.scene) return { ok: false, msg: '你们不在同一场景，需要走近才能互动' };
  const d = Math.abs(A.x - B.x) + Math.abs(A.y - B.y);
  if (d > 520) return { ok: false, msg: `离对方太远（距离 ${Math.round(d / 100)} 格，需要 5 格内）` };
  return { ok: true };
}
// 目标可以是 uid 或在线昵称
function resolveOnlineUid(nameOrUid) {
  if (!nameOrUid) return null;
  if (online.has(nameOrUid)) return nameOrUid;
  for (const [k, o] of online) if (o.nick === nameOrUid) return k;
  return null;
}
function giftFavGain(aUid, bUid, itemId) {
  const it = ITEM_LIST.find(x => x.id === itemId);
  let g = 5 + Math.floor((it && it.sell_price ? it.sell_price : 10) / 25);
  g = Math.max(5, Math.min(20, g));
  const { p } = pairOf(aUid, bUid);
  if (p.relation === 'confidant' || p.relation === 'partner') g *= 2; // 知己/伴侣送礼翻倍
  return g;
}
// ---- 任务书 ----
const TASK_DEFS = [
  { id: 'task1', name: '和玩家聊一次天', type: 'talk', count: 1, reward: { id: 1, num: 50 }, desc: '对附近玩家发起一次对话' },
  { id: 'task2', name: '给玩家送一次礼', type: 'give', count: 1, reward: { id: 1, num: 80 }, desc: '给附近的玩家送一件物品' },
  { id: 'task3', name: '好感达到 30', type: 'fav', count: 30, reward: { id: 1, num: 120 }, desc: '让某位玩家对你的好感 ≥ 30' },
  { id: 'task4', name: '种 3 块地', type: 'plant', count: 3, reward: { id: 28, num: 2 }, desc: '种下 3 颗种子（小麦/玉米/土豆…）' },
  { id: 'task5', name: '收获 2 个作物', type: 'harvest', count: 2, reward: { id: 1, num: 100 }, desc: '收获 2 个成熟的作物' },
  { id: 'task6', name: '钓 1 条鱼', type: 'fish', count: 1, reward: { id: 1, num: 60 }, desc: '在水边钓一条鱼' },
  { id: 'task7', name: '砍 3 棵树', type: 'chop', count: 3, reward: { id: 18, num: 3 }, desc: '砍倒 3 棵树（得木材）' },
  { id: 'task8', name: '建立好友关系', type: 'bind', count: 1, reward: { id: 1, num: 150 }, desc: '和一位玩家结为「好友」（好感 30 后 /bind）' },
  { id: 'task9', name: '犁 3 块地', type: 'till', count: 3, reward: { id: 1, num: 60 }, desc: '犁 3 块可耕种土地（准备播种）' },
  { id: 'task10', name: '浇 3 次水', type: 'water', count: 3, reward: { id: 1, num: 70 }, desc: '给作物浇水 3 次，促进生长' },
];
function tasksOf(uid) {
  const pm = playersDb.get(uid) || playersDb.get('u' + uid);
  let t = pm && pm.get('afTasks');
  if (!t || !t.list) {
    t = { list: {}, done: {} };
    for (const d of TASK_DEFS) t.list[d.id] = { cur: 0, total: d.count };
    if (pm) { pm.set('afTasks', t); persist(); }
  }
  return t;
}
function taskCount(uid, type, n = 1) {
  try {
    const pm = playersDb.get(uid);
    if (!pm) return;
    const t = tasksOf(uid);
    let changed = false, completed = null;
    for (const d of TASK_DEFS) {
      if (d.type !== type || t.done[d.id]) continue;
      const it = t.list[d.id];
      it.cur = Math.min(it.total, it.cur + n);
      if (it.cur >= it.total) {
        t.done[d.id] = true;
        // 发奖励
        if (d.reward && d.reward.id) {
          knapAdd(pm, d.reward.id, d.reward.num || 1);
          const itm = ITEM_LIST.find(x => x.id === d.reward.id);
          const label = itm ? itm.name : '金币';
          completed = `✅ 任务完成「${d.name}」，奖励 ${label}×${d.reward.num}（已放入背包）`;
        } else completed = `✅ 任务完成「${d.name}」`;
      }
      changed = true;
    }
    if (changed) { pm.set('afTasks', t); persist(); }
    if (completed) {
      const p = online.get(uid);
      if (p) sendTo(p, { t: 'task_done', msg: completed });
      console.log(`[task] ${uid} 完成: ${completed}`);
    }
  } catch (e) { console.warn('[task] count err:', e.message); }
}
function taskRewardName(id) { const it = ITEM_LIST.find(x => x.id === id); return it ? it.name : '物品' + id; }

// ============================================================
// 外部 Agent 通道（/agent?token=AGENT_TOKEN）
// 协议：
//   agent -> server: {t:'observe'} / {t:'act', action, ...} / {t:'ping'}
//   server -> agent: {t:'welcome'|'state'|'result'|'chat'|'pong', ...}
// ============================================================
const ITEMS = loadJson(join(DATA_DIR, 'items.json'), {}); // 物品表（名称/价格，来自原版提取）
const ITEM_LIST = Array.isArray(ITEMS) ? ITEMS : [];
const NPCS = loadJson(join(DATA_DIR, 'npcs.json'), []);
const NPC_LIST = Array.isArray(NPCS) ? NPCS : [];
// 全地图碰撞网格（由 tools/build-collision.mjs 从 tmx 生成：房子/水面/边界/宅基地）
const COLLISION = loadJson(join(DATA_DIR, 'village-collision.json'), null);
const GRID_W = (COLLISION && COLLISION.width) || 105;
const GRID_H = (COLLISION && COLLISION.height) || 89;
// NPC 商店价目（服务器内部；agent 通过 talk 向 NPC 询价获得）
const SELL_X2 = (itemId) => {
  const it = ITEM_LIST.find(x => x.id === itemId);
  return it ? it.sell_price * 2 : 0;
};
const SHOP_TABLE = {
  4: [[12, SELL_X2(12)], [10, SELL_X2(10)], [19, SELL_X2(19)]],          // 屠夫：野猪腿/六眼飞鱼/杂鱼
  6: [[18, SELL_X2(18)], [7, SELL_X2(7)]],                                // 木匠：木材/水磨石
  13: [[28, SELL_X2(28)], [29, SELL_X2(29)], [30, SELL_X2(30)], [15, SELL_X2(15)], [16, SELL_X2(16)], [77, 200], [78, 500], [79, 1200]], // 杂货店：小麦/玉米/土豆/绒毛草/牧草/初级洒水器/中级洒水器/高级洒水器
  7: [[28, SELL_X2(28)], [29, SELL_X2(29)]],                              // 村长：粮食
  25: [[22, SELL_X2(22)]],                                                // 医生：陷阱（临时）
};
const AGENT_MOVE_STEP = 100; // 一格 = 100px
const agentSockets = new Map(); // uid -> Set<ws>
const agentMoves = new Map(); // uid -> 进行中的 move_to 任务（防并发）
const agentPos = new Map(); // uid -> {x,y,scene} 托管中的玩家位置

function publishAgentMove(uid, pos) {
  const self = online.get(uid);
  if (self) { self.scene = pos.scene; self.x = pos.x; self.y = pos.y; }
  for (const [otherUid, player] of online) {
    if (otherUid === uid) sendTo(player, { t: 'agent_move', scene: pos.scene, x: pos.x, y: pos.y });
    else sendTo(player, { t: 'move', uid, scene: pos.scene, x: pos.x, y: pos.y });
  }
}

function publishAgentMoveDone(uid, pos) {
  const self = online.get(uid);
  if (self) { self.scene = pos.scene; self.x = pos.x; self.y = pos.y; }
  for (const [otherUid, player] of online) {
    if (otherUid === uid) sendTo(player, { t: 'agent_move_done', scene: pos.scene, x: pos.x, y: pos.y });
    else sendTo(player, { t: 'move', uid, scene: pos.scene, x: pos.x, y: pos.y });
  }
}

function persistAgentPosition(uid, pos) {
  agentPos.set(uid, pos);
  const pd = playersDb.get(uid)?.get('playerData');
  if (!pd) return;
  pd.playerPos = { x: pos.x, y: pos.y };
  pd.posSceneType = pos.scene;
  pd.sceneType = pos.scene;
  persist();
}

// ---------- 玩法模拟（服务器权威；原版外壳客户端只负责渲染） ----------
// 种子 -> 作物表（seedItemId -> {plantId 渲染植物, cropItemId 收获物, days 成熟天数}）
const PLANT_CROPS = {
  36: { name: '小麦', plantId: 1, cropItemId: 28, days: 2 },
  37: { name: '玉米', plantId: 2, cropItemId: 29, days: 3 },
  38: { name: '土豆', plantId: 3, cropItemId: 30, days: 2 },
  39: { name: '兰花', plantId: 4, cropItemId: 31, days: 2 },
  40: { name: '黄菊', plantId: 5, cropItemId: 32, days: 3 },
  41: { name: '白菊', plantId: 6, cropItemId: 33, days: 3 },
  42: { name: '粉菊', plantId: 7, cropItemId: 34, days: 3 },
  43: { name: '迷幻花', plantId: 8, cropItemId: 35, days: 4 },
  52: { name: '北美草药', plantId: 9, cropItemId: 53, days: 3 },
  54: { name: '芥菜', plantId: 10, cropItemId: 55, days: 2 },
  56: { name: '辣椒', plantId: 11, cropItemId: 57, days: 3 },
  96: { name: '胡萝卜', plantId: 12, cropItemId: 97, days: 2 },
};
// 鱼池（概率权重）：水边 fish
const FISH_POOL = [
  [19, 30], [65, 20], [68, 15], [69, 15], [73, 10],
  [67, 10], [71, 8], [72, 5], [70, 4], [74, 1],
];
// 矿物池：矿山 mine
const MINE_POOL = [
  [109, 35], [60, 30], [61, 20], [7, 10], [84, 3],
];
// 矿山点（村边缘；由工具脚本挑选的可达格）
const MINE_SPOTS = loadJson(join(DATA_DIR, 'mine-spots.json'), null) || [];
function pickWeighted(pool) {
  let total = 0;
  for (const [, w] of pool) total += w;
  let r = Math.random() * total;
  for (const [id, w] of pool) { r -= w; if (r <= 0) return id; }
  return pool[pool.length - 1][0];
}
function nameOf(id) { const it = ITEM_LIST.find(x => x.id === id); return it ? it.name : ('道具' + id); }
// 玩家私有背包辅助：加物品 / 减物品
function knapAdd(pm, itemId, num) {
  const kn = pm.get('knapData') || { props: [] };
  kn.props = kn.props || [];
  const p = kn.props.find(x => x.id === itemId);
  if (p) p.num = (p.num || 0) + num; else kn.props.push({ id: itemId, num });
  pm.set('knapData', kn);
  return kn;
}
function knapHas(pm, itemId, num = 1) {
  const kn = pm.get('knapData') || { props: [] };
  const p = (kn.props || []).find(x => x.id === itemId);
  return p && (p.num || 0) >= num;
}
function knapSub(pm, itemId, num = 1) {
  const kn = pm.get('knapData') || { props: [] };
  const p = (kn.props || []).find(x => x.id === itemId);
  if (!p || (p.num || 0) < num) return false;
  p.num -= num;
  if (p.num <= 0) kn.props = kn.props.filter(x => x !== p);
  pm.set('knapData', kn);
  return true;
}
// 世界植物（sceneType=1 村庄，原版存档格坐标；world 桶共享 —— 玩家与 agent 共同耕种）
function worldPlants() {
  let pd = world.get('plantData');
  if (!pd) { pd = { datas: [{ sceneType: 3, plants: [] }, { sceneType: 2, plants: [] }, { sceneType: 1, plants: [] }] }; world.set('plantData', pd); }
  let sc = (pd.datas || []).find(d => d.sceneType === 1);
  if (!sc) { sc = { sceneType: 1, plants: [] }; pd.datas.push(sc); }
  if (!sc.plants) sc.plants = [];
  return sc.plants;
}
function worldPlots() {
  let fd = world.get('farmData');
  if (!fd) { fd = { plotDatas: [{ sceneType: 1, plots: [] }] }; world.set('farmData', fd); }
  let sc = (fd.plotDatas || []).find(d => d.sceneType === 1);
  if (!sc) { sc = { sceneType: 1, plots: [] }; fd.plotDatas.push(sc); }
  if (!sc.plots) sc.plots = [];
  return sc.plots;
}
function worldToSave(gx, gy) { return { x: gx, y: gy }; } // 迁移后：世界格即存档格（透传）
function saveToWorld(x, y) { return { gx: x, gy: y }; } // 迁移后：存档格即世界格（透传）
function soilAt(gx, gy) {
  if (!FARM) return false;
  if (gx < 0 || gy < 0 || gx >= FARM.soilW || gy >= FARM.soilH) return false;
  return FARM.plantSoils[gy * FARM.soilW + gx] === 1;
}
function waterAt(gx, gy) {
  if (!FARM) return false;
  if (gx < 0 || gy < 0 || gx >= FARM.waterW || gy >= FARM.waterH) return false;
  return FARM.water[gy * FARM.waterW + gx] === 1;
}
function plotAt(gx, gy) {
  return worldPlots().some(p => p.x === gx && p.y === gy);
}
// 洒水器数据：world bucket 里存 sprinklerData = [{x, y, level, owner}]
// level: 1=初级(3x3), 2=中级(5x5), 3=高级(7x7)
const SPRINKLER_RANGE = { 1: 1, 2: 2, 3: 3 }; // 半径（格）
function worldSprinklers() {
  let sd = world.get('sprinklerData');
  if (!sd) { sd = []; world.set('sprinklerData', sd); }
  return sd;
}
function sprinklerAt(gx, gy) {
  return worldSprinklers().find(s => s.x === gx && s.y === gy);
}
function removeSprinkler(gx, gy) {
  const sd = worldSprinklers();
  const idx = sd.findIndex(s => s.x === gx && s.y === gy);
  if (idx >= 0) sd.splice(idx, 1);
}
// 洒水器自动浇水：覆盖范围内的所有作物自动获得浇水
function sprinklerAutoWater() {
  const sprinklers = worldSprinklers();
  const plants = growPlants();
  if (!sprinklers.length || !plants.length) return 0;
  let watered = 0;
  for (const s of sprinklers) {
    const range = SPRINKLER_RANGE[s.level] || 1;
    for (const p of plants) {
      if (p.farmType !== 1 || !p.sownAt) continue;
      if (Math.abs(p.x - s.x) <= range && Math.abs(p.y - s.y) <= range) {
        const crop = Object.values(PLANT_CROPS).find(c => c.plantId === p.plantId);
        if (!crop || p.growDay >= crop.days) continue;
        p.sownAt = Math.max(p.sownAt - GROW_DAY_MS, Date.now() - GROW_DAY_MS * crop.days);
        p.growDay = Math.min(crop.days, Math.floor((Date.now() - p.sownAt) / GROW_DAY_MS));
        watered++;
      }
    }
  }
  if (watered > 0) persist();
  return watered;
}
// 作物生长推进（真实时间 -> growDay；原版客户端按 growDay 渲染成熟阶段）
function growPlants() {
  const plants = worldPlants();
  let changed = false;
  const now = Date.now();
  for (const p of plants) {
    if (p.farmType !== 1 || !p.sownAt) continue;
    const crop = Object.values(PLANT_CROPS).find(c => c.plantId === p.plantId);
    if (!crop) continue;
    const nd = Math.min(crop.days, Math.floor((now - p.sownAt) / GROW_DAY_MS));
    if (nd !== p.growDay) { p.growDay = nd; changed = true; }
  }
  if (changed) persist();
  return plants;
}
function plantAtWorld(gx, gy) {
  return growPlants().find(p => p.x === gx && p.y === gy);
}
// 目标坐标容错：agent 可能传格子坐标（如 33,15）或像素坐标（如 3350,1550）
// 规则：x<105 且 y<89 → 视为格子坐标，转像素；否则视为像素
function normXY(x, y) {
  let nx = Number(x), ny = Number(y);
  // 扩展地图 133×117，格子坐标 < 133/117 时视为格子坐标并转换为像素坐标
  const MW = FARM ? FARM.soilW + 28 : 133, MH = FARM ? FARM.soilH + 28 : 117;
  if (Number.isFinite(nx) && Number.isFinite(ny) && nx < MW && ny < MH) {
    nx = nx * 100 + 50; ny = ny * 100 + 50;
  }
  return { x: nx, y: ny };
}
// 树（可砍）：原版树 plantId 14-19，hp 30/60
function treeOf(p) { return p && p.plantId >= 14 && p.plantId <= 19; }
function nextPlantUid() {
  let mx = 0;
  for (const p of worldPlants()) if (p.uId > mx) mx = p.uId;
  return mx + 1;
}

// ---------- 玩家操作流（打断 agent 用） ----------
const playerOps = new Map(); // uid -> [{at, kind, text}...]
const lastOpPush = new Map(); // uid -> at（push 节流：玩家频繁存档时每 5s 最多推一次）
const CHAT_LOG = []; // 玩家频道聊天记录（cap 50）
function notePlayerOp(uid, kind, text) {
  const arr = playerOps.get(uid) || [];
  arr.push({ at: Date.now(), kind, text });
  while (arr.length > 10) arr.shift();
  playerOps.set(uid, arr);
  // 节流：5 秒内只 push 一次，避免玩家正常游玩（频繁存档）把 agent 打断刷屏
  const now = Date.now();
  if (now - (lastOpPush.get(uid) || 0) < 5000) return;
  lastOpPush.set(uid, now);
  // agent 在线 → 实时推送打断信号（指挥消息/聊天不推送，走收件箱/聊天记录）
  const s = agentSockets.get(uid);
  if (s) for (const w of s) if (w.readyState === 1) w.send(JSON.stringify({ t: 'player_op', kind, text }));
}
// agent 收件箱（玩家指挥消息；持久化，agent 不在线也不丢）
function inboxOf(acc) {
  const uname = Object.keys(accounts).find(k => accounts[k] === acc) || acc.nick || 'default';
  const f = join(DATA_DIR, 'agent-notes', uname, 'inbox.json');
  let arr = loadJson(f, []);
  if (!Array.isArray(arr)) arr = [];
  return { file: f, arr };
}
function pushInbox(acc, from, text) {
  const { file, arr } = inboxOf(acc);
  arr.push({ from, text, at: Date.now() });
  while (arr.length > 50) arr.shift();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(arr, null, 1));
  const s = agentSockets.get(acc.uid);
  if (s) for (const w of s) if (w.readyState === 1) w.send(JSON.stringify({ t: 'inbox_push' }));
  console.log(`[inbox] ${from} -> ${acc.nick}: ${text.slice(0, 60)}`);
}

function blockedAt(gx, gy) {
  if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return true;
  return COLLISION && COLLISION.blocked[gy * GRID_W + gx] === 1;
}
function nearestReachable(gx, gy, maxR = 8) {
  if (!blockedAt(gx, gy)) return [gx, gy];
  let found = null;
  outer:
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = gx + dx, ny = gy + dy;
        if (!blockedAt(nx, ny)) { found = [nx, ny]; break outer; }
      }
    }
  }
  return found;
}
function bfsPath(sx, sy, tx, ty) {
  // 目标/起点都可能在某障碍上（含起点在墙内的情况）：先吸附到最近可达格
  const T = nearestReachable(tx, ty);
  if (!T) return null;
  tx = T[0]; ty = T[1];
  const S = nearestReachable(sx, sy);
  if (!S) return null;
  sx = S[0]; sy = S[1];
  if (sx === tx && sy === ty) return [ [sx, sy] ]; // 吸附后重合，原地
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const prev = new Map();
  const q = [[sx, sy]];
  prev.set(sx + ',' + sy, null);
  while (q.length) {
    const [cx, cy] = q.shift();
    if (cx === tx && cy === ty) break;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy, k = nx + ',' + ny;
      if (blockedAt(nx, ny) || prev.has(k)) continue;
      prev.set(k, [cx, cy]);
      q.push([nx, ny]);
    }
  }
  if (!prev.has(tx + ',' + ty)) return null;
  const path = [];
  let cur = [tx, ty];
  while (cur) { path.push(cur); cur = prev.get(cur[0] + ',' + cur[1]); }
  path.reverse();
  return path;
}

function agentConn(ws, u) {
  const token = u.searchParams.get('token');
  const acc = findAccountByToken(token);
  if (!acc || !acc.agentToken || token !== acc.agentToken) {
    console.log('[agent] 拒绝: 无效接入码');
    ws.close(4001, 'bad agent token');
    return;
  }
  const uid = acc.uid;
  const nick = acc.nick || uid;
  ensurePlayerData(uid);
  console.log(`[agent] 接入: ${nick} (${uid})`);
  if (!agentSockets.has(uid)) agentSockets.set(uid, new Set());
  agentSockets.get(uid).add(ws);
  // 托管直接驱动玩家本体。客户端复用原版 playerNode，因此相机和角色外观无需另建一套。
  const pd0 = playersDb.get(uid)?.get('playerData') || {};
  const livePos = online.get(uid);
  const apos0 = agentPos.get(uid) || (livePos
    ? { x: livePos.x, y: livePos.y, scene: livePos.scene }
    : { x: pd0.playerPos?.x ?? 0, y: pd0.playerPos?.y ?? 0, scene: pd0.sceneType ?? 2 });
  // 起步位置兜底：若落在墙内/不可达（如 0,0 在墙角），吸附到最近可达格，避免一开始就"不可达"
  const sg = Math.floor((apos0.x ?? 0) / 100), sh = Math.floor((apos0.y ?? 0) / 100);
  const sn = nearestReachable(sg, sh, 15);
  if (!sn) { apos0.x = 3500; apos0.y = 3000; } // 彻底兜底：村中心
  else { apos0.x = sn[0] * 100 + 50; apos0.y = sn[1] * 100 + 50; }
  agentPos.set(uid, apos0);
  for (const [k, p] of online) if (k === uid) sendTo(p, { t: 'agent_status', online: true, nick });

  const send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  const pm = playersDb.get(uid);

  // 玩家可见的 Agent 活动状态（"正在种地/赶路中…"），同文本 3 秒节流
  let lastActAt = 0, lastActText = '';
  function publishAgentActivity(text) {
    const now = Date.now();
    if (text === lastActText && now - lastActAt < 3000) return;
    lastActAt = now; lastActText = text;
    const p = online.get(uid);
    if (p) sendTo(p, { t: 'agent_activity', activity: text });
  }

  // 可观察世界状态（给 agent 的 LLM 看）
  function observeState() {
    const pd = pm.get('playerData') || {};
    const kn = pm.get('knapData') || {};
    const npc = pm.get('npcData') || {};
    const shop = pm.get('shopData') || {};
    const props = (kn.props || []).map(p => {
      const it = ITEM_LIST.find(x => x.id === p.id);
      return { id: p.id, name: it ? it.name : ('道具' + p.id), num: p.num };
    });
    const coins = (kn.props || []).find(p => p.id === 1)?.num || 0;
    const npcList = (npc.npcDatas || []).map(n => ({ npcId: n.npcId, star: n.starNum, scene: n.stayScene }));
    // Agent 位置（独立于玩家存档）
    const apos = agentPos.get(uid) || { x: pd.playerPos?.x ?? 0, y: pd.playerPos?.y ?? 0, scene: pd.sceneType ?? 2 };
    // 周围植物（3 格内）：玩家/Agent 种的作物 + 可砍的树（场景装饰草不显示）
    const gx = Math.floor((apos.x ?? 0) / 100), gy = Math.floor((apos.y ?? 0) / 100);
    const plantsNear = growPlants()
      .filter(p => (p.farmType === 1 || treeOf(p)) && Math.abs(p.x - gx) <= 3 && Math.abs(p.y - gy) <= 3)
      .map(p => {
        const crop = Object.values(PLANT_CROPS).find(c => c.plantId === p.plantId);
        return {
          gx: p.x, gy: p.y, px: p.x * 100 + 50, py: p.y * 100 + 50, plantId: p.plantId,
          kind: treeOf(p) ? `树(${p.hp}HP)` : (crop ? `${crop.name}${p.growDay >= crop.days ? '(成熟可收)' : `(${p.growDay}/${crop.days}天)`}` : '植物'),
          hp: p.hp,
        };
      });
    const mineSpots = MINE_SPOTS.map(s => ({ gx: s.gx, gy: s.gy, px: s.gx * 100 + 50, py: s.gy * 100 + 50 }));
    // 附近可砍的树（10 格内）
    const treesNear = growPlants()
      .filter(p => treeOf(p) && Math.abs(p.x - gx) <= 10 && Math.abs(p.y - gy) <= 10)
      .map(p => ({ gx: p.x, gy: p.y, px: p.x * 100 + 50, py: p.y * 100 + 50, plantId: p.plantId, hp: p.hp }));
    // 附近可犁地 / 已犁地块（3 格内）——种地工作流（先犁后种）用
    const tillableNear = [];
    const plotsNear = [];
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= (FARM ? FARM.soilW : 999) || ny >= (FARM ? FARM.soilH : 999)) continue;
        if (soilAt(nx, ny) && !plotAt(nx, ny) && !plantAtWorld(nx, ny) && !waterAt(nx, ny) && !blockedAt(nx, ny)) {
          tillableNear.push({ gx: nx, gy: ny, px: nx * 100 + 50, py: ny * 100 + 50 });
        }
        if (plotAt(nx, ny)) {
          const pl = worldPlots().find(q => q.x === nx && q.y === ny);
          const pp = pl && pl.plantUID ? plantAtWorld(nx, ny) : null;
          const crop = pp ? Object.values(PLANT_CROPS).find(c => c.plantId === pp.plantId) : null;
          plotsNear.push({
            gx: nx, gy: ny, px: nx * 100 + 50, py: ny * 100 + 50,
            planted: !!pp,
            crop: crop ? crop.name : null,
            status: !pp ? '已犁·可播种' : (crop && pp.growDay >= crop.days ? '成熟可收' : (crop ? `${pp.growDay}/${crop.days}天·未成熟` : '植物')),
          });
        }
      }
    }
    // 附近玩家（同场景 8 格内）——"种我脚下周围的地"这类指令需要
    const playersNear = Array.from(online.values())
      .filter(o => o.uid !== uid && o.scene === (apos.scene ?? pd.sceneType ?? 0) && Math.abs(o.x - (apos.x ?? 0)) + Math.abs(o.y - (apos.y ?? 0)) <= 800)
      .map(o => ({ nick: o.nick, dist: Math.round((Math.abs(o.x - (apos.x ?? 0)) + Math.abs(o.y - (apos.y ?? 0))) / 100) }));
    const { arr: inboxArr } = inboxOf(acc);
    const ops = (playerOps.get(uid) || []).map(o => ({ kind: o.kind, text: o.text, at: o.at }));
    return {
      nick, uid,
      scene: apos.scene ?? pd.sceneType ?? 0,
      pos: { x: apos.x ?? 0, y: apos.y ?? 0 },
      day: pd.day ?? 0, time: pd.time ?? 0, weather: pd.weatherType ?? 1,
      coins,
      backpack: props,
      npcs: npcList,
      shopItems: (shop.openShopItems || []).slice(0, 20),
      online: Array.from(online.values()).map(p => ({ nick: p.nick, scene: p.scene })),
      plantsNear,
      treesNear,
      tillableNear,
      plotsNear,
      playersNear,
      farm: { plots: worldPlots().map(p => ({ gx: p.x, gy: p.y, px: p.x * 100 + 50, py: p.y * 100 + 50, plantUID: p.plantUID })).slice(0, 12), mineSpots },
      sprinklers: worldSprinklers().map(s => ({ gx: s.x, gy: s.y, level: s.level, range: SPRINKLER_RANGE[s.level] })),
      waterNear: (() => { let n = false; for (let dy = -1; dy <= 1 && !n; dy++) for (let dx = -1; dx <= 1; dx++) if (waterAt(gx + dx, gy + dy)) { n = true; break; } return n; })(),
      inbox: inboxArr.length
        ? { unread: inboxArr.length, last: { from: inboxArr[inboxArr.length - 1].from, text: inboxArr[inboxArr.length - 1].text } }
        : { unread: 0, last: null },
      playerOps: ops,
      chatRecent: CHAT_LOG.slice(-3),
      seeds: Object.keys(PLANT_CROPS).map(id => ({ id: Number(id), name: PLANT_CROPS[id].name + '种子' })),
    };
  }

  // 碰撞：宅基地房子/树篱矩形 + 地图边界
  function blocked(scene, x, y) {
    if (!SPAWNS || scene !== (SPAWNS.scene || 2)) return false;
    const PW = 60, PH = 45;
    for (const h of SPAWNS.houses) {
      const r = h.rect;
      const b = { x: (r.x + r.w / 2) * 100, y: (r.y + r.h / 2) * 100, w: r.w * 100, h: r.h * 100 };
      if (x + PW > b.x - b.w / 2 && x - PW < b.x + b.w / 2 && y + PH > b.y - b.h / 2 && y - PH < b.y + b.h / 2) return true;
    }
    return false;
  }

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.t) {
      case 'observe': {
        send({ t: 'state', ...observeState() });
        break;
      }
      case 'inbox': {
        // 拉取玩家指挥消息（读后清空；不打断 —— 属于"聊天类"操作）
        const { file, arr } = inboxOf(acc);
        const msgs = arr.map(m => ({ from: m.from, text: m.text, at: m.at }));
        if (arr.length) { writeFileSync(file, '[]'); }
        send({ t: 'inbox', msgs });
        break;
      }
      case 'chat_log': {
        // 玩家频道聊天记录（不打断）
        send({ t: 'chat_log', msgs: CHAT_LOG.slice(-20) });
        break;
      }
      case 'act': {
        const action = String(msg.action || '');
        const pd = pm.get('playerData') || {};
        const apos = agentPos.get(uid) || { x: pd.playerPos?.x ?? 0, y: pd.playerPos?.y ?? 0, scene: pd.sceneType ?? 2 };
        let result = { ok: false, msg: 'unknown action' };
        let responseType = 'result';
        do { // do-while(false)：链内 break 只跳出本块，send(result) 始终执行
        if (action === 'move') {
          const dir = String(msg.dir || '');
          let nx = apos.x ?? 0, ny = apos.y ?? 0;
          if (dir === 'up') ny += AGENT_MOVE_STEP;
          else if (dir === 'down') ny -= AGENT_MOVE_STEP;
          else if (dir === 'left') nx -= AGENT_MOVE_STEP;
          else if (dir === 'right') nx += AGENT_MOVE_STEP;
          else { result.msg = 'dir 需为 up/down/left/right'; continue; }
          if (blocked(apos.scene, nx, ny)) { result.msg = '前方有障碍'; continue; }
          if (nx < 0 || ny < 0) { result.msg = '地图边界'; continue; }
          apos.x = nx; apos.y = ny;
          publishAgentMove(uid, apos);
          persistAgentPosition(uid, apos);
          publishAgentActivity('移动中 (' + Math.round(apos.x) + ',' + Math.round(apos.y) + ')');
          result = { ok: true, pos: { x: nx, y: ny }, scene: apos.scene };
        } else if (action === 'chat') {
          const text = String(msg.text || '').slice(0, 200);
          for (const [k, o] of online) sendTo(o, { t: 'chat', uid, nick: nick + '(托管)', text });
          console.log(`[agent-chat] ${nick}: ${text}`);
          publishAgentActivity('正在说话');
          result = { ok: true, sent: text };
        } else if (action === 'move_to') {
          console.log(`[agent-move_to] ${nick} 目标 (${msg.x},${msg.y}) 当前 (${apos.x},${apos.y})`);
          // 直达寻路：BFS 规划路径，逐步移动（每步广播），完成后返回
          const tx = Math.floor(Number(msg.x) / 100), ty = Math.floor(Number(msg.y) / 100);
          const sx = Math.floor((apos.x ?? 0) / 100), sy = Math.floor((apos.y ?? 0) / 100);
          if (agentMoves.has(uid)) { result = { ok: false, msg: '上一个移动还没走完，请稍等' }; continue; }
          if (sx === tx && sy === ty) { result = { ok: true, msg: '已经在目标位置，无需移动' }; continue; }
          const path = bfsPath(sx, sy, tx, ty);
          console.log(`[agent-move_to] 路径: ${path ? path.length + ' 步' : '不可达'}`);
          if (!path) { result = { ok: false, msg: '目标不可达（被障碍包围）' }; continue; }
          if (path.length < 2) { result = { ok: true, msg: '已经在目标位置，无需移动' }; continue; }
          if (path.length > 60) { result = { ok: false, msg: `路径过长(${path.length}步)，请分两段走（先到中途点再继续）` }; continue; }
          publishAgentActivity(`赶路中：前往 (${tx},${ty}) 附近`);
          // 若起点被吸附（原起点在墙内），先落位吸附点，再从下一步走
          const [p0x, p0y] = path[0];
          apos.x = p0x * 100 + 50; apos.y = p0y * 100 + 50;
          // 每步驱动玩家本体；最终位置写回玩家存档，刷新页面后仍在同一地点。
          const task = (async () => {
            let i = 1;
            for (; i < path.length; i++) {
              const [gx, gy] = path[i];
              apos.x = gx * 100 + 50; apos.y = gy * 100 + 50;
              publishAgentMove(uid, apos);
              await new Promise(r => setTimeout(r, 120));
            }
            persistAgentPosition(uid, apos);
            agentMoves.delete(uid);
            publishAgentMoveDone(uid, apos);
            publishAgentActivity('到达目标，准备行动');
            send({ t: 'result', action, seq: msg.seq, ok: true, pos: { x: apos.x, y: apos.y }, steps: path.length - 1, scene: apos.scene });
            console.log(`[agent-move_to] ${nick} 到达 (${apos.x},${apos.y})`);
          })().catch((error) => {
            agentMoves.delete(uid);
            publishAgentMoveDone(uid, apos);
            send({ t: 'result', action, seq: msg.seq, ok: false, msg: `移动失败：${String(error?.message || error).slice(0, 120)}` });
          });
          agentMoves.set(uid, task);
          // 立即返回"已开始"（最终结果走完后再发）
          result = { ok: true, msg: `已开始移动：${path.length - 1} 步` };
          responseType = 'move_started';
        } else if (action === 'talk') {
          const npcId = Number(msg.npcId || msg.id);
          const npc = NPC_LIST.find(n => n.id === npcId);
          if (!npc) { result = { ok: false, msg: '没有这个 NPC（id 1-26）' }; continue; }
          const shop = SHOP_TABLE[npcId];
          if (!shop || !shop.length) {
            result = { ok: true, msg: `${npc.name}：我只是个村民，不卖东西。` };
          }
          const lines = shop.map(([itemId, price]) => {
            const it = ITEM_LIST.find(x => x.id === itemId);
            return `${it ? it.name : '物品' + itemId}（id=${itemId}）${price} 金币/个`;
          });
          result = { ok: true, msg: `${npc.name}：我这里的货：${lines.join('，')}。报物品 id 和数量就能买。` };
        } else if (action === 'buy') {
          // 价目优先取 SHOP_TABLE（杂货店硬编码价），其次 sell_price * 2
          const itemId = Number(msg.itemId || msg.item);
          const count = Math.max(1, Number(msg.count || 1));
          const it = ITEM_LIST.find(x => x.id === itemId);
          if (!it) { result.msg = '没有这个物品'; continue; }
          // 查所有商店是否有此商品（取最低价）
          let shopPrice = null;
          for (const [, shop] of Object.entries(SHOP_TABLE)) {
            const entry = shop.find(([id]) => id === itemId);
            if (entry) { shopPrice = entry[1]; break; }
          }
          const price = shopPrice ?? (it.sell_price > 0 ? it.sell_price * 2 : null);
          if (price === null) { result.msg = '该物品不可购买'; continue; }
          const kn = pm.get('knapData') || { props: [] };
          const coinsProp = (kn.props || []).find(p => p.id === 1);
          const coins = coinsProp ? coinsProp.num : 0;
          const total = price * count;
          if (coins < total) { result.msg = `金币不足（需要 ${total}，现有 ${coins}）`; continue; }
          if (!coinsProp) { kn.props = kn.props || []; kn.props.push({ id: 1, num: 0 }); }
          kn.props.find(p => p.id === 1).num = coins - total;
          const exist = kn.props.find(p => p.id === itemId);
          if (exist) exist.num = (exist.num || 0) + count;
          else kn.props.push({ id: itemId, num: count });
          pm.set('knapData', kn);
          persist();
          taskCount(uid, 'buy', count);
          publishAgentActivity('正在购买' + it.name);
          result = { ok: true, bought: { id: itemId, name: it.name, count, total }, coins: coins - total };
        } else if (action === 'till') {
          // 犁地：目标格可种土且未被犁/无植物/无水/无障碍 → farmData 添加地块
          const _t = normXY(msg.x, msg.y);
          const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
          const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
          if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = '离目标太远（需要站在目标格相邻格）'; continue; }
          if (plotAt(gx, gy)) { result.msg = '这块地已经犁过了'; continue; }
          if (plantAtWorld(gx, gy)) { result.msg = '这个格子上有植物了'; continue; }
          if (waterAt(gx, gy) || blockedAt(gx, gy)) { result.msg = '这个格子不能犁（水面/障碍）'; continue; }
          if (!soilAt(gx, gy)) { result.msg = `这个格子不是可耕种土地（${gx},${gy}）`; continue; }
          worldPlots().push({ x: gx, y: gy, plantUID: 0, farmType: 1, owner: uid });
          persist();
          taskCount(uid, 'till');
          publishAgentActivity(uid, `正在犁地 (${gx},${gy})`);
          result = { ok: true, tilled: { gx, gy }, msg: `犁好了 (${gx},${gy}) 的田地，可以播种了` };
        } else if (action === 'water') {
          // 浇水：目标格有未成熟作物 → 生长推进 1 天（sownAt 前移，重启后依然有效）
          const _t = normXY(msg.x, msg.y);
          const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
          const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
          if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = '离目标太远（需要站在目标格相邻格）'; continue; }
          const p = plantAtWorld(gx, gy);
          if (!p) { result.msg = '这个格子上没有作物可浇'; continue; }
          if (p.farmType !== 1) { result.msg = '这是场景植物，不需要浇水'; continue; }
          const crop = Object.values(PLANT_CROPS).find(c => c.plantId === p.plantId);
          if (!crop) { result.msg = '未知作物'; continue; }
          if (p.growDay >= crop.days) { result.msg = `${crop.name}已经成熟了，直接收获吧`; continue; }
          p.sownAt = Math.max(p.sownAt - GROW_DAY_MS, Date.now() - GROW_DAY_MS * crop.days);
          p.growDay = Math.min(crop.days, Math.floor((Date.now() - p.sownAt) / GROW_DAY_MS));
          persist();
          taskCount(uid, 'water');
          publishAgentActivity(uid, `正在给${crop.name}浇水`);
          result = { ok: true, watered: { crop: crop.name, gx, gy }, msg: `给${crop.name}浇了水，生长推进（${p.growDay}/${crop.days}天）` };
        } else if (action === 'plant') {
          // 种地：目标格可种（可种土或已锄农田）且无植物占用，消耗 1 颗种子
          const seedId = Number(msg.itemId || msg.seed);
          const crop = PLANT_CROPS[seedId];
          if (!crop) { result.msg = `没有这种种子（可用种子 id：${Object.keys(PLANT_CROPS).join('/')}，先用 buy 买）`; continue; }
          const _t = normXY(msg.x, msg.y);
          const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
          const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
          if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = `离目标太远（需要站在目标格相邻格，当前 (${px},${py}) 目标 (${gx},${gy})）`; continue; }
          if (!knapHas(pm, seedId, 1)) { result.msg = `背包里没有 ${crop.name}种子（先用 buy 买 id=${seedId}）`; continue; }
          if (!soilAt(gx, gy) && !plotAt(gx, gy)) { result.msg = `这个格子不能种（${gx},${gy}）：不是可种土或农田`; continue; }
          if (plantAtWorld(gx, gy)) { result.msg = '这个格子已经有植物了'; continue; }
          knapSub(pm, seedId, 1);
          const sv = worldToSave(gx, gy);
          const p = { uId: nextPlantUid(), plantId: crop.plantId, x: sv.x, y: sv.y, hp: 10, farmType: 1, growDay: 0, sownAt: Date.now() };
          worldPlants().push(p);
          // 若是已锄农田格，关联 farm plot
          const plot = worldPlots().find(pl => pl.x === gx && pl.y === gy);
          if (plot) plot.plantUID = p.uId;
          persist();
          taskCount(uid, 'plant');
          result = { ok: true, planted: { crop: crop.name, gx, gy, uid: p.uId }, msg: `种下了${crop.name}（${crop.days} 天后成熟，growDay=${p.growDay}）` };
        } else if (action === 'harvest') {
          const _t = normXY(msg.x, msg.y);
          const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
          const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
          if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = '离目标太远（需要站在目标格相邻格）'; continue; }
          const p = plantAtWorld(gx, gy);
          if (!p) { result.msg = '这个格子上没有作物'; continue; }
          if (p.farmType !== 1) { result.msg = '这不是你种的作物（是场景植物）'; continue; }
          const crop = Object.values(PLANT_CROPS).find(c => c.plantId === p.plantId);
          if (!crop) { result.msg = '未知作物'; continue; }
          if (p.growDay < crop.days) { result.msg = `${crop.name}还没成熟（${p.growDay}/${crop.days} 天）`; continue; }
          worldPlants().splice(worldPlants().indexOf(p), 1);
          const plot = worldPlots().find(pl => pl.plantUID === p.uId);
          if (plot) plot.plantUID = 0;
          knapAdd(pm, crop.cropItemId, 1);
          persist();
          taskCount(uid, 'harvest');
          publishAgentActivity('正在收获' + crop.name);
          result = { ok: true, harvested: { crop: crop.name, itemId: crop.cropItemId }, msg: `收获了${crop.name} ×1，已放入背包` };
        } else if (action === 'chop') {
          // 砍树：目标格有树（原版树 plantId 14-19），一刀 -20 hp
          const _t = normXY(msg.x, msg.y);
          const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
          const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
          if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = '离目标太远（需要站在目标格相邻格）'; continue; }
          const p = growPlants().find(pl => pl.x === gx && pl.y === gy && treeOf(pl));
          if (!p) { result.msg = '这个格子上没有树'; continue; }
          p.hp = (p.hp || 10) - 20;
          if (p.hp <= 0) {
            worldPlants().splice(worldPlants().indexOf(p), 1);
            const plot = worldPlots().find(pl => pl.plantUID === p.uId);
            if (plot) plot.plantUID = 0;
            knapAdd(pm, 18, 3);
            persist();
            taskCount(uid, 'chop');
            publishAgentActivity('正在砍树');
            result = { ok: true, msg: '树被砍倒了！获得木材 ×3（id=18）' };
          } else {
            persist();
            result = { ok: true, msg: `砍了一斧头，树还剩 ${p.hp} HP（再砍几斧就倒）` };
          }
        } else if (action === 'fish') {
          // 钓鱼：站在水边（8 邻域有水格），需要鱼竿
          const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
          let nearWater = false;
          for (let dy = -1; dy <= 1 && !nearWater; dy++)
            for (let dx = -1; dx <= 1; dx++) if (waterAt(px + dx, py + dy)) { nearWater = true; break; }
          if (!nearWater) { result.msg = `不在水边（当前位置 (${px},${py}) 附近没有水域）。请 move_to 到河边再钓`; continue; }
          if (!knapHas(pm, 6, 1)) { result.msg = '没有鱼竿（id=6）'; continue; }
          const fid = pickWeighted(FISH_POOL);
          knapAdd(pm, fid, 1);
          persist();
          taskCount(uid, 'fish');
          publishAgentActivity('正在钓鱼');
          result = { ok: true, caught: { itemId: fid, name: nameOf(fid) }, msg: `钓到一条${nameOf(fid)}！已放入背包` };
        } else if (action === 'mine') {
          // 挖矿：在矿山点附近，需要镐
          const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
          const nearSpot = MINE_SPOTS.some(sp => Math.abs(sp.gx - px) <= 2 && Math.abs(sp.gy - py) <= 2);
          if (!nearSpot) { result.msg = '附近没有矿山（在村庄边缘的矿点附近才能挖矿）'; continue; }
          if (!knapHas(pm, 58, 1)) { result.msg = '没有镐（id=58）'; continue; }
          const mid = pickWeighted(MINE_POOL);
          knapAdd(pm, mid, 1);
          persist();
          taskCount(uid, 'mine');
          result = { ok: true, mined: { itemId: mid, name: nameOf(mid) }, msg: `挖到一块${nameOf(mid)}！已放入背包` };
        } else if (action === 'place') {
          // 放置洒水器：消耗背包里的洒水器，安装到目标格
          const itemId = Number(msg.itemId || msg.item);
          const it = ITEM_LIST.find(x => x.id === itemId);
          if (!it || it.type !== 9) { result.msg = '这不是可放置的物品（type=9）'; continue; }
          const level = it.param1; // 1/2/3/4... 对应洒水器级别
          if (level < 1 || level > 3) { result.msg = `${it.name}不能作为洒水器安装`; continue; }
          const _t = normXY(msg.x, msg.y);
          const gx = Math.floor(_t.x / 100), gy = Math.floor(_t.y / 100);
          const px = Math.floor((apos.x ?? 0) / 100), py = Math.floor((apos.y ?? 0) / 100);
          if (Math.abs(gx - px) > 1 || Math.abs(gy - py) > 1) { result.msg = '离目标太远（需要站在目标格相邻格）'; continue; }
          if (!knapHas(pm, itemId, 1)) { result.msg = `背包里没有 ${it.name}（先用 buy 买 id=${itemId}）`; continue; }
          if (sprinklerAt(gx, gy)) { result.msg = '这个格子已经安装了洒水器'; continue; }
          if (waterAt(gx, gy) || blockedAt(gx, gy)) { result.msg = '这个格子不能安装洒水器（水面/障碍）'; continue; }
          knapSub(pm, itemId, 1);
          worldSprinklers().push({ x: gx, y: gy, level, owner: uid });
          persist();
          const rangeLabel = { 1: '3×3', 2: '5×5', 3: '7×7' };
          result = { ok: true, placed: { name: it.name, gx, gy, level, range: rangeLabel[level] }, msg: `已安装${it.name}（覆盖 ${rangeLabel[level]} 范围，每天自动浇水2次）` };
        }
        } while (false); // end do-while
        send({ t: responseType, action, seq: msg.seq, ...result });
      }
      case 'ping': send({ t: 'pong' }); break;
    }
  });
  ws.on('close', () => {
    const s = agentSockets.get(uid);
    if (s) { s.delete(ws); if (!s.size) agentSockets.delete(uid); }
    console.log(`[agent] 断开: ${nick}`);
    // 通知该 uid 的玩家在线连接：托管结束
    for (const [k, p] of online) if (k === uid) sendTo(p, { t: 'agent_status', online: false });
  });
  // 欢迎 + 初始状态
  send({ t: 'welcome', uid, nick, notice: 'AgentFarm2 游戏接入。发送 {t:"observe"} 查看世界，{t:"act",action:"move|chat|buy",...} 行动。' });
  send({ t: 'state', ...observeState() });
}

// ---------- 内网穿透（localtunnel）----------
let tunnelUrl = null;  // 公网地址
let tunnelInfo = null; // localtunnel 实例
let roomCode = null;   // 6位房间码

function genRoomCode() {
  // 6位数字码（用时间戳+随机生成，防碰撞）
  const now = Date.now().toString(36).slice(-3);
  const rnd = randomBytes(2).toString('hex').slice(0, 3);
  return (now + rnd).replace(/[a-f]/g, c => (c.charCodeAt(0) - 87)).slice(0, 6);
}

async function startTunnel(port) {
  try {
    tunnelInfo = await localtunnel({ port, subdomain: 'afarm-' + genRoomCode() });
    tunnelUrl = tunnelInfo.url;
    roomCode = genRoomCode();
    // 存储房间码 -> 地址映射（内存中，重启失效）
    roomCodes.set(roomCode, tunnelUrl);
    console.log(`[tunnel] ✅ 穿透成功！`);
    console.log(`[tunnel] 公网地址: ${tunnelUrl}`);
    console.log(`[tunnel] 房间码: ${roomCode}`);
    console.log(`[tunnel] 朋友输入房间码 ${roomCode} 即可加入`);
    tunnelInfo.on('close', () => {
      tunnelUrl = null; roomCode = null;
      console.log('[tunnel] 隧道已关闭');
    });
  } catch (e) {
    console.log(`[tunnel] ❌ 穿透失败: ${e.message}`);
    console.log(`[tunnel] 仍在局域网模式，朋友可通过 IP:${port} 加入`);
  }
}

const roomCodes = new Map(); // code -> url

server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  AgentFarm2 服务器就绪`);
  console.log(`  本地地址: http://127.0.0.1:${PORT}/`);
  console.log(`  存档位: ${CURRENT_SLOT}`);
  console.log(`========================================`);
  // 洒水器自动浇水：每 5 分钟检查一次
  setInterval(() => {
    const n = sprinklerAutoWater();
    if (n > 0) console.log(`[sprinkler] 自动浇水 ${n} 株作物`);
  }, 5 * 60 * 1000);
  // 自动启动内网穿透（异步，不阻塞服务器）
  startTunnel(PORT);
});
