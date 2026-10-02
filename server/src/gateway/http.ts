// gateway/http.ts —— HTTP 路由（/af/* 账号/存档/agent/房间 API + 原版外壳静态服务）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { App } from '../app.ts';
import { loadJson } from '../persistence/state.ts';
import { AccountStore } from '../persistence/accounts.ts';
import { PROVIDER_FILE, SAVES_DIR, PORT, slotPaths } from '../config.ts';
import { readJsonBody, RegisterBody, AgentProviderBody, AgentControlBody, SwitchSlotBody, RenameSlotBody, JoinRoomBody, GiveCoinsBody, GiveItemBody, AgentSetupBody } from './protocol.ts';
import { resolveProvider } from '../cognition/managed.ts';
import { probeProvider } from '../cognition/provider-probe.ts';
import { runLocalBackup } from '../persistence/backup.ts';
import { log } from '../logging.ts';
import { keyvaultAvailable, upsertLlmKey, readLlmKey, usageSummary } from '../persistence/keyvault.ts';
import { verifyReplayDeterminism } from '../narrative/replay.ts';
import { buildDailyReport } from '../narrative/report.ts';
import { economyReport } from '../market/economy.ts';
import { calendarDay, currentGameDay } from '../world/calendar.ts';
import { worldAnimals, ANIMALS } from '../world/livestock.ts';
import { courtyardRanking } from '../world/decor.ts';
import { gameHourOf, npcDecision, villagePois } from '../world/schedule.ts';
import { municipalOf } from '../navigation/municipal.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
void __dirname;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.css': 'text/css', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.fnt': 'application/octet-stream', '.plist': 'application/octet-stream',
  '.fire': 'application/octet-stream', '.prefab': 'application/octet-stream', '.anim': 'application/octet-stream',
  '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(app: App, req: http.IncomingMessage, res: http.ServerResponse): void {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(app.clientRoot, urlPath);
  if (!filePath.startsWith(app.clientRoot) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const st = fs.statSync(filePath);
  const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  res.setHeader('Cache-Control', 'no-cache');
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? parseInt(m[1]) : 0;
    const end = m && m[2] ? parseInt(m[2]) : st.size - 1;
    res.writeHead(206, {
      'Content-Type': mime, 'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  }
}

function json(res: http.ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function text(res: http.ServerResponse, code: number, s: string): void {
  res.writeHead(code);
  res.end(s);
}

export function createHttpHandler(app: App): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return async (req, res) => {
    const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    // ---------- 账号 ----------
    if (u.pathname === '/af/register' || u.pathname === '/af/login') {
      const rawBody = await readJsonBody(req, 1024);
      const body = RegisterBody.safeParse(rawBody);
      if (!body.success) { text(res, 400, 'bad json'); return; }
      const uname = String(body.data.username || '').trim();
      const pw = String(body.data.password || '');
      if (!/^[\w\u4e00-\u9fa5-]{2,16}$/.test(uname) || pw.length < 4) { text(res, 400, 'bad account'); return; }
      if (u.pathname === '/af/register') {
        // 上线锁房门（WP3）：AF_REGISTER_INVITE 邀请码 + AF_MAX_PLAYERS 玩家上限
        const invite = process.env.AF_REGISTER_INVITE;
        if (invite) {
          const given = String((rawBody as Record<string, unknown>).invite ?? (rawBody as Record<string, unknown>)._afInvite ?? '');
          if (given !== invite) { text(res, 403, '需要邀请码'); return; }
        }
        const cap = Number(process.env.AF_MAX_PLAYERS || 0);
        if (cap > 0 && Object.keys(app.accounts.accounts).length >= cap) { text(res, 429, '玩家已满'); return; }
        const r = app.accounts.register(uname, pw);
        if (!r.ok) {
          if (r.msg === 'exists') { text(res, 409, 'exists'); return; }
          text(res, 429, 'too many, slow down'); return;
        }
        const a = r.account!;
        app.state.ensurePlayerData(a.uid); // 分配主角档 + 宅基地
        console.log(`[account] 注册 ${uname} -> ${a.uid}`);
        json(res, 200, { ok: true, token: a.token, uid: a.uid, nick: uname });
      } else {
        const r = app.accounts.login(uname, pw);
        if (!r.ok) { text(res, 401, 'bad login'); return; }
        const a = r.account!;
        console.log(`[account] 登录 ${uname} -> ${a.uid}`);
        json(res, 200, { ok: true, token: a.token, uid: a.uid, nick: a.nick || uname });
      }
      return;
    }

    if (u.pathname === '/af/me') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      json(res, 200, { ok: true, uid: a.uid, nick: a.nick, username: app.accounts.usernameOf(a) });
      return;
    }

    // 模型配置（房主/玩家配置 Agent 大脑 LLM；key 不回显）
    if (u.pathname === '/af/agent-provider') {
      if (req.method === 'POST') {
        const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
        if (!a) { json(res, 401, { ok: false, msg: '登录状态已失效，请刷新页面重新登录' }); return; }
        const raw = await readJsonBody(req, 4096);
        const body = AgentProviderBody.safeParse(raw);
        if (!body.success) { json(res, 400, { ok: false, msg: '请求格式不对（需要 url / model / key 三个字段）' }); return; }
        const url = String(body.data.url || '').trim();
        const model = String(body.data.model || '').trim() || 'deepseek-v4-flash';
        const key = body.data.key && String(body.data.key).trim() ? String(body.data.key).trim()
          : (loadJson<{ key?: string }>(PROVIDER_FILE, {}).key || '');
        const next = { url, model, key };
        // 探通记录：只有「测试连接」成功过才算验证通过。改地址/改模型后旧记录立即失效，
        // 否则玩家改完配置仍看到"已验证"，托管失败时反而找不到原因。
        const prevFile = loadJson<{ url?: string; model?: string; verifiedAt?: number }>(PROVIDER_FILE, {});
        const carriedVerifiedAt = prevFile.url === next.url && prevFile.model === next.model
          && Number.isFinite(prevFile.verifiedAt) ? prevFile.verifiedAt : undefined;
        // 校验 + 落盘统一走一处，保证 test 模式与普通模式对 url 的判定完全一致
        const save = (verifiedAt?: number) => {
          const rec = { url: next.url, model: next.model, key: next.key, ...(verifiedAt ? { verifiedAt } : {}) };
          app.provider = resolveProvider({}, rec); // 以文件配置为准
          fs.mkdirSync(path.dirname(PROVIDER_FILE), { recursive: true });
          fs.writeFileSync(PROVIDER_FILE, JSON.stringify(rec, null, 1));
          console.log(`[provider] ${a.nick || a.uid} 更新模型配置: ${next.url} / ${next.model}${verifiedAt ? '（已验证）' : ''}`);
        };
        // test=1（接入引导的「测试连接」）：先探活，探通才落盘，失败不回写坏配置
        if ((raw as { test?: unknown }).test === true) {
          const p = await probeProvider(next.url, next.key, next.model);
          if (p.ok) save(Date.now());
          json(res, 200, { ok: p.ok, saved: p.ok, msg: p.msg, detail: p.detail || '', latencyMs: p.latencyMs ?? null });
          return;
        }
        if (!/^https?:\/\//.test(url)) { json(res, 400, { ok: false, msg: 'API 地址需以 http(s):// 开头', detail: `收到：${url || '(空)'}` }); return; }
        save(carriedVerifiedAt);
        json(res, 200, { ok: true, saved: true, msg: `模型已配置：${next.url} / ${next.model}` });
        return;
      }
      json(res, 200, { ok: true, url: app.provider.url || '', model: app.provider.model || 'deepseek-v4-flash', keySet: !!(app.provider.key || '').length });
      return;
    }

    // ---------- 登录接入引导：一次往返给全客户端需要的接入状态 ----------
    // 玩家进游戏只看到「Agent 未连接」而无处可接：这里把"能不能接、还差什么、下一步做什么"
    // 一次说清，客户端引导层直接照此渲染，不用猜。
    if (u.pathname === '/af/onboarding') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const pk = readLlmKey(app.db, a.uid);
      const s = app.agentSockets.get(a.uid);
      const online = !!(s && s.size);
      const providerReady = !!(app.provider.url && app.provider.key);
      // 探通过 ≠ 配齐了：接入引导要区分「已配置未验证」和「已验证」，
      // 否则坏 Key 也会被当成"模型就绪"，玩家点启动托管后才炸在看不见的地方。
      const providerVerifiedAt = Number(
        loadJson<{ verifiedAt?: number }>(PROVIDER_FILE, {}).verifiedAt || 0,
      );
      const providerVerified = providerReady && providerVerifiedAt > 0;
      const playerKeyReady = keyvaultAvailable() && !!pk?.hasCipher;
      // 还差什么：按玩家能自己做的顺序给出唯一阻塞项
      const missing: string[] = [];
      if (!providerReady && !playerKeyReady) missing.push('model');   // 既没服务端模型，也没自带 Key
      if (!a.agentToken) missing.push('token');                      // 托管会自动铸造，仅提示
      json(res, 200, {
        ok: true,
        nick: a.nick || null,
        uid: a.uid,
        agentOnline: online,
        agentTokenSet: !!a.agentToken,
        providerReady, providerUrl: app.provider.url || '', providerModel: app.provider.model || '',
        providerVerified, providerVerifiedAt: providerVerifiedAt || null,
        playerKeySet: playerKeyReady, playerKeyUrl: pk?.baseUrl || '', playerKeyModel: pk?.model || '',
        keyvault: keyvaultAvailable(),
        managedRunning: app.managed.isRunning(a.uid),
        // 可托管 = 任一可用模型来源就绪
        canHost: providerReady || playerKeyReady,
        missing,
        // 引导层下一步指引
        nextStep: online ? 'none' : (!providerReady && !playerKeyReady ? 'config-model' : 'start-hosting'),
      });
      return;
    }

    // ---------- 玩家自带 LLM Key（M7：AES-256-GCM 保管；key 永不回显） ----------
    if (u.pathname === '/af/llm-key') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      if (req.method === 'POST') {
        if (!keyvaultAvailable()) {
          json(res, 503, { ok: false, msg: '服务端未配置密钥保管（AF_AES_KEY）；暂时以全局 provider 运行' });
          return;
        }
        const raw = await readJsonBody(req, 8192);
        const b = raw || {};
        const baseUrl = String(b.base_url || b.baseUrl || '').trim();
        if (!/^https?:\/\//.test(baseUrl)) { json(res, 400, { ok: false, msg: 'base_url 需以 http(s):// 开头' }); return; }
        const model = String(b.model || '').trim() || 'deepseek-chat';
        const apiKey = b.api_key !== undefined || b.apiKey !== undefined ? String(b.api_key ?? b.apiKey ?? '').trim() : '';
        const tierMapRaw = (b.tier_map && typeof b.tier_map === 'object') ? b.tier_map : b.tierMap;
        const tierMap: Record<string, string> | null = (tierMapRaw && typeof tierMapRaw === 'object') ? (tierMapRaw as Record<string, string>) : null;
        const priceHintCpm = b.price_hint_cpm !== undefined ? Number(b.price_hint_cpm) : null;
        // 已有保管且本次未带新 key：仅更新 url/model/tierMap，密文保留
        const existing = readLlmKey(app.db, a.uid);
        const r = upsertLlmKey(app.db, {
          accountUid: a.uid, baseUrl, model,
          tierMap: tierMap || existing?.tierMap || undefined,
          priceHintCpm: priceHintCpm ?? existing?.priceHintCpm ?? null,
        }, apiKey || undefined);
        if (r === 'no-cipher') { json(res, 503, { ok: false, msg: '密钥保管不可用' }); return; }
        log.write('info', 'llm-key', '玩家更新自带 Key', { uid: a.uid, url: baseUrl, model, hasKey: !!apiKey });
        json(res, 200, { ok: true, url: baseUrl, model, keySet: true, msg: apiKey ? '已更新（含新 Key，已加密保管）' : '已更新（沿用已保管 Key）' });
        return;
      }
      // GET：脱敏返回（key 不回显）
      const v = readLlmKey(app.db, a.uid);
      json(res, 200, {
        ok: true,
        available: keyvaultAvailable(),
        set: !!v,
        url: v?.baseUrl || '', model: v?.model || '',
        tierMap: v?.tierMap || null, priceHintCpm: v?.priceHintCpm ?? null,
        keySet: v?.hasCipher || false,
      });
      return;
    }

    // 玩家 LLM 用量面板数据（M7：按其自报单价折算参考成本）
    if (u.pathname === '/af/llm-usage') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const since = Number(u.searchParams.get('since') || 0);
      json(res, 200, { ok: true, usage: usageSummary(app.db, a.uid, since) });
      return;
    }

    // 生成 agent 接入码（需要玩家 token）
    if (u.pathname === '/af/agent-token' && req.method === 'POST') {
      const raw = await readJsonBody(req, 1024);
      const b = raw || {};
      const a = app.accounts.findAccountByToken(String(b.token || u.searchParams.get('token') || ''));
      if (!a) { text(res, 401, 'bad token'); return; }
      if (!a.agentToken) { a.agentToken = AccountStore.genToken(); app.accounts.save(); }
      json(res, 200, { ok: true, agentToken: a.agentToken, ws: `ws://${req.headers.host}/agent?token=${a.agentToken}` });
      return;
    }

    // 托管 agent 启停
    if (u.pathname === '/af/agent-control' && req.method === 'POST') {
      const raw = await readJsonBody(req, 1024);
      const b = AgentControlBody.safeParse(raw || {});
      const a = app.accounts.findAccountByToken(String((raw || {}).token || ''));
      if (!a) { json(res, 401, { ok: false, msg: 'bad token' }); return; }
      const result = b.success && b.data.action === 'start' ? app.managed.start(a)
        : b.success && b.data.action === 'stop' ? app.managed.stop(a.uid)
        : { ok: false, msg: 'action 必须是 start 或 stop' };
      json(res, 200, result);
      return;
    }

    // 存档位列表 API（主界面用）
    if (u.pathname === '/af/saves') {
      const saves: unknown[] = [];
      for (let i = 1; i <= 3; i++) {
        const p = slotPaths(SAVES_DIR, i);
        const meta = loadJson<{ name?: string; createdAt?: number; lastPlayed?: number }>(p.metaFile, {});
        const exists = fs.existsSync(p.saveFile);
        let playerCount = 0;
        if (exists) {
          const wd = loadJson<{ datas?: Array<{ key: string }> } | null>(p.saveFile, null);
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
      json(res, 200, { ok: true, currentSlot: app.state.currentSlot, saves });
      return;
    }

    // 设置存档名
    if (u.pathname === '/af/saves/rename' && req.method === 'POST') {
      const raw = await readJsonBody(req, 1024);
      const b = RenameSlotBody.safeParse(raw || {});
      const a = app.accounts.findAccountByToken(String((raw || {}).token || ''));
      if (!a) { json(res, 401, { ok: false, msg: 'bad token' }); return; }
      const slot = b.success && b.data.slot ? Number(b.data.slot) : app.state.currentSlot;
      const p = slotPaths(SAVES_DIR, slot);
      const meta = loadJson<{ name?: string; createdAt?: number }>(p.metaFile, {});
      meta.name = String((b.success ? b.data.name : '') || `存档${slot}`).slice(0, 20);
      meta.createdAt = meta.createdAt || Date.now();
      fs.mkdirSync(p.slotDir, { recursive: true });
      fs.writeFileSync(p.metaFile, JSON.stringify(meta, null, 1));
      json(res, 200, { ok: true });
      return;
    }

    // 切换存档位 API（房主选存档时调用）
    if (u.pathname === '/af/switch-slot' && req.method === 'POST') {
      const raw = await readJsonBody(req, 1024);
      const b = SwitchSlotBody.safeParse(raw || {});
      const a = app.accounts.findAccountByToken(String((raw || {}).token || ''));
      if (!a) { json(res, 401, { ok: false, msg: 'bad token' }); return; }
      const newSlot = b.success ? Number(b.data.slot) : 0;
      if (newSlot < 1 || newSlot > 3) { json(res, 400, { ok: false, msg: 'slot must be 1-3' }); return; }
      if (newSlot === app.state.currentSlot) { json(res, 200, { ok: true, msg: 'already on slot ' + newSlot }); return; }
      app.state.persist();
      console.log(`[slot] 切换存档: ${app.state.currentSlot} -> ${newSlot}`);
      // 踢掉所有在线玩家连接，强制重连（重连时按新档重新 join）
      for (const [, p] of app.state.online) {
        try { p.ws.send(JSON.stringify({ t: 'kicked', msg: '存档切换中，请刷新页面重新进入' })); } catch { /* ignore */ }
        const ws = p.ws;
        setTimeout(() => { try { ws.terminate(); } catch { /* ignore */ } }, 300);
      }
      app.state.online.clear();
      // 新 state 自带干净的 agentPos/agentMoves（slot 级），agent 连接保留在新 state 上继续服务
      app.switchSlot(newSlot);
      console.log(`[slot] 已切换到存档${newSlot}，世界数据已重载`);
      json(res, 200, { ok: true, slot: newSlot });
      return;
    }

    // 回放一致性探针（A1/M-O1 第九门消费端）：上次启动自检结论
    if (u.pathname === '/af/replay-status') {
      json(res, 200, {
        ok: true,
        consistent: app.replayVerify.consistent,
        events: app.replayVerify.events,
        ts: app.replayVerify.ts,
        // 哈希前缀只用于人工对比，非敏感
        replayHash: app.replayVerify.replayHash,
        liveHash: app.replayVerify.liveHash,
        // E 包：广播队列深度 + 内存曲线尾部
        broadcastQueue: app.state.broadcastQueueDepth(),
        memTail: app.memSamples.slice(-20),
      });
      return;
    }

    // 全村文本地图（H 包/R9 设计铁律）：数据自动生成，纯文本 LLM 自规划路线
    if (u.pathname === '/af/mapdoc') {
      try {
        const nav = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'nav/nav-2.json'), 'utf8'));
        const { buildMapDoc } = await import('../world/mapdoc.ts');
        const doc = buildMapDoc({ dataDir: app.dataDir, sceneWidth: nav.width ?? 189, sceneHeight: nav.height ?? 173, cellPx: 100 });
        json(res, 200, { ok: true, mapdoc: doc.text, stats: { blocked: doc.blockedClusters.length, water: doc.waterClusters.length, roads: doc.roadCount } });
      } catch (e) {
        json(res, 500, { ok: false, msg: `mapdoc 生成失败：${String((e as Error).message)}` });
      }
      return;
    }

    // 公告通道（H 包）：/af/notices?since=<seq>
    if (u.pathname === '/af/notices') {
      const { noticesSince, lastNoticeSeq } = await import('../world/notices.ts');
      const since = Number(new URLSearchParams(u.search).get('since') || 0);
      json(res, 200, { ok: true, since, lastSeq: lastNoticeSeq(app.state), notices: noticesSince(app.state, since).slice(-50) });
      return;
    }

    // 房间码 API：当前房间码与穿透地址
    if (u.pathname === '/af/room') {
      const fwdProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
      const proto = (fwdProto === 'https' || fwdProto === 'http') ? fwdProto : ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
      const host = req.headers.host || `127.0.0.1:${process.env.PORT || 8080}`;
      json(res, 200, {
        ok: true,
        roomCode: app.roomCode,
        tunnelUrl: app.tunnelUrl || null,
        localUrl: `${proto}://${host}`,
      });
      return;
    }

    // 输入房间码加入房间：解析 6 位码得到服务器地址
    if (u.pathname === '/af/join-room' && req.method === 'POST') {
      const raw = await readJsonBody(req, 512);
      const b = JoinRoomBody.safeParse(raw || {});
      const code = String(b.success ? b.data.code : (raw || {}).code || '').trim();
      if (code.length !== 6) { json(res, 400, { ok: false, msg: '房间码为6位数字' }); return; }
      const url = app.roomCodes.get(code);
      if (!url) { json(res, 404, { ok: false, msg: '房间码无效或已过期' }); return; }
      json(res, 200, { ok: true, url });
      return;
    }

    // Dev: 给玩家加金币（测试用）
    if (u.pathname === '/af/dev/give-coins' && req.method === 'POST') {
      const raw = await readJsonBody(req, 1024);
      const b = GiveCoinsBody.safeParse(raw || {});
      const a = app.accounts.findAccountByToken(String((raw || {}).token || ''));
      if (!a) { json(res, 401, { ok: false, msg: 'bad token' }); return; }
      const pm = app.state.playersDb.get(a.uid);
      if (!pm) { json(res, 404, { ok: false, msg: 'no player data' }); return; }
      const kn = (pm.get('knapData') as { props?: Array<{ id: number; num?: number }> } | undefined) || { props: [] };
      kn.props = kn.props || [];
      const coinsProp = kn.props.find(p => p.id === 1);
      const add = (b.success ? Number(b.data.amount) : Number((raw || {}).amount)) || 5000;
      if (coinsProp) coinsProp.num = (coinsProp.num || 0) + add;
      else kn.props.push({ id: 1, num: add });
      pm.set('knapData', kn);
      app.state.persist();
      json(res, 200, { ok: true, coins: coinsProp ? coinsProp.num : add });
      return;
    }

    // Dev: 给玩家加物品（测试用；P2P 交易需可卖库存）
    if (u.pathname === '/af/dev/give-item' && req.method === 'POST') {
      const raw = await readJsonBody(req, 1024);
      const b = GiveItemBody.safeParse(raw || {});
      const a = app.accounts.findAccountByToken(String((raw || {}).token || ''));
      if (!a) { json(res, 401, { ok: false, msg: 'bad token' }); return; }
      const pm = app.state.playersDb.get(a.uid);
      if (!pm) { json(res, 404, { ok: false, msg: 'no player data' }); return; }
      const itemId = (b.success ? b.data.itemId : Number((raw || {}).itemId)) || 1;
      const add = (b.success ? b.data.amount : Number((raw || {}).amount)) || 10;
      const kn = (pm.get('knapData') as { props?: Array<{ id: number; num?: number }> } | undefined) || { props: [] };
      kn.props = kn.props || [];
      const prop = kn.props.find(p => p.id === itemId);
      if (prop) prop.num = (prop.num || 0) + add;
      else kn.props.push({ id: itemId, num: add });
      pm.set('knapData', kn);
      app.state.persist();
      json(res, 200, { ok: true, itemId, num: prop ? prop.num : add });
      return;
    }

    // 权威存档（客户端拉取；按 uid 重组 key）
    if (u.pathname === '/af/save') {
      const uid = u.searchParams.get('uid');
      const tok = u.searchParams.get('token');
      const a = app.accounts.findAccountByToken(tok);
      if (!uid || !a || a.uid !== uid) { text(res, 401, 'bad token'); return; }
      const datas: Array<{ key: string; val: unknown }> = [];
      for (const [name, val] of app.state.world) {
        // 防御：跳过曾被复合污染的世界 key（storage_uXXX 类）
        if (/_[a-z][0-9a-f]{6,}/i.test(name)) continue;
        datas.push({ key: `${name}_${uid}`, val });
      }
      for (const [name, val] of app.state.globals) datas.push({ key: name, val });
      const pm = app.state.ensurePlayerData(uid);
      for (const [name, val] of pm) datas.push({ key: `${name}_${uid}`, val });
      json(res, 200, { version: 4, datas, _af: { spawns: app.tables.spawns } });
      return;
    }

    // agent 性格设定：按预设/自定义生成 agent.md
    if (u.pathname === '/af/agent-setup' && req.method === 'POST') {
      const raw = await readJsonBody(req, 4096);
      const b = AgentSetupBody.safeParse(raw || {});
      const a = app.accounts.findAccountByToken(String((raw || {}).token || u.searchParams.get('token') || ''));
      if (!a) { text(res, 401, 'bad token'); return; }
      const username = app.accounts.usernameOf(a);
      const d = app.notes.agentSetup(username, b.success ? b.data : {});
      json(res, 200, { ok: true, username, name: d.name, personality: d.personality });
      return;
    }

    // 在线玩家列表
    if (u.pathname === '/af/players') {
      json(res, 200, Array.from(app.state.online.values()).map(p => ({ uid: p.uid, nick: p.nick, scene: p.scene, x: p.x, y: p.y })));
      return;
    }

    // Agent 托管状态（玩家轮询兜底）
    if (u.pathname === '/af/agent-status') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const s = app.agentSockets.get(a.uid);
      json(res, 200, { online: !!(s && s.size), nick: a.nick || null });
      return;
    }

    // 地图网格（mod 生成扩展版小地图用）；L2 市政图层：roads/landmarks/signs（roads-landmarks 规划书 §4）
    if (u.pathname === '/af/mapgrid') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const mu = municipalOf(app);
      const villageRoads = (mu.roads.get(2) || []).map(r => ({ id: r.id, name: r.name, width: r.width, line: r.line }));
      const g = app.tables.farm ? {
        W: app.tables.farm.waterW, H: app.tables.farm.waterH,
        water: app.tables.farm.water,
        blocked: app.tables.collision ? app.tables.collision.blocked : null,
        houses: ((app.tables.spawns && app.tables.spawns.houses) || []).map(h => ({ x: h.rect.x, y: h.rect.y, w: h.rect.w, h: h.rect.h, type: h.type })),
        LEFT: app.tables.farm.LEFT, TOP: app.tables.farm.TOP, origW: 77, origH: 61,
        roads: villageRoads,
        landmarks: mu.landmarks.get(2) || [],
        signs: mu.signs.filter(s => s.scene === 2),
        decor: mu.decor.get(2) || [],
        buildings: mu.buildings.get(2) || [],
      } : null;
      json(res, 200, g);
      return;
    }

    // P2 邮局：收件箱只读快照（拉取/清空走 agent {t:'inbox'} 通道，本端点不消费）
    if (u.pathname === '/af/letter') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const { arr } = app.notes.inboxOf(app.accounts.usernameOf(a));
      json(res, 200, { unread: arr.length, inbox: arr.slice(-10).map(e => ({ from: e.from, text: e.text, at: e.at })) });
      return;
    }

    // P2 建筑（buildings.json）：按场景取（客户端招牌反射 + 小地图；mtime 缓存走 municipalOf）
    if (u.pathname === '/af/buildings') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const scene = Number(u.searchParams.get('scene')) || 2;
      const mu = municipalOf(app);
      json(res, 200, { scene, buildings: mu.buildings.get(scene) || [] });
      return;
    }

    // agent 日记（只读）
    if (u.pathname === '/af/diary') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const username = app.accounts.usernameOf(a);
      json(res, 200, app.notes.diaryOf(username));
      return;
    }

    // A9 画报日报骨架：事件聚合（纯函数，确定性）；LLM 文案/生图插画待 M4/M7
    if (u.pathname === '/af/daily-report') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const limit = Number(u.searchParams.get('limit') || 500);
      const maxHighlights = Number(u.searchParams.get('highlights') || 20);
      const snap = app.log.lastSnapshot();
      const recent = snap ? app.log.since(snap.seq) : [];
      json(res, 200, { ok: true, ...buildDailyReport(recent, { limit, maxHighlights }) });
      return;
    }

    // M1.4 确定性回放：快照 + 事件 -> 镜头时间线 + 终点状态哈希（只读）
    if (u.pathname === '/af/replay') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const watch = u.searchParams.get('watch') || 'events';
      const events = Number(u.searchParams.get('events') || 200);
      const verify = u.searchParams.get('verify') === '1';
      const r = app.narrative.replay({ watch, events });
      json(res, 200, {
        ok: true, ...r,
        ...(verify ? { deterministic: verifyReplayDeterminism(app, { watch, events }).deterministic } : {}),
      });
      return;
    }

    // B1.2 CDA 市场：订单簿快照 + 7 日 OHLC + 最近成交（只读；空簿自动冷启动做市单）
    const mktMatch = u.pathname.match(/^\/af\/market\/(\d+)$/);
    if (mktMatch) {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const item = Number(mktMatch[1]);
      const days = Number(u.searchParams.get('days') || 7);
      const v = app.market.marketView(item, days);
      json(res, 200, { ok: true, item, basePrice: app.market.basePrice(item), ...v });
      return;
    }

    // B3 货币治理：货币总量 + 通胀指数 + 回收档位（只读）
    if (u.pathname === '/af/economy') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      json(res, 200, { ok: true, ...economyReport(app) });
      return;
    }

    // B4 影子模式：实盘 vs 影子 14 日对比报告（M-B1 验收依据；只读）
    if (u.pathname === '/af/shadow') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const days = Number(u.searchParams.get('days') || 14);
      json(res, 200, { ok: true, days, items: app.shadow.report(days) });
      return;
    }

    // C8 美术资产：manifest + 按 id 交付 PNG（mod 注入新视觉；与原版外壳静态资源同类，公开只读）
    if (u.pathname === '/af/art-manifest') {
      const mp = path.join(app.dataDir, 'art', 'manifest.json');
      if (!fs.existsSync(mp)) { json(res, 404, { ok: false, manifest: null }); return; }
      json(res, 200, { ok: true, manifest: JSON.parse(fs.readFileSync(mp, 'utf8')) });
      return;
    }
    const artM = /^\/af\/art\/(\d+)(?:\.png)?$/i.exec(u.pathname);
    if (artM) {
      const mp = path.join(app.dataDir, 'art', 'manifest.json');
      const manifest = fs.existsSync(mp) ? (JSON.parse(fs.readFileSync(mp, 'utf8')) as { queue?: Array<{ id: number; name?: string; status?: string; substitute?: { ref?: string } }> }) : null;
      const item = manifest?.queue?.find(q => q.id === Number(artM[1]));
      if (!item) { text(res, 404, 'no such asset'); return; }
      // done -> 量化产物（artRoot）；cc0-substitute -> 仓库内 CC0 源文件（repoRoot 相对 ref）
      const base = item.status === 'done' ? path.resolve(app.artRoot) : path.resolve(app.repoRoot);
      const rel = item.status === 'done' ? `${item.id}-${item.name}.png` : (item.substitute?.ref ?? '');
      if (!rel) { text(res, 404, 'asset not generated'); return; }
      const file = path.resolve(base, rel);
      if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) { text(res, 404, 'asset file missing'); return; }
      const buf = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Content-Length': buf.length });
      res.end(buf);
      return;
    }

    // B8 历法/天气：当日 + 未来 n 日日程（公开只读；客户端天气/节日视觉通道 + F4 验收）
    if (u.pathname === '/af/calendar') {
      const today = currentGameDay(app.state);
      const n = Math.max(1, Math.min(14, Number(u.searchParams.get('n') || 7)));
      // M4 氛围注入：hour 供客户端昼夜 tint/BGM 驱动（additive 字段，协议向后兼容）
      const { hour } = gameHourOf(app.state);
      json(res, 200, { ok: true, today, hour, days: Array.from({ length: n }, (_, i) => calendarDay(today + i)) });
      return;
    }

    // B9 畜牧：全服动物清单（公开只读；mod 动物面板渲染数据）
    if (u.pathname === '/af/animals') {
      const out = worldAnimals(app.state).map(a => {
        const def = ANIMALS[a.animalId];
        return {
          uId: a.uId, animalId: a.animalId, name: def?.name || '动物' + a.animalId,
          owner: a.owner, x: a.x, y: a.y,
          stage: a.growDay !== undefined && def ? (a.growDay >= def.growDays ? '成年' : '幼崽') : '未知',
          satiety: a.satiety ?? null, mood: a.mood ?? null,
        };
      });
      json(res, 200, { ok: true, count: out.length, animals: out });
      return;
    }

    // B7 NPC 日程：当前游戏时刻 + 全部 NPC 决策快照（公开只读；快时钟下 hour 恒定时段，
    // 换位广播只在决策变化时发生——本端点是确定性的机制验收 + mod 面板数据源）
    if (u.pathname === '/af/npc-schedule') {
      const { day, hour } = gameHourOf(app.state);
      const cal = calendarDay(day);
      const pois = villagePois(app);
      const npcs = app.tables.npcs.map(npc => {
        const d = npcDecision(npc, { day, hour, weather: cal.weather, festival: cal.festival }, pois);
        return { id: npc.id, name: npc.name, activity: d.activity, x: d.x, y: d.y, scene: d.scene };
      });
      json(res, 200, { ok: true, day, hour, weather: cal.weather, festival: cal.festival, npcs });
      return;
    }
    // B10 庭院评比：纯读排行（无 decor.contest 副作用；mod 庭院榜渲染数据）
    if (u.pathname === '/af/decor-board') {
      const a = app.accounts.findAccountByToken(u.searchParams.get('token'));
      if (!a) { text(res, 401, 'bad token'); return; }
      const rank = courtyardRanking(app.state, app.tables, uid => app.accounts.findAccountByUid(uid)?.nick || uid);
      json(res, 200, { ok: true, top: rank.slice(0, 10) });
      return;
    }

    // ---------- 管理后台（设计 M6.5）：结构化日志 + 内存指标 + 事件审计 + 备份触发 ----------
    // 鉴权：优先 AF_ADMIN_TOKEN；未配置时"房主"= 首个注册账号（单主机零现金部署）
    if (u.pathname.startsWith('/admin')) {
      const adminOk = (): boolean => {
        const adminTok = process.env.AF_ADMIN_TOKEN;
        const tok = u.searchParams.get('token');
        if (adminTok) return tok === adminTok;
        const keys = Object.keys(app.accounts.accounts);
        if (!keys.length) return false;
        const host = app.accounts.accounts[keys[0]];
        return !!tok && !!(host.token === tok || (host.agentToken && host.agentToken === tok));
      };
      if (!adminOk()) { text(res, 401, 'admin auth required'); return; }

      if (u.pathname === '/admin' || u.pathname === '/admin/') {
        const token = u.searchParams.get('token') || '';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderAdminPage(token));
        return;
      }
      if (u.pathname === '/admin/api/stats') {
        json(res, 200, {
          online: Array.from(app.state.online.values()).map(p => ({ uid: p.uid, nick: p.nick, scene: p.scene })),
          agentConnections: [...app.agentSockets.keys()],
          slot: app.state.currentSlot,
          events: { total: app.log.totalEvents(), lastSeq: app.log.lastEventSeq, snapshots: app.log.totalSnapshots() },
          memory: log.snapshot(0).memory,
          llmProvider: { url: app.provider.url, model: app.provider.model, keySet: !!app.provider.key },
        });
        return;
      }
      if (u.pathname === '/admin/api/logs') {
        const n = Math.min(500, Number(u.searchParams.get('n') || 100));
        json(res, 200, { entries: log.snapshot(n).entries });
        return;
      }
      if (u.pathname === '/admin/api/events') {
        const since = Number(u.searchParams.get('since') || 0);
        const limit = Math.min(500, Number(u.searchParams.get('limit') || 100));
        json(res, 200, { events: app.log.since(since, limit).map(e => ({ seq: e.seq, ts: e.ts, type: e.type, actor: e.actor, seed: e.seed, payload: e.payload })) });
        return;
      }
      if (u.pathname === '/admin/api/backup' && req.method === 'POST') {
        const r = runLocalBackup(app.dataDir, SAVES_DIR, app.state.currentSlot, app.db);
        log.write('info', 'admin', '手动触发本地备份', { slot: app.state.currentSlot, files: r.files });
        json(res, 200, { ok: true, dir: r.dir, files: r.files });
        return;
      }
      text(res, 404, 'admin not found');
      return;
    }

    serveStatic(app, req, res);
  };
}

// 管理后台页面（自包含；token 走 URL 查询参数，仅单主机可信网络内使用）
function renderAdminPage(token: string): string {
  const t = encodeURIComponent(token);
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>AgentFarm2 管理后台</title>
<style>
 body{font:14px/1.5 monospace;background:#111;color:#ddd;margin:0}
 header{background:#1c1c1c;padding:10px 14px;display:flex;gap:10px;align-items:center;position:sticky;top:0}
 main{padding:14px;display:grid;gap:14px}
 .card{background:#191919;border:1px solid #333;border-radius:8px;padding:12px}
 .card h2{margin:0 0 8px;font-size:15px;color:#8be9fd}
 pre{white-space:pre-wrap;word-break:break-all;max-height:320px;overflow:auto;margin:0}
 button{background:#44475e;color:#f1fa8c;border:0;border-radius:4px;padding:6px 12px;cursor:pointer;font:inherit}
 button:active{transform:translateY(1px)}
 .muted{color:#777}
</style></head><body>
<header><strong>AgentFarm2 管理后台</strong>
 <button onclick="refresh()">刷新</button>
 <button onclick="backup()">立即备份</button>
 <button onclick="openEvents()">事件流</button>
 <span class="muted" id="stamp"></span></header>
<main>
 <div class="card"><h2>运行状态</h2><pre id="stats">…</pre></div>
 <div class="card"><h2>结构化日志（环形缓冲）</h2><pre id="logs">…</pre></div>
 <div class="card"><h2>事件流（最近 100）</h2><pre id="events" class="muted">点击"事件流"加载</pre></div>
</main>
<script>
const T='${t}';
const api=p=>fetch('/admin/api/'+p+(p.includes('?')?'&':'?')+'token='+T).then(r=>r.json().catch(()=>({})));
function refresh(){
 api('stats').then(j=>{document.getElementById('stats').textContent=JSON.stringify(j,null,1);document.getElementById('stamp').textContent='updated '+new Date().toLocaleTimeString();});
 api('logs?n=100').then(j=>{document.getElementById('logs').textContent=(j.entries||[]).map(e=>new Date(e.ts).toLocaleTimeString()+' ['+e.level+'] '+e.module+' '+e.msg+' '+(JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k])=>!['ts','level','module','msg','__msg'].includes(k))))||'')).join('\\n');});
}
async function backup(){const r=await fetch('/admin/api/backup?token='+T,{method:'POST'}).then(x=>x.json());alert(JSON.stringify(r));}
function openEvents(){api('events?limit=100').then(j=>{document.getElementById('events').classList.remove('muted');document.getElementById('events').textContent=(j.events||[]).map(e=>e.seq+' '+new Date(e.ts).toLocaleTimeString()+' '+e.type+' '+(e.actor||'')+' '+(e.seed??'')+' '+JSON.stringify(e.payload)).join('\\n');});}
refresh();setInterval(refresh,10000);
</script></body></html>`;
}
