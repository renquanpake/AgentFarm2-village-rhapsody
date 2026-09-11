// ============================================================
// AgentFarm2 注入层 v0.1 —— 原版外壳联机
// 原理：原版所有存档读写都走 localStorage（StorageUtil 已确认），
//       本脚本在游戏 boot 前包装 localStorage，把存档层换成网络层：
//       - 启动时同步拉取服务器权威存档 → 写入 localStorage（原版无感继续游戏）
//       - setItem 时本地写入 + 防抖推送到服务器（服务器按桶合并：世界共享/玩家私有）
//       - key 翻译：客户端固定用原版自己的后缀（如 _100001），
//         服务器侧用本玩家唯一 uid 后缀（如 _u1234）隔离玩家私有数据
//       - 聊天：轻量 HTML overlay
// ============================================================
(function () {
  if (window.__AF_MOD__) return;
  window.__AF_MOD__ = true;

  const HOST = location.hostname || '127.0.0.1';
  // 房间模式：服务器地址可在登录界面配置（默认跟随页面域名）。
  // 静态资源可来自任意来源（本地启动器/房主），API+WS 连这里填的房间服务器。
  let SERVER = window.__AF_SERVER__ || (typeof localStorage !== 'undefined' && localStorage.getItem('af_server')) || ('http://' + HOST + ':8080');
  SERVER = SERVER.replace(/\/+$/, '');
  const WS_URL = window.__AF_WS__ || (SERVER.replace(/^http/, 'ws') + '/ws');
  const CLIENT_SUFFIX = '100001'; // 原版浏览器 fallback 使用的 key 后缀（uid 10000 + "1"）

  // ---------- 账号登录（一个账号 = 一个角色/存档，无 token 则先登录） ----------
  const LS = window.localStorage;
  let uid = LS.getItem('af_uid') || '';
  let nick = LS.getItem('af_nick') || '';
  let token = LS.getItem('af_token') || '';
  let bootReady = false; // 登录成功且存档就绪后置 true

  // 同步拉取权威存档（登录后调用；boot 前必须完成）
  function loadWorldFromServer() {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', SERVER + '/af/save?uid=' + encodeURIComponent(uid) + '&token=' + encodeURIComponent(token), false);
      xhr.send();
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        // 宅基地表（服务器下发）：新房子碰撞注入用
        if (data._af && data._af.spawns) window.__AF_SPAWNS__ = data._af.spawns;
        const datas = [];
        for (const d of (data.datas || [])) {
          const sk = serverKey(d.key);
          const ck = clientKey(d.key);
          const v = typeof d.val === 'string' ? d.val : JSON.stringify(d.val);
          serverCache.set(sk, v);
          datas.push({ key: ck, val: d.val }); // 翻译成客户端 key
        }
        // 关键：原版 Web 模式读档只认 localStorage['villagedb_10000'] 单 key（WebApi.loadStorageData）
        // 浏览器模式 uid 固定 1e4 -> storageFileName='villagedb_10000'
        // ★ 先写主档（必须成功）；per-key 镜像有配额风险（世界档含 picData 等转义后可达数 MB），尽力而为
        LS.setItem('villagedb_10000', JSON.stringify({ version: 4, datas }));
        try {
          for (const d of (data.datas || [])) {
            const ck = clientKey(d.key);
            LS.setItem(ck, typeof d.val === 'string' ? d.val : JSON.stringify(d.val));
          }
        } catch (e) {
          console.warn('[AF] 存档镜像部分跳过（存储配额）:', e.name);
        }
        syncReady = true;
        console.log('[AF] 权威存档已同步:', datas.length, '条');
        return true;
      }
      console.warn('[AF] 存档拉取失败 status=', xhr.status);
    } catch (e) { console.warn('[AF] 存档拉取异常:', e); }
    return false;
  }

  // 登录成功后：记录身份 → 切换存档位（如有）→ 拉存档 → 放行 boot
  function onLoginOk(res) {
    uid = res.uid; nick = res.nick || res.uid;
    token = res.token;
    LS.setItem('af_uid', uid);
    LS.setItem('af_nick', nick);
    LS.setItem('af_token', token);
    // 房主选了存档位 → 调 switch-slot API 切换服务器存档
    const selSlot = LS.getItem('af_selected_slot');
    if (selSlot) {
      LS.removeItem('af_selected_slot'); // 用一次就清
      fetch(SERVER + '/af/switch-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, slot: Number(selSlot) })
      }).then(() => startGame()).catch(() => startGame());
    } else {
      startGame();
    }
    function startGame() {
      const ok = loadWorldFromServer();
      if (!ok) { showLoginUI('服务器连接失败，请重试'); return; }
      const loginEl = document.getElementById('af-login');
      if (loginEl) loginEl.remove();
      bootReady = true;
      if (window.__AF_ORIG_BOOT__) window.__AF_ORIG_BOOT__();
      startNetwork();
      // 登录成功后立即预热小地图数据，首次打开时直接同步贴图零闪现
      if (token) prewarmVillageMap();
    }
  }

  // 登录界面（联机大厅：选模式 → 选存档/输地址 → 账号登录）
  function showLoginUI(msg) {
    if (document.getElementById('af-login')) return;
    const css = document.createElement('style');
    css.textContent = `
      #af-login { position: fixed; inset: 0; z-index: 200000; display: flex; align-items: center; justify-content: center;
        background: rgba(8,10,14,.88); font: 14px "Microsoft YaHei", sans-serif; }
      #af-login .box { width: 460px; max-width: 92vw; box-sizing: border-box; background: #262c34; border: 1px solid #3a4450;
        border-radius: 12px; padding: 26px 26px; box-shadow: 0 12px 44px rgba(0,0,0,.6); }
      #af-login h2 { margin: 0 0 4px; color: #ffd97a; font-size: 22px; letter-spacing: 1px; }
      #af-login p.sub, #af-login .sub { color: #9aa4b0; margin: 0 0 22px; font-size: 12px; line-height: 1.7; }
      #af-login .back { cursor: pointer; color: #9aa4b0; font-size: 12px; margin: 0 0 14px; display: inline-block; }
      #af-login .back:hover { color: #ffd97a; }
      #af-login input { display: block; width: 100%; box-sizing: border-box; margin-bottom: 10px; padding: 8px 10px;
        background: #1a1f26; color: #eee; border: 1px solid #3a4450; border-radius: 6px; outline: none; font-size: 14px; }
      #af-login .btn { width: 100%; padding: 12px; border: 0; border-radius: 8px; font-size: 15px; cursor: pointer;
        margin-bottom: 12px; box-sizing: border-box; }
      #af-login .btn:active { transform: translateY(1px); }
      #af-login .btn-host { background: linear-gradient(180deg,#ef9a3c,#d97e24); color: #1a1f26; font-weight: bold;
        font-size: 18px; padding: 16px; }
      #af-login .btn-host:hover { background: linear-gradient(180deg,#f7a845,#e48a2c); }
      #af-login .btn-join { background: #3a4450; color: #e8ecf1; font-size: 18px; padding: 16px; }
      #af-login .btn-join:hover { background: #48535f; }
      #af-login .btn-primary { background: #e0a63c; color: #1a1f26; font-weight: bold; }
      #af-login .btn-primary:hover { background: #f0b64c; }
      #af-login .btn-ghost { background: transparent; color: #9aa4b0; border: 1px solid #3a4450; font-size: 14px; }
      #af-login .err { color: #ff7a7a; font-size: 12px; min-height: 16px; margin: 0 0 8px; }
      #af-login .foot-hint { color: #6b7684; font-size: 11px; margin-top: 4px; text-align: center; }
      #af-login .misc { color: #6b7684; font-size: 11px; margin-top: 14px; text-align: center; line-height: 1.7; }
      #af-login .saves { display: flex; flex-direction: column; gap: 10px; }
      #af-login .save { background: #1a1f26; border: 1px solid #3a4450; border-radius: 8px; padding: 12px 14px;
        cursor: pointer; text-align: left; }
      #af-login .save:hover { border-color: #ffd97a; background: #20262e; }
      #af-login .save .sn { color: #ffd97a; font-size: 15px; font-weight: bold; margin-bottom: 4px; }
      #af-login .save .sm { color: #9aa4b0; font-size: 12px; }
      #af-login .save .cur { color: #e0a63c; font-size: 11px; margin-left: 6px; }
      #af-login .save.empty { opacity: .55; cursor: default; }
      #af-login .warn { color: #ffd97a; font-size: 12px; margin: 0 0 8px; }
    `;
    document.head.appendChild(css);

    const d = document.createElement('div'); d.id = 'af-login';
    document.body.appendChild(d);

    function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function fmtTime(ts) {
      try {
        const t = new Date(Number(ts));
        const p = (n) => String(n).padStart(2, '0');
        return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' + p(t.getHours()) + ':' + p(t.getMinutes());
      } catch (e) { return ''; }
    }
    // 动态换内容（replace innerHTML 即清除旧元素的监听器，避免重复绑定）
    function setView(html) { d.innerHTML = html; }

    // ---------- 第三步：账号登录（服务器地址已在前面选定） ----------
    function viewLogin(getServer) {
      const srv = getServer();
      setView(`
        <div class="box">
          <a class="back" data-act="back">← 返回选模式</a>
          <h2>乡村狂想曲 · 联机版</h2>
          <p class="sub">一个账号一个家。输入账号密码，没有账号会自动注册。</p>
          <input id="af-user" placeholder="账号（2-16 个字符）" maxlength="16">
          <input id="af-pass" type="password" placeholder="密码（至少 4 位）" maxlength="64">
          <div class="err" id="af-err">${msg || ''}</div>
          <button class="btn btn-primary" id="af-login-btn">登录 / 注册</button>
          <button class="btn btn-ghost" id="af-clear-btn">清除本地凭证</button>
          <div class="misc">房间：${esc(srv.replace(/^https?:\/\//, ''))}<br>账号数据保存在房间服务器；同一个房间换浏览器用同一账号即可继续</div>
        </div>`);
      const doAuth = async () => {
        const uname = d.querySelector('#af-user').value.trim();
        const pw = d.querySelector('#af-pass').value;
        const err = d.querySelector('#af-err');
        if (uname.length < 2 || pw.length < 4) { err.textContent = '账号至少 2 字符，密码至少 4 位'; return; }
        const s = getServer(); // 已在前一步选定
        try {
          const r = await fetch(s + '/af/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname, password: pw }) });
          if (r.status === 401) {
            const r2 = await fetch(s + '/af/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname, password: pw }) });
            if (r2.status === 409) { err.textContent = '该账号已被注册且密码不对，想下换个名字试试'; return; }
            if (r2.status === 400) { err.textContent = '账号需 2-16 位（中文/字母/数字/下划线/横杠），密码至少 4 位'; return; }
            if (r2.status !== 200) { err.textContent = '注册失败 (' + r2.status + ')'; return; }
            onLoginOk(await r2.json()); return;
          }
          if (r.status !== 200) { err.textContent = '登录失败 (' + r.status + ')，确认房间地址正确且房主已开房'; return; }
          onLoginOk(await r.json());
        } catch (e) { err.textContent = '无法连接服务器 ' + s + '，请检查地址'; }
      };
      d.querySelector('#af-login-btn').addEventListener('click', doAuth);
      d.querySelector('#af-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
      d.querySelector('#af-clear-btn').addEventListener('click', () => {
        LS.removeItem('af_token'); LS.removeItem('af_uid'); LS.removeItem('af_nick');
        location.reload();
      });
      d.querySelector('[data-act="back"]').addEventListener('click', viewMode);
    }

    // ---------- 第二步A：我是房主 → 选存档 ----------
    function viewHost() {
      setView(`
        <div class="box">
          <a class="back" data-act="back">← 返回</a>
          <h2>🏠 我是房主</h2>
          <p class="sub">选择一个存档开房间。服务器启动后会自动获取穿透地址。</p>
          <div class="saves" id="af-saves"><div class="err">加载存档中…</div></div>
          <div id="af-room-info" style="margin-top:14px;display:none;"></div>
        </div>`);
      d.querySelector('[data-act="back"]').addEventListener('click', viewMode);
      const saveBox = d.querySelector('#af-saves');
      const roomInfo = d.querySelector('#af-room-info');
      // 尝试获取房间码
      fetch('/af/room').then(r => r.json()).then(data => {
        if (data.roomCode) {
          roomInfo.style.display = 'block';
          roomInfo.innerHTML = `<div style="background:#1a1f26;border:1px solid #e0a63c;border-radius:8px;padding:12px;text-align:center;">
            <div style="color:#ffd97a;font-size:12px;">你的房间码</div>
            <div style="color:#ffd97a;font-size:28px;font-weight:bold;letter-spacing:6px;margin:6px 0;">${esc(data.roomCode)}</div>
            <div style="color:#9aa4b0;font-size:11px;">朋友选"加入房间"输入这个码即可</div>
            <div style="color:#6b7684;font-size:10px;margin-top:4px;">穿透地址: ${esc(data.tunnelUrl || '获取中...')}</div>
          </div>`;
        }
      }).catch(() => {});
      fetch(SERVER + '/af/saves').then((r) => r.json()).then((data) => {
        const saves = data.saves || [];
        saveBox.innerHTML = '';
        if (!saves.length) { saveBox.innerHTML = '<div class="err">暂无存档信息</div>'; return; }
        const isCur = (slot) => !!data.currentSlot && Number(data.currentSlot) === Number(slot);
        for (const s of saves) {
          const card = document.createElement('div');
          card.className = 'save' + (s.exists ? '' : ' empty');
          const lastPlayed = s.lastPlayed ? fmtTime(s.lastPlayed) : '从未游玩';
          const playerInfo = s.exists
            ? (s.playerCount > 0 ? s.playerCount + ' 位玩家' : '空档')
            : '空位 · 点击创建新档';
          card.innerHTML = `
            <div class="sn">${esc(s.name || ('存档' + s.slot))}${isCur(s.slot) ? '<span class="cur">● 当前</span>' : ''}</div>
            <div class="sm">👥 ${playerInfo} · 🕒 ${lastPlayed}</div>`;
          if (s.exists) {
            card.addEventListener('click', () => {
              try { localStorage.setItem('af_selected_slot', String(s.slot)); } catch (e) {}
              viewLogin(function () { return SERVER; }); // 房主：用当前地址
            });
          }
          saveBox.appendChild(card);
        }
      }).catch(() => {
        saveBox.innerHTML = '<div class="err">无法连接服务器 ' + esc(SERVER) + '，请确认服务器已启动</div>';
      });
    }

    // ---------- 第二步B：加入房间 → 房间码或地址 ----------
    function viewJoin() {
      setView(`
        <div class="box">
          <a class="back" data-act="back">← 返回</a>
          <h2>🚪 加入房间</h2>
          <p class="sub">输入房主给你的6位房间码，或直接输入地址</p>
          <input id="af-roomcode" placeholder="6位房间码（如 382915）" maxlength="6" style="text-align:center;font-size:24px;letter-spacing:8px;font-weight:bold;">
          <div style="text-align:center;color:#6b7684;font-size:12px;margin:8px 0">—— 或手动输入地址 ——</div>
          <input id="af-srv" placeholder="如 http://192.168.1.5:8080" value="${esc(SERVER)}" maxlength="120">
          <div class="err" id="af-err"></div>
          <button class="btn btn-primary" id="af-join-btn">连接</button>
          <div class="foot-hint">让房主告诉你他的房间码或地址。</div>
        </div>`);
      d.querySelector('[data-act="back"]').addEventListener('click', viewMode);
      const codeInput = d.querySelector('#af-roomcode');
      const srvInput = d.querySelector('#af-srv');
      const errEl = d.querySelector('#af-err');
      const doJoin = async () => {
        // 优先用房间码
        const code = codeInput.value.trim();
        if (code.length === 6 && /^\d+$/.test(code)) {
          try {
            const r = await fetch('/af/join-room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
            const data = await r.json();
            if (data.ok && data.url) {
              SERVER = data.url;
              try { localStorage.setItem('af_server', data.url); } catch (e) {}
              if (ws) { try { ws.close(); } catch (e) {} }
              viewLogin(function () { return SERVER; });
              return;
            } else {
              errEl.textContent = data.msg || '房间码无效';
              return;
            }
          } catch (e) {
            errEl.textContent = '无法查询房间码，请尝试手动输入地址';
            return;
          }
        }
        // 备选：手动输入地址
        const srv = srvInput.value.trim().replace(/\/+$/, '');
        if (!/^https?:\/\//.test(srv)) { errEl.textContent = '地址需以 http(s):// 开头'; return; }
        SERVER = srv;
        try { localStorage.setItem('af_server', srv); } catch (e) {}
        if (ws) { try { ws.close(); } catch (e) {} }
        viewLogin(function () { return SERVER; });
      };
      d.querySelector('#af-join-btn').addEventListener('click', doJoin);
      srvInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
      codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
    }

    // ---------- 第一步：选模式 ----------
    function viewMode() {
      setView(`
        <div class="box" style="text-align:center;">
          <h2>🏡 乡村狂想曲 · 联机版</h2>
          <p class="sub">选择你要进入房间的方式</p>
          <button class="btn btn-host" id="af-host-btn">🏠 我是房主</button>
          <button class="btn btn-join" id="af-join-btn">🚪 加入房间</button>
          <div class="foot-hint">房主 = 在你的电脑上开服务器，其他人连接进来</div>
        </div>`);
      d.querySelector('#af-host-btn').addEventListener('click', viewHost);
      d.querySelector('#af-join-btn').addEventListener('click', viewJoin);
    }

    // 带错误/提示消息（如登录过期、服务器重试）直接进账号登录页，用当前服务器地址
    if (msg) viewLogin(function () { return SERVER; });
    else viewMode();
  }

  // 自动登录：有 token → /af/me 换 uid → 拉存档 → boot
  function tryAutoLogin() {
    if (!token) { showLoginUI(); return; }
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', SERVER + '/af/me?token=' + encodeURIComponent(token), false);
      xhr.send();
      if (xhr.status === 200) {
        const me = JSON.parse(xhr.responseText);
        uid = me.uid; nick = me.nick || uid;
        if (loadWorldFromServer()) {
          bootReady = true;
          if (window.__AF_ORIG_BOOT__) window.__AF_ORIG_BOOT__();
          startNetwork();
          return;
        }
      }
    } catch (e) {}
    // token 失效或出错 → 清掉重新登录
    LS.removeItem('af_token'); LS.removeItem('af_uid'); LS.removeItem('af_nick');
    token = '';
    showLoginUI('登录已过期，请重新登录');
  }

  // 拦截 window.boot：登录成功前不启动游戏
  (function hookBoot() {
    if (window.boot && !window.__AF_BOOT_HOOKED__) {
      window.__AF_BOOT_HOOKED__ = true;
      window.__AF_ORIG_BOOT__ = window.boot;
      window.boot = function () {
        if (bootReady) window.__AF_ORIG_BOOT__();
        else console.log('[AF] 等待登录完成...');
      };
    } else if (!window.boot) {
      setTimeout(hookBoot, 50);
    }
  })();

  // 网络层（WS）在所有身份就绪后启动
  // ---------- 区域名接管：扩展区显示正确的地名（原版区域表只覆盖 77x61，扩展区会残留旧名"河边"） ----------
  function injectAreaName() {
    try {
      const scene = cc.director && cc.director.getScene();
      if (!scene) return;
      let lb = null;
      scene.walk((n) => { if (!lb && n.name === 'lbName' && n.parent && n.parent.name === 'pnlTime' && n.getComponent && n.getComponent(cc.Label)) lb = n; });
      const mods = window.__AF_MODS__; if (!mods || !lb) return;
      const L = lb.getComponent(cc.Label);
      const cur = L ? L.string : '';
      // 缓存原版第一次写出的标签（恢复用）
      if (!window.__AF_AREA_ORIG__ && !/村外/.test(cur)) window.__AF_AREA_ORIG__ = cur;
      const App = mods['Application'] && mods['Application'].exports;
      const node = App && App.default && App.default.getIns && App.default.getIns().playerNode;
      if (!node || !node.isValid) return;
      const p = node.getPosition();
      const tmNode = getTiledMapNode();
      if (!tmNode) return;
      const tm = tmNode.getComponent(cc.TiledMap);
      const W = tm.getMapSize().width, H = tm.getMapSize().height;
      // 玩家本地坐标（y 向上）→ TMX 格（y 向下）
      const gx = Math.floor(p.x / 100), gy = H - 1 - Math.floor(p.y / 100);
      // 原版村庄区域（中心 77×61）：交还原版逻辑
      const LEFT = Math.round((W - 77) / 2), TOP = Math.round((H - 61) / 2);
      if (gx >= LEFT && gx < LEFT + 77 && gy >= TOP && gy < TOP + 61) {
        if (/村外/.test(cur) && window.__AF_AREA_ORIG__ && L) L.string = window.__AF_AREA_ORIG__; // 恢复原版标签
        return;
      }
      const spawns = window.__AF_SPAWNS__;
      let name = '村外田野';
      if (spawns && spawns.houses) {
        const near = spawns.houses.find(h => {
          const r = h.rect;
          return gx >= r.x - 3 && gx < r.x + r.w + 3 && gy >= r.y - 3 && gy < r.y + r.h + 3;
        });
        if (near) name = String(near.type).replace(/^[a-zA-Z]+\(/, '').replace(/\)$/, '') + '·村外';
      }
      if (L && L.string !== name) L.string = name;
    } catch (e) {}
  }

  function startNetwork() {
    connect();
    injectChatUI();
    injectDiaryUI();
    injectAgentUI();
    injectSocialUI();
  }

  // ---------- key 翻译 ----------
  // 客户端 key:  mapData_100001 / playerData_100001 / audioData(无后缀)
  // 服务器 key:  mapData_u123 / playerData_u123 / audioData
  const RE_SUFFIX = /^(.+)_\d+$/;
  function serverKey(key) { const m = RE_SUFFIX.exec(key); return m ? m[1] + '_' + uid : key; }
  function clientKey(key) { const m = /^(.+)_\w+$/.exec(key); return m ? m[1] + '_' + CLIENT_SUFFIX : key; }

  // ---------- 服务器状态缓存 ----------
  const serverCache = new Map(); // serverKey -> value(string)
  let ws = null, connected = false, syncReady = false;

  // ---------- 包装 localStorage ----------
  const orig = {
    getItem: LS.getItem.bind(LS),
    setItem: LS.setItem.bind(LS),
    removeItem: LS.removeItem.bind(LS),
    clear: LS.clear.bind(LS),
  };

  let pending = new Map(); // serverKey -> value
  let timer = null;
  function flush() {
    timer = null;
    if (!pending.size || !connected) return;
    const kv = Array.from(pending.entries());
    pending = new Map();
    try { ws.send(JSON.stringify({ t: 'save', kv })); } catch (e) {}
  }
  function schedulePush(sk, v) {
    pending.set(sk, v);
    if (connected && !timer) timer = setTimeout(flush, 250);
  }

  LS.getItem = function (key) {
    return orig.getItem(key);
  };
  LS.setItem = function (key, value) {
    orig.setItem(key, value);
    if (key.startsWith('af_')) return; // 本地元数据（token/uid）不推送
    if (key === 'socialData' || key.startsWith('socialData_')) return; // 服务器权威键（好感/关系），回推旧快照会覆盖实时数据
    if (key === 'afTasks' || key.startsWith('afTasks_')) return;
    if (key === 'villagedb_10000') {
      // 原版全量存档：展开成逐 key 推送，服务器按桶合并
      try {
        const full = JSON.parse(value);
        const kv = [];
        for (const d of (full.datas || [])) {
          if (!d || !d.key) continue;
          kv.push([serverKey(d.key), typeof d.val === 'string' ? d.val : JSON.stringify(d.val)]);
        }
        if (kv.length) {
          if (connected && !timer) { pending = new Map(kv); flush(); }
          else for (const [k, v] of kv) schedulePush(k, v);
        }
      } catch (e) { schedulePush(serverKey(key), String(value)); }
      return;
    }
    schedulePush(serverKey(key), String(value));
  };
  LS.removeItem = function (key) {
    orig.removeItem(key);
    if (key.startsWith('af_')) return;
    schedulePush(serverKey(key), '');
  };
  LS.clear = function () {
    orig.clear();
  };

  // ---------- WebSocket ----------
  let afKicked = false; // 被服务器踢出（顶号/鉴权失败）后停止自动重连
  function connect() {
    try { ws = new WebSocket(WS_URL); } catch (e) { console.warn('[AF] ws 创建失败', e); return; }
    ws.onopen = function () {
      connected = true;
      ws.send(JSON.stringify({ t: 'join', uid, nick, token: token || '' }));
      if (pending.size) flush();
      startPosSync();
    };
    ws.onmessage = function (ev) {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      switch (msg.t) {
        case 'welcome': {
          // 其他在线玩家
          (msg.players || []).forEach(p => { if (p.uid !== uid) onPlayerJoin(p); });
          break;
        }
        case 'player_join': onPlayerJoin(msg.p); break;
        case 'player_leave': onPlayerLeave(msg.uid); break;
        case 'save_broadcast': {
          // 服务器权威数据更新 → 写本地（原版不会自动重读，画面同步留待 v0.2）
          for (const [sk, v] of (msg.kv || [])) {
            serverCache.set(sk, v);
            if (v) LS.setItem(clientKey(sk), v);
          }
          break;
        }
        case 'chat': onChat(msg.nick, msg.text); break;
        case 'chat_warn': if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', msg.msg || '发言太快'); break;
        case 'kicked':
        case 'join_deny': {
          // 被服务器拒绝（同账号别处上线 / 账号校验失败）：停止自动重连，提示用户
          afKicked = true; connected = false;
          try { ws.close(); } catch (e) {}
          alert(msg.msg || '连接已被服务器断开，请刷新页面重新登录');
          break;
        }
        case 'move': onRemoteMove(msg); break;
        case 'social_in': onSocialIn(msg); break;
        case 'social_result': onSocialResult(msg); break;
        case 'social_tp_apply': {
          try {
            const App = window.__AF_MODS__ && window.__AF_MODS__['Application'] && window.__AF_MODS__['Application'].exports;
            const node = App && App.default && App.default.getIns && App.default.getIns().playerNode;
            if (node && node.isValid) node.setPosition(msg.x, msg.y, 0);
          } catch (e) {}
          break;
        }
        case 'task_done': if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', msg.msg); break;
        case 'task_list': onTaskList(msg); break;
        case 'agent_activity': {
          const st = document.getElementById('af-agent-status');
          if (msg.activity) agentActivity = msg.activity;
          if (st && msg.activity) {
            st.textContent = '🤖 托管中' + (agentNick ? ' · ' + agentNick : '') + ' · ' + msg.activity;
            st.className = 'on';
          }
          if (window.__AF_CHAT_ADD__ && msg.activity) window.__AF_CHAT_ADD__('Agent', msg.activity);
          break;
        }
        case 'agent_move': onAgentMove(msg); break;
        case 'agent_move_done': onAgentMoveDone(msg); break;
        case 'agent_status': if (window.__AF_AGENT_STATUS__) window.__AF_AGENT_STATUS__(!!msg.online, msg.nick); break;
      }
    };
    ws.onclose = function () {
      connected = false;
      if (afKicked) return; // 被踢/鉴权失败：等待用户刷新页面，避免重连循环
      setTimeout(connect, 3000);
    };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  // ---------- 在线玩家渲染（v0.4：Cocos 节点 + 位置同步） ----------
  const remotePlayers = new Map(); // uid -> { nick, scene, x, y, node }
  const remotes = new Map();       // uid -> cocos node
  let posTimer = null, lastScene = null, sceneWatchTimer = null;
  let hostedAgentOnline = false, agentStopTimer = null;

  // 捕获游戏模块：cc._RF.push(t, uuid, name) 的 t 是模块 exports 表
  function hookModuleCapture() {
    if (window.cc && cc._RF && cc._RF.push && !window.__AF_MODS__) {
      window.__AF_MODS__ = {};
      const orig = cc._RF.push.bind(cc._RF);
      cc._RF.push = function (t, uuid, name) {
        try { window.__AF_MODS__[name] = t; } catch (e) {}
        return orig(t, uuid, name);
      };
      console.log('[AF] 模块捕获已挂载');
    }
  }
  (function pollHook() {
    hookModuleCapture();
    if (!window.__AF_MODS__) setTimeout(pollHook, 200);
  })();

  function readPlayerPos() {
    const mods = window.__AF_MODS__; if (!mods) return null;
    try {
      const PM = mods['PlayerMoudle'] && mods['PlayerMoudle'].exports;
      const App = mods['Application'] && mods['Application'].exports;
      const player = PM && (PM._gPlayer || (PM.default && PM.default._gPlayer));
      const node = App && App.default && App.default.getIns && App.default.getIns().playerNode;
      if (!player || !node) return null;
      const p = node.getPosition();
      return { scene: player.getSceneType(), x: Math.round(p.x), y: Math.round(p.y) };
    } catch (e) { return null; }
  }

  function startPosSync() {
    if (posTimer) return;
    posTimer = setInterval(() => {
      const pos = readPlayerPos();
      if (pos && connected && !hostedAgentOnline) {
        if (pos.scene !== lastScene) { lastScene = pos.scene; sceneChangeAt = Date.now(); spawnFixed = false; }
        try { ws.send(JSON.stringify({ t: 'move', scene: pos.scene, x: pos.x, y: pos.y })); } catch (e) {}
      }
    }, 200);
    sceneWatchTimer = setInterval(() => {
      // 场景切换后远程节点可能被清理，重建
      try {
        for (const [uid2, n] of remotes) {
          if (!n.isValid) remotes.delete(uid2);
        }
        for (const [uid2, p] of remotePlayers) {
          if (!remotes.has(uid2)) ensureRemoteNode(uid2);
        }
      } catch (e) { console.warn('[AF] remote sync err:', e.message); }
      try { injectBlockers(); } catch (e) { console.warn('[AF] injectBlockers err:', e.message); }
      try { injectAreaName(); } catch (e) { console.warn('[AF] injectAreaName err:', e.message); }
      try { shiftPassages(); } catch (e) { console.warn('[AF] shiftPassages err:', e.message); }
      try { fixSpawnAfterReturn(); } catch (e) { console.warn('[AF] fixSpawnAfterReturn err:', e.message); }
      try { installDayHomeBlock(); } catch (e) { console.warn('[AF] installDayHomeBlock err:', e.message); }
      try { autoClosePopups(); } catch (e) { console.warn('[AF] autoClosePopups err:', e.message); }
      try { if (window.__AF_BLOCK_BOXES__) startBlockWatch(); } catch (e) {}
      try { hideExtraSlots(); } catch (e) { console.warn('[AF] hideExtraSlots err:', e.message); }
      try { uploadShot(); } catch (e) { console.warn('[AF] uploadShot err:', e.message); }
      try { injectVillageMap(); } catch (e) { console.warn('[AF] injectVillageMap err:', e.message); }
    }, 1000);
  }

  // ---------- 进游戏体验：自动关闭回忆录/图鉴弹窗 + 欢迎语 ----------
  let worldAt = 0, welcomeDone = false;
  function autoClosePopups() {
    try {
      const mods = window.__AF_MODS__; if (!mods) return;
      const App = mods['Application'] && mods['Application'].exports;
      const node = App && App.default && App.default.getIns && App.default.getIns().playerNode;
      if (!node || !node.isValid) { worldAt = 0; return; }
      if (!worldAt) { worldAt = Date.now(); }
      const scene = cc.director && cc.director.getScene();
      if (!scene) return;
      const inWorld = node.activeInHierarchy && node.x !== 0;
      // 前 12 秒内自动关弹窗（回忆录/图鉴 btnClose）
      if (Date.now() - worldAt < 12000) {
        let hit = null;
        scene.walk((n) => { if (!hit && n.activeInHierarchy && /^btnClose$/i.test(n.name) && n.getComponent && n.getComponent(cc.Button)) hit = n; });
        if (hit) {
          try { cc.Component.EventHandler.emitEvents(hit.getComponent(cc.Button).clickEvents, hit); } catch (e) {}
          return;
        }
      }
      // 欢迎语（进入世界后提示一次）
      if (inWorld && !welcomeDone && window.__AF_CHAT_ADD__) {
        welcomeDone = true;
        const srv = (window.__AF_SERVER_SHORT__ = SERVER.replace(/^https?:\/\//, ''));
        window.__AF_CHAT_ADD__('系统', '欢迎来到村庄！房间：' + srv + '。点右下角 📮 可配置模型/托管 Agent；💬 聊天；按回车发言。');
      }
    } catch (e) {}
  }

  // ---------- 过夜不强制回家 ----------
  // 原版 changeDay（进入早上）会 changeSceneEasy(PLAYER_HOUSE, DAY_AND_PLAYER_HOUSE)
  // 把玩家强制传送回主角家 —— 无论是主动睡床还是时间自然推进到早上。这会打断
  // Agent/玩家在村庄的连续活动。修复：拦截该特定传送，睡觉动画/时间推进/体力恢复
  // 全部照常，只是人留在原地。
  function installDayHomeBlock() {
    try {
      if (window.__AF_DAY_HOME_BLOCKED__) return;
      const mods = window.__AF_MODS__; if (!mods) return;
      const GD = mods['GameDefine'] && mods['GameDefine'].exports;
      const GM = mods['GameManager'] && mods['GameManager'].exports;
      if (!GD || !GM) return;
      const PLAYER_HOUSE = GD.SceneType && GD.SceneType.PLAYER_HOUSE;
      const DAY_HOME = GD.ScenePassageType && GD.ScenePassageType.DAY_AND_PLAYER_HOUSE;
      const GMClass = GM.default || GM;
      if (!GMClass || !GMClass.prototype || typeof GMClass.prototype.changeSceneEasy !== 'function') return;
      if (typeof PLAYER_HOUSE !== 'number' || typeof DAY_HOME !== 'number') return;
      const orig = GMClass.prototype.changeSceneEasy;
      if (orig.__afNoDayHome) return;
      GMClass.prototype.changeSceneEasy = function (sceneType, passageType, cb) {
        if (sceneType === PLAYER_HOUSE && passageType === DAY_HOME) {
          // 过夜不回家：只执行回调（剧情检查），跳过场景传送，玩家留在原地
          try { if (typeof cb === 'function') cb(); } catch (e) {}
          return;
        }
        return orig.apply(this, arguments);
      };
      GMClass.prototype.changeSceneEasy.__afNoDayHome = true;
      window.__AF_DAY_HOME_BLOCKED__ = true;
      console.log('[AF] 过夜强制回家已禁用（PLAYER_HOUSE/DAY_AND_PLAYER_HOUSE 拦截）');
    } catch (e) {}
  }

  // ---------- 入口对齐 ----------
  // 地图内容平移了 +28 格（2800 单位），但场景 prefab 里的入口 collider（map_passage）
  // 与出生点仍是原版坐标 → 入口悬在田野中间、看不到路。修正：collider 节点平移对齐，
  // 从别处回来时把玩家从旧出生点拉回正确位置（仅切场景后的短窗口内，避免误伤正常走动）。
  const OLD_ENTRY_POINTS = [
    [1830, 5830], [7580, 4930], [7580, 2730], [80, 4030], [100, 850], [4060, 70],
    [705, 4850], [6700, 5215], [2340, 3675], [5044, 3115], [6900, 3310],
    [275, 1620], [2162, 1600], [6750, 1275],
  ];
  const ENTRY_SHIFT = 2800;
  function shiftPassages() {
    try {
      const mods = window.__AF_MODS__; if (!mods) return;
      const PM = mods['PlayerMoudle'] && mods['PlayerMoudle'].exports;
      const player = PM && (PM._gPlayer || (PM.default && PM.default._gPlayer));
      if (!player || player.getSceneType() !== 2) return; // 仅村庄场景（只有它扩展过地图）
      const scene = cc.director && cc.director.getScene();
      if (!scene) return;
      let n = 0;
      scene.walk((nd) => {
        if (nd.group === 'map_passage' && nd.parent && nd.parent.name === 'passage' && !nd.afShifted) {
          nd.setPosition(nd.x + ENTRY_SHIFT, nd.y + ENTRY_SHIFT, 0);
          nd.afShifted = true; // 场景重载后新节点无标记，自动再次平移
          n++;
        }
      });
      if (n) console.log('[AF] 场景入口已对齐 (+2800) x' + n);
    } catch (e) {}
  }
  let sceneChangeAt = 0, spawnFixed = false;
  function fixSpawnAfterReturn() {
    try {
      const mods = window.__AF_MODS__; if (!mods) return;
      const App = mods['Application'] && mods['Application'].exports;
      const node = App && App.default && App.default.getIns && App.default.getIns().playerNode;
      if (!node || !node.isValid) return;
      const PM = mods['PlayerMoudle'] && mods['PlayerMoudle'].exports;
      const player = PM && (PM._gPlayer || (PM.default && PM.default._gPlayer));
      if (!player) return;
      if (player.getSceneType() !== 2) { spawnFixed = false; return; }
      if (spawnFixed || Date.now() - sceneChangeAt > 3000) return;
      const p = node.getPosition();
      for (const [ex, ey] of OLD_ENTRY_POINTS) {
        if (Math.abs(p.x - ex) < 300 && Math.abs(p.y - ey) < 300) {
          node.setPosition(p.x + ENTRY_SHIFT, p.y + ENTRY_SHIFT, 0);
          spawnFixed = true;
          console.log('[AF] 出生点已对齐入口 (' + Math.round(p.x) + ',' + Math.round(p.y) + ')');
          break;
        }
      }
    } catch (e) {}
  }

  function ensureRemoteNode(uid2) {
    // 防止把自己渲染成第二个"主角"（画面中心本人只保留一份）
    if (uid2 === uid) return null;
    try {
      const mods = window.__AF_MODS__; if (!mods) return null;
      const App = mods['Application'] && mods['Application'].exports;
      const app = App && App.default && App.default.getIns && App.default.getIns();
      if (!app || !app.prefab_player || !cc.instantiate) return null;
      let n = remotes.get(uid2);
      if (!n || !n.isValid) {
        n = cc.instantiate(app.prefab_player);
        n.active = true;
        const layer = app.pnlSceneLayer || (cc.director.getScene() && cc.director.getScene().getChildByName('Canvas'));
        if (!layer) return null;
        layer.addChild(n);
        // 名字标签
        const lb = new cc.Node('AFName');
        const lbl = lb.addComponent(cc.Label);
        lbl.fontSize = 16;
        lbl.string = (remotePlayers.get(uid2) || { nick: uid2 }).nick;
        lb.setPosition(0, 60, 0);
        n.addChild(lb);
        remotes.set(uid2, n);
        // 点击对方 → 社交交互面板（近距离对话/送礼/好感/关系）
        try {
          n.on(cc.Node.EventType.TOUCH_END, () => { openSocialPanel(uid2); }, n);
        } catch (e) {}
        console.log('[AF] 渲染远程玩家节点:', uid2);
      }
      return n;
    } catch (e) { return null; }
  }

  function onPlayerJoin(p) {
    if (!p || p.uid === uid) return; // 绝不渲染自己的第二个化身
    if (remotePlayers.has(p.uid)) return;
    remotePlayers.set(p.uid, p);
    console.log('[AF] 玩家上线:', p.nick, p.uid);
    startPosSync();
    const n = ensureRemoteNode(p.uid);
    // 带初始位置则立即就位（agent 接入时显示在正确位置，而不是原点）
    if (n && n.isValid && typeof p.x === 'number') {
      try {
        const my = readPlayerPos();
        const sameScene = !my || my.scene === p.scene;
        n.active = !!sameScene;
        if (sameScene) n.setPosition(p.x, p.y, 0);
      } catch (e) {}
    }
  }
  function onPlayerLeave(uid2) {
    remotePlayers.delete(uid2);
    const n = remotes.get(uid2);
    if (n && n.isValid) { try { n.destroy(); } catch (e) {} }
    remotes.delete(uid2);
    console.log('[AF] 玩家下线:', uid2);
  }
  function onRemoteMove(msg) {
    const p = remotePlayers.get(msg.uid);
    if (!p) { // 未 join 直接收到 move（先 join 后 move，理论不会）
      if (msg.uid !== uid) { remotePlayers.set(msg.uid, { uid: msg.uid, nick: msg.uid, scene: msg.scene, x: msg.x, y: msg.y }); }
      else return;
    } else { p.scene = msg.scene; p.x = msg.x; p.y = msg.y; }
    const n = remotes.get(msg.uid);
    if (!n || !n.isValid) { ensureRemoteNode(msg.uid); return; }
    try {
      // 场景一致才显示
      const my = readPlayerPos();
      const sameScene = !my || my.scene === msg.scene;
      n.active = !!sameScene;
      if (sameScene) n.setPosition(msg.x, msg.y, 0);
    } catch (e) {}
  }

  let agentMoveTarget = null; // {x,y} 当前 agent 目标
  function clearAgentMoveState(item) {
    agentMoveTarget = null;
    hostedAgentOnline = false;
    if (agentStopTimer) { clearTimeout(agentStopTimer); agentStopTimer = null; }
    try { if (item && item.isValid) item.changeDir(0, false); } catch (e) {}
  }
  function onAgentMove(msg) {
    if (!msg || typeof msg.x !== 'number') return;
    const mods = window.__AF_MODS__;
    const App = mods && mods['Application'] && mods['Application'].exports;
    const node = App && App.default && App.default.getIns && App.default.getIns().playerNode;
    if (!node || !node.isValid) return;
    const PlayerItem = mods && mods['PlayerItem'] && mods['PlayerItem'].exports;
    const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem');
    if (!item) return;
    const p = node.getPosition(), dx = msg.x - p.x, dy = msg.y - p.y;
    // 原版 DirType：LEFT=2 RIGHT=5 UP=10 DOWN=11。走路状态机负责动画、碰撞和镜头。
    const dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 5 : 2) : (dy >= 0 ? 10 : 11);
    item.changeDir(dir, false);
    agentMoveTarget = { x: msg.x, y: msg.y };
    // agent 移动期间不自动回传本地坐标，避免与 Agent 位置竞争
    hostedAgentOnline = true;
    if (agentStopTimer) clearTimeout(agentStopTimer);
    // 兜底：如果完成事件丢了，过一段时间也要恢复本地同步。
    agentStopTimer = setTimeout(() => { clearAgentMoveState(item); }, 12000);
  }

  function onAgentMoveDone(msg) {
    if (!msg) return;
    const mods = window.__AF_MODS__;
    const App = mods && mods['Application'] && mods['Application'].exports;
    const node = App && App.default && App.default.getIns && App.default.getIns().playerNode;
    if (!node || !node.isValid) return;
    const PlayerItem = mods && mods['PlayerItem'] && mods['PlayerItem'].exports;
    const item = (PlayerItem && node.getComponent(PlayerItem.default || PlayerItem)) || node.getComponent('PlayerItem');
    clearAgentMoveState(item);
  }

  // ---------- 统一阻挡注入（宅基地/水面/扩展区栅栏：回滚盒 + 物理碰撞兜底） ----------
  // 坐标体系：玩家 node.getPosition() 是 pnlTiledMap 本地坐标（y 向上，原点=地图左下角）。
  // TMX 是 y 向下，所以 tile (x,y) 的本地坐标 = (x*100+50, (H-y)*100-50)。
  // 旧实现把盒子挂在 pnlSceneLayer 且没做 y 翻转 → 全部偏位（这就是"草地空气墙/水能走进"的根因）。
  let blockDone = false;
  function getTiledMapNode() {
    try {
      const mods = window.__AF_MODS__; if (!mods) return null;
      const App = mods['Application'] && mods['Application'].exports;
      const app = App && App.default && App.default.getIns && App.default.getIns();
      const layer = app && app.pnlSceneLayer;
      if (!layer || !layer.isValid) return null;
      let found = null;
      layer.walk((n) => { if (!found && n.getComponent && n.getComponent(cc.TiledMap)) found = n; });
      return found;
    } catch (e) { return null; }
  }
  function injectBlockers() {
    try {
      const mods = window.__AF_MODS__; if (!mods) return;
      const App = mods['Application'] && mods['Application'].exports;
      const app = App && App.default && App.default.getIns && App.default.getIns();
      const spawns = window.__AF_SPAWNS__;
      if (!app || !spawns || !spawns.houses || !window.cc) return;
      const pos = readPlayerPos();
      if (!pos || pos.scene !== (spawns.scene || 2)) { blockDone = false; return; }
      if (blockDone) return;
      const tiledNode = getTiledMapNode();
      if (!tiledNode || !tiledNode.isValid) return;
      const tm = tiledNode.getComponent(cc.TiledMap);
      const mapSize = tm.getMapSize();
      const W = mapSize.width, H = mapSize.height;
      if (!W || !H) return;
      // 唯一盒子数组（旧 bug：injectHouseColliders 曾整体替换该数组，把水面盒全丢了）
      const boxes = (window.__AF_BLOCK_BOXES__ = window.__AF_BLOCK_BOXES__ || []);
      boxes.length = 0; // 场景重载后重新注入，先清空旧盒子（旧物理节点随旧场景销毁）
      const mkWall = (cx, cy, w, h) => {
        boxes.push({ x: cx, y: cy, w, h });
        try {
          const n = new cc.Node('af-wall');
          const rb = n.addComponent(cc.RigidBody);
          rb.type = cc.RigidBodyType.STATIC;
          const bc = n.addComponent(cc.PhysicsBoxCollider);
          bc.size = cc.size(w, h);
          n.setPosition(cx, cy, 0);
          tiledNode.addChild(n);
        } catch (e) {}
      };
      const ly = (ty) => (H - ty) * 100 - 50;   // TMX y → 本地 y（y 向上）
      const lx = (tx) => tx * 100 + 50;          // TMX x → 本地 x
      const layerGid = (name, x, y) => {
        try {
          const L = tm.getLayer(name);
          if (!L) return 0;
          return L.getTiledTileAt(x, y, true).gid || 0;
        } catch (e) { return 0; }
      };
      const onRoad = (x, y) => layerGid('caodi', x, y) === 0 || layerGid('shilu', x, y) !== 0;
      const ORIG_W = 77, ORIG_H = 61;
      const inOrig = (x, y) => x >= Math.round((W - ORIG_W) / 2) && x < Math.round((W - ORIG_W) / 2) + ORIG_W &&
                              y >= Math.round((H - ORIG_H) / 2) && y < Math.round((H - ORIG_H) / 2) + ORIG_H;
      // 行内合并连续格为一个矩形盒
      const rowBoxes = (name, pred) => {
        let n = 0;
        for (let y = 0; y < H; y++) {
          let runStart = -1;
          for (let x = 0; x <= W; x++) {
            const isT = x < W && pred(name, x, y);
            if (isT && runStart < 0) runStart = x;
            if (!isT && runStart >= 0) {
              const w = (x - runStart) * 100;
              mkWall(lx(runStart) + w / 2, ly(y), w, 100);
              n++;
              runStart = -1;
            }
          }
        }
        return n;
      };
      let nWall = 0;
      // 1) 扩展区宅基地（素材外圈含透明留白 → 缩进 1 格）
      for (const h of spawns.houses) {
        const r = h.rect;
        const x0 = r.x + 1, y0 = r.y + 1, w = Math.max(1, r.w - 2), hgt = Math.max(1, r.h - 2);
        mkWall((x0 + w / 2) * 100, ((H - y0) - hgt / 2) * 100, w * 100, hgt * 100);
        nWall++;
      }
      // 2) 水面（shuich 层，全图）
      nWall += rowBoxes('shuich', (n, x, y) => !!layerGid(n, x, y));
      // 3) 栅栏/树篱（mulan/mulan2，全图；沙/石路上的不挡：原版广场重叠装饰保持可走）
      nWall += rowBoxes('mulan', (n, x, y) => {
        if (!layerGid(n, x, y) || onRoad(x, y)) return false;
        return true;
      });
      nWall += rowBoxes('mulan2', (n, x, y) => {
        if (!layerGid(n, x, y) || onRoad(x, y)) return false;
        return true;
      });
      blockDone = true;
      console.log('[AF] 已注入阻挡盒 x' + boxes.length + ' (宅基地' + spawns.houses.length + '+水面+栅栏) 本地坐标');
    } catch (e) { console.warn('[AF] 阻挡注入失败:', e); }
  }

  // ---------- 回滚阻挡（兜底：headless 或物理失效时，玩家不得进入房子/树篱） ----------
  // 注意：不用 setInterval（后台标签页会被浏览器节流），挂游戏主循环每帧检测
  let lastValidPos = null, blockWatchOn = false;
  function startBlockWatch() {
    if (blockWatchOn || !window.cc || !cc.director) return;
    blockWatchOn = true;
    const spawns = window.__AF_SPAWNS__;
    const cb = () => {
      try {
        const boxes = window.__AF_BLOCK_BOXES__;
        const mods = window.__AF_MODS__;
        if (!boxes || !mods) return;
        const App = mods['Application'] && mods['Application'].exports;
        const node = App && App.default && App.default.getIns && App.default.getIns().playerNode;
        if (!node || !node.isValid) return;
        // 仅村场景（宅基地所在场景）生效
        const PM = mods['PlayerMoudle'] && mods['PlayerMoudle'].exports;
        const player = PM && (PM._gPlayer || (PM.default && PM.default._gPlayer));
        if (spawns && player && player.getSceneType() !== (spawns.scene || 2)) return;
        const p = node.getPosition();
        const PW = 55, PH = 40; // 玩家半宽/半高（碰撞盒约 80x58）
        let inside = false;
        for (const b of boxes) {
          if (p.x + PW > b.x - b.w / 2 && p.x - PW < b.x + b.w / 2 &&
              p.y + PH > b.y - b.h / 2 && p.y - PH < b.y + b.h / 2) { inside = true; break; }
        }
        if (inside) {
          if (lastValidPos) node.setPosition(lastValidPos.x, lastValidPos.y, 0);
        } else {
          lastValidPos = { x: p.x, y: p.y };
        }
      } catch (e) {}
    };
    cc.director.on(cc.Director.EVENT_AFTER_UPDATE, cb);
    window.__AF_BLOCK_CB__ = cb;
  }

  // ---------- 聊天 overlay ----------
  function injectChatUI() {
    const css = document.createElement('style');
    css.textContent = `
      #af-chat { position: fixed; left: 8px; bottom: 8px; z-index: 99999; width: 340px;
        font: 13px/1.5 "Microsoft YaHei", sans-serif; pointer-events: none; }
      #af-chat .af-line { color: #fff; text-shadow: 1px 1px 2px #000; background: rgba(0,0,0,.35);
        padding: 2px 8px; margin: 2px 0; border-radius: 4px; word-break: break-all; }
      #af-chat .af-line .af-nick { color: #ffe27a; }
      #af-chat-input { position: fixed; left: 8px; bottom: 8px; z-index: 100000; width: 340px;
        display: none; background: rgba(0,0,0,.6); color: #fff; border: 1px solid #888;
        border-radius: 4px; padding: 4px 8px; font: 13px "Microsoft YaHei", sans-serif; outline: none; }
      #af-chat-btn { position: fixed; left: 8px; bottom: 8px; z-index: 99998; width: 36px; height: 36px;
        border: 1px solid #777; border-radius: 6px; background: rgba(38,44,52,.9); color: #fff;
        cursor: pointer; font-size: 18px; }
    `;
    document.head.appendChild(css);
    const box = document.createElement('div'); box.id = 'af-chat';
    const input = document.createElement('input'); input.id = 'af-chat-input';
    const button = document.createElement('button'); button.id = 'af-chat-btn';
    button.type = 'button'; button.textContent = '💬'; button.title = '聊天';
    input.placeholder = '聊天（Enter 发送，Esc 关闭）';
    input.style.display = 'none'; // 显式内联初始态：toggle 依赖内联 display 判定开合，CSS 初始隐藏会使首点误判
    document.body.appendChild(box); document.body.appendChild(input); document.body.appendChild(button);

    const lines = [];
    function addLine(html) {
      const d = document.createElement('div'); d.className = 'af-line'; d.innerHTML = html;
      box.appendChild(d); lines.push(d);
      while (lines.length > 50) { box.removeChild(lines.shift()); }
    }
    function toggle() {
      const on = input.style.display === 'none';
      input.style.display = on ? 'block' : 'none';
      button.style.display = on ? 'none' : 'block';
      cmdBar.style.display = on ? 'flex' : 'none';
      if (on) input.focus(); else input.blur();
    }
    button.addEventListener('click', toggle);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.style.display !== 'none') {
        e.preventDefault(); e.stopPropagation();
        const t = input.value.trim(); input.value = '';
        if (t) {
          if (t[0] === '/' && runSocialCommand(t)) { /* 命令已处理 */ }
          else sendChat(t);
        }
        toggle();
      } else if (e.key === 'Escape' && input.style.display !== 'none') { toggle(); }
      else if (e.key === 'Enter' && !/^(INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName) && !e.target.isContentEditable) {
        e.preventDefault(); e.stopPropagation(); toggle();
      }
    }, true);
    window.__AF_CHAT__ = { addLine, toggle, send: sendChat };
    // 聊天快捷命令按钮（💬 打开聊天后可用）
    const cmdBar = document.createElement('div');
    cmdBar.style.cssText = 'position:fixed;left:8px;bottom:50px;z-index:99999;display:none;gap:6px;';
    for (const [label, cmd] of [['🎁 送礼', '/give '], ['❤️ 好感', '/fav '], ['💍 关系', '/bind '], ['📜 任务', '/task'], ['❓ 帮助', '/help']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'border:1px solid #777;border-radius:6px;background:rgba(38,44,52,.9);color:#ffd97a;cursor:pointer;font:12px "Microsoft YaHei",sans-serif;padding:3px 8px;';
      b.onclick = () => { input.value = cmd; input.focus(); };
      cmdBar.appendChild(b);
    }
    document.body.appendChild(cmdBar);
    function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    window.__AF_CHAT_ADD__ = (n, t) => addLine('<span class="af-nick">' + esc(n) + '</span>: ' + esc(t));
  }
  function sendChat(text) { if (connected) ws.send(JSON.stringify({ t: 'chat', text })); }
  function onChat(n, t) { if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__(n, t); }

  // ---------- 玩家间社交（对话/送礼/好感/关系/任务） ----------
  // 聊天命令：/give 昵称 物品id 数量 · /fav 昵称 · /bind 昵称 friend|confidant|partner
  //           /unbind 昵称 · /tp 昵称（伴侣）· /task
  function sendSocial(social, payload) { if (connected) ws.send(JSON.stringify(Object.assign({ t: 'social_' + social }, payload))); }
  function onSocialIn(msg) {
    try {
      if (!window.__AF_CHAT_ADD__) return;
      if (msg.social === 'talk') window.__AF_CHAT_ADD__(msg.nick + ' 对你说', '“' + msg.text + '”（好感 +2，点他名字可回复）');
      else if (msg.social === 'give') window.__AF_CHAT_ADD__(msg.nick, '送给你 ' + msg.num + ' 个礼物（物品 ' + msg.itemId + '）！你对 TA 的好感 +' + (msg.fav || ''));
      else if (msg.social === 'bind') window.__AF_CHAT_ADD__('系统', '💍 ' + msg.nick + ' 想和你结为「' + msg.relName + '」！');
    } catch (e) {}
  }
  function onSocialResult(msg) {
    try {
      if (!window.__AF_CHAT_ADD__) return;
      if (msg.social === 'fav') window.__AF_CHAT_ADD__('系统', msg.msg);
      else window.__AF_CHAT_ADD__('系统', (msg.ok ? '✅ ' : '❌ ') + msg.msg);
    } catch (e) {}
  }
  let taskPanelTasks = null;
  function onTaskList(msg) {
    taskPanelTasks = msg.tasks || [];
    const box = document.getElementById('af-task-list');
    if (!box) return;
    box.innerHTML = '';
    for (const t of taskPanelTasks) {
      const row = document.createElement('div');
      row.className = 'tl-it' + (t.done ? ' done' : '');
      row.innerHTML = '<b>' + (t.done ? '✔ ' : '') + t.name + '</b> <span class="tl-desc">' + (t.desc || '') + '</span>' +
        '<span class="tl-prog">' + (t.done ? '已完成' : t.cur + '/' + t.total) + '</span>' +
        (t.reward ? '<span class="tl-reward">奖励：' + t.reward + '</span>' : '');
      box.appendChild(row);
    }
  }
  function refreshTasks() { if (connected) ws.send(JSON.stringify({ t: 'task_list' })); }
  // 聊天命令解析（/give 等）
  function runSocialCommand(text) {
    const parts = text.slice(1).trim().split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const a = (i) => parts[i + 1] || '';
    switch (cmd) {
      case 'talk': {
        const target = a(0);
        const rest = parts.slice(2).join(' ');
        if (!target || !rest) { if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '用法：/talk 昵称 想说的话'); return true; }
        sendSocial('talk', { target, text: rest });
        return true;
      }
      case 'give': {
        const target = a(0), itemId = Number(a(1)), num = Number(a(2) || 1);
        if (!target || !itemId) { if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '用法：/give 昵称 物品id 数量（物品 id 见背包，如 18=木材）'); return true; }
        sendSocial('give', { target, itemId, num });
        return true;
      }
      case 'fav': {
        const target = a(0);
        if (!target) { if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '用法：/fav 昵称'); return true; }
        sendSocial('fav', { target });
        return true;
      }
      case 'bind': {
        const target = a(0), type = a(1) || 'friend';
        if (!target) { if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '用法：/bind 昵称 friend|confidant|partner（需要好感：好友30/知己60/伴侣90）'); return true; }
        sendSocial('bind', { target, type });
        return true;
      }
      case 'unbind': {
        const target = a(0);
        if (!target) return true;
        sendSocial('unbind', { target });
        return true;
      }
      case 'tp': {
        const target = a(0);
        if (!target) { if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '用法：/tp 昵称（伴侣传送）'); return true; }
        sendSocial('tp', { target });
        return true;
      }
      case 'task': {
        refreshTasks();
        const box = document.getElementById('af-task-list');
        if (box) {
          const panel = document.getElementById('af-task-panel');
          if (panel) panel.style.display = 'flex';
        }
        return true;
      }
      case 'help': {
        if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '命令：/give 昵称 物品id 数量 · /fav 昵称 · /bind 昵称 关系 · /tp 昵称 · /task · 对话请点对方角色');
        return true;
      }
    }
    return false;
  }

  // ---------- Agent 日记查看 UI（只读，美化面板） ----------
  function injectDiaryUI() {
    if (document.getElementById('af-diary-btn')) return;
    const css = document.createElement('style');
    css.textContent = `
      #af-diary-btn { position: fixed; top: 86px; right: 10px; z-index: 99990; cursor: pointer;
        background: rgba(38,44,52,.9); color: #ffd97a; border: 1px solid #5a6b3a; border-radius: 6px;
        padding: 5px 10px; font: 13px "Microsoft YaHei", sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.4); }
      #af-diary-btn:hover { background: rgba(52,60,70,.95); }
      #af-diary { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 100000;
        width: 680px; max-width: 94vw; height: 440px; display: none; flex-direction: column;
        background: linear-gradient(180deg,#2c3138,#20242a); border: 2px solid #7a6a4a; border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,.7), inset 0 0 0 1px #3a4450; font: 13px "Microsoft YaHei", sans-serif; }
      #af-diary .hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;
        border-bottom: 1px solid #3a4450; }
      #af-diary .hd b { color: #ffd97a; font-size: 15px; }
      #af-diary .hd .x { cursor: pointer; color: #9aa4b0; font-size: 16px; padding: 0 6px; }
      #af-diary .hd .x:hover { color: #ff7a7a; }
      #af-diary .bd { display: flex; flex: 1; min-height: 0; }
      #af-diary .list { width: 170px; border-right: 1px solid #3a4450; overflow-y: auto; padding: 8px 0; }
      #af-diary .list .it { padding: 7px 14px; color: #c8d0da; cursor: pointer; border-left: 3px solid transparent; }
      #af-diary .list .it:hover { background: rgba(255,217,122,.08); }
      #af-diary .list .it.on { background: rgba(255,217,122,.14); border-left-color: #ffd97a; color: #ffd97a; }
      #af-diary .content { flex: 1; overflow-y: auto; padding: 14px 18px; color: #dde3ea; line-height: 1.7; white-space: pre-wrap; }
      #af-diary .empty { color: #6b7684; text-align: center; margin-top: 60px; }
      #af-diary .foot { padding: 6px 14px; border-top: 1px solid #3a4450; color: #6b7684; font-size: 11px; }
    `;
    document.head.appendChild(css);
    const btn = document.createElement('div');
    btn.id = 'af-diary-btn';
    btn.textContent = '📖 日记';
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'af-diary';
    panel.innerHTML = `
      <div class="hd"><b>📖 Agent 日记</b><span class="x" id="af-diary-x">✕</span></div>
      <div class="bd">
        <div class="list" id="af-diary-list"></div>
        <div class="content" id="af-diary-content"><div class="empty">加载中…</div></div>
      </div>
      <div class="foot">Agent 每天（游戏时间）写一篇日记；这里只读查看。</div>`;
    document.body.appendChild(panel);

    const list = panel.querySelector('#af-diary-list');
    const content = panel.querySelector('#af-diary-content');
    let days = [];

    async function open() {
      panel.style.display = 'flex';
      content.innerHTML = '<div class="empty">加载中…</div>';
      try {
        const r = await fetch(SERVER + '/af/diary?token=' + encodeURIComponent(token));
        const data = await r.json();
        days = data.days || [];
        list.innerHTML = '';
        if (!days.length) {
          content.innerHTML = '<div class="empty">还没有日记。<br>Agent 每天结束时会写一篇，明天来看吧。</div>';
          return;
        }
        days.forEach((d, i) => {
          const it = document.createElement('div');
          it.className = 'it' + (i === 0 ? ' on' : '');
          it.textContent = d.title;
          it.onclick = () => {
            list.querySelectorAll('.it').forEach(x => x.classList.remove('on'));
            it.classList.add('on');
            content.textContent = d.content;
          };
          list.appendChild(it);
        });
        content.textContent = days[0].content;
      } catch (e) {
        content.innerHTML = '<div class="empty">日记加载失败：' + (e.message || '网络错误') + '</div>';
      }
    }
    function close() { panel.style.display = 'none'; }
    btn.onclick = open;
    panel.querySelector('#af-diary-x').onclick = close;
  }

  // ---------- 画面截图上传（多模态 agent 的眼睛；30s 节流） ----------
  let lastShotAt = 0;
  function uploadShot() {
    try {
      const canvas = document.getElementById('GameCanvas');
      if (!canvas) return;
      const now = Date.now();
      if (now - lastShotAt < 30000) return;
      lastShotAt = now;
      const dataUrl = canvas.toDataURL('image/png');
      const b64 = dataUrl.split(',')[1];
      fetch(SERVER + '/af/upload-shot', { method: 'POST', body: b64 }).catch(() => {});
    } catch (e) {}
  }

  // ---------- Agent 指挥 UI（📮 实时指挥 + ⏸ 打断 + ▶ 恢复 + 🤖 托管中状态） ----------
  function injectAgentUI() {
    if (document.getElementById('af-agent-btn')) return;
    const css = document.createElement('style');
    css.textContent = `
      #af-agent-btn, #af-interrupt-btn, #af-resume-btn { position: fixed; right: 10px; z-index: 99990; cursor: pointer;
        background: rgba(38,44,52,.9); color: #ffd97a; border: 1px solid #5a6b3a; border-radius: 6px;
        padding: 5px 10px; font: 13px "Microsoft YaHei", sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.4); }
      #af-agent-btn { top: 46px; }
      #af-interrupt-btn { top: 126px; color: #ff9a7a; border-color: #6b4a3a; }
      #af-resume-btn { top: 126px; right: 88px; color: #8ad97a; border-color: #3a6b4a; }
      #af-agent-btn:hover, #af-interrupt-btn:hover, #af-resume-btn:hover { background: rgba(52,60,70,.95); }
      #af-agent-status { position: fixed; top: 166px; right: 10px; z-index: 99990; cursor: default;
        padding: 5px 12px; border-radius: 6px; font: 12px "Microsoft YaHei", sans-serif;
        box-shadow: 0 2px 6px rgba(0,0,0,.4); }
      #af-agent-status.on { background: rgba(26,52,34,.92); color: #9ae87a; border: 1px solid #3a7a4a; }
      #af-agent-status.off { background: rgba(38,44,52,.92); color: #7a8490; border: 1px solid #3a4450; }
      #af-agent { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 100000;
        width: 420px; max-width: 92vw; display: none; flex-direction: column;
        background: linear-gradient(180deg,#2c3138,#20242a); border: 2px solid #7a6a4a; border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,.7); font: 13px "Microsoft YaHei", sans-serif; }
      #af-agent .hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #3a4450; }
      #af-agent .hd b { color: #ffd97a; font-size: 15px; }
      #af-agent .hd .x { cursor: pointer; color: #9aa4b0; font-size: 16px; padding: 0 6px; }
      #af-agent .hd .x:hover { color: #ff7a7a; }
      #af-agent .bd { padding: 12px 14px; color: #c8d0da; line-height: 1.7; }
      #af-agent .bd p { margin: 0 0 10px; color: #9aa4b0; font-size: 12px; }
      #af-agent textarea { width: 100%; box-sizing: border-box; height: 64px; resize: none; padding: 8px 10px;
        background: #1a1f26; color: #eee; border: 1px solid #3a4450; border-radius: 6px;
        font: 13px "Microsoft YaHei", sans-serif; outline: none; }
      #af-agent .row { display: flex; gap: 8px; margin-top: 10px; }
      #af-agent .btn { flex: 1; padding: 8px; border: 0; border-radius: 6px; font-size: 14px; cursor: pointer; }
      #af-agent .btn-primary { background: #e0a63c; color: #1a1f26; font-weight: bold; }
      #af-agent .btn-primary:hover { background: #f0b64c; }
      #af-agent .tip { margin-top: 10px; color: #6b7684; font-size: 11px; }
    `;
    document.head.appendChild(css);
    const btn = document.createElement('div');
    btn.id = 'af-agent-btn';
    btn.textContent = '📮 指挥';
    btn.title = '给 Agent 发指挥消息（不打断它当前行动）';
    const intBtn = document.createElement('div');
    intBtn.id = 'af-interrupt-btn';
    intBtn.textContent = '⏸ 打断';
    intBtn.title = '立即打断 Agent 当前行动（等同你在游戏里操作）';
    const resBtn = document.createElement('div');
    resBtn.id = 'af-resume-btn';
    resBtn.textContent = '▶ 恢复';
    resBtn.title = '让 Agent 恢复之前的行动';
    const status = document.createElement('div');
    status.id = 'af-agent-status';
    status.className = 'off';
    status.textContent = '🤖 Agent 未连接';
    document.body.appendChild(btn);
    document.body.appendChild(intBtn);
    document.body.appendChild(resBtn);
    document.body.appendChild(status);

    // 托管状态更新（agent_status 推送 / 轮询兜底）
    let agentOnline = false, agentNick = '', agentActivity = '';
    window.addEventListener('keydown', (e) => {
      if (!agentOnline || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
    function updateAgentStatus(online, nick) {
      agentOnline = online;
      hostedAgentOnline = online;
      if (!online && agentStopTimer) { clearTimeout(agentStopTimer); agentStopTimer = null; }
      const toggle = document.getElementById('af-agent-toggle');
      if (toggle) toggle.textContent = online ? '停止托管' : '启动托管';
      if (nick) agentNick = nick;
      const st = document.getElementById('af-agent-status');
      if (st) {
        if (online) {
          st.textContent = '🤖 托管中' + (agentNick ? ' · ' + agentNick : '') + (agentActivity ? ' · ' + agentActivity : '');
          st.className = 'on';
        } else {
          st.textContent = '🤖 Agent 未连接';
          st.className = 'off';
        }
      }
      intBtn.style.display = online ? 'block' : 'none';
      resBtn.style.display = online ? 'block' : 'none';
    }
    // 轮询兜底（WS 推送丢失时）
    setInterval(() => {
      fetch(SERVER + '/af/agent-status?token=' + encodeURIComponent(token))
        .then(r => r.json())
        .then(d => { if (d && typeof d.online === 'boolean') updateAgentStatus(d.online, d.nick); })
        .catch(() => {});
    }, 10000);

    const panel = document.createElement('div');
    panel.id = 'af-agent';
    panel.innerHTML = `
      <div class="hd"><b>📮 指挥我的 Agent</b><span class="x" id="af-agent-x">✕</span></div>
      <div class="bd">
        <p>消息会送进 Agent 的收件箱。<b>不打断</b>它当前行动——它做完手头的事（或告一段落）就会回应。任务型指令（去钓鱼/种地/买东西）它会尽量完成。</p>
        <textarea id="af-agent-input" placeholder="例：去河边钓一条鱼回来 / 去杂货店买 2 个小麦种子"></textarea>
        <div class="row">
          <button class="btn" id="af-agent-toggle">启动托管</button>
          <button class="btn btn-primary" id="af-agent-send">发送指挥</button>
        </div>
        <div class="row" id="af-agent-model-row">
          <button class="btn" id="af-agent-model-btn">🤖 模型设置</button>
          <span class="tip" id="af-agent-model-state"></span>
        </div>
        <div id="af-agent-model-form" style="display:none;margin-top:10px;border-top:1px solid #3a4450;padding-top:10px;">
          <p>配置 Agent 大脑的 LLM（OpenAI 兼容接口）。配置保存在房间服务器，一次配好全房间托管都能用。</p>
          <input id="af-model-url" placeholder="API 地址，如 https://opencode.ai/zen/go/v1" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:7px 9px;background:#1a1f26;color:#eee;border:1px solid #3a4450;border-radius:6px;font:13px 'Microsoft YaHei',sans-serif;outline:none;">
          <input id="af-model-key" placeholder="API Key（已配置时留空则保留）" type="password" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:7px 9px;background:#1a1f26;color:#eee;border:1px solid #3a4450;border-radius:6px;font:13px 'Microsoft YaHei',sans-serif;outline:none;">
          <input id="af-model-name" placeholder="模型名，如 deepseek-v4-flash" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:7px 9px;background:#1a1f26;color:#eee;border:1px solid #3a4450;border-radius:6px;font:13px 'Microsoft YaHei',sans-serif;outline:none;">
          <div class="row">
            <button class="btn btn-primary" id="af-model-save">保存模型配置</button>
          </div>
        </div>
        <div class="tip">Agent 的回复会出现在左下角聊天框（带 Agent 标记）。⏸ 打断会立即停下它；▶ 恢复让它继续原计划；右上角状态条显示托管中。</div>
      </div>`;
    document.body.appendChild(panel);
    const input = panel.querySelector('#af-agent-input');
    const sendBtn = panel.querySelector('#af-agent-send');
    const toggleBtn = panel.querySelector('#af-agent-toggle');
    const modelBtn = panel.querySelector('#af-agent-model-btn');
    const modelForm = panel.querySelector('#af-agent-model-form');
    const modelState = panel.querySelector('#af-agent-model-state');
    const modelSave = panel.querySelector('#af-model-save');
    // 模型配置：加载当前状态
    function loadProviderState() {
      fetch(SERVER + '/af/agent-provider?token=' + encodeURIComponent(token))
        .then(r => r.json())
        .then(d => {
          if (!d) return;
          modelState.textContent = d.url ? ('当前：' + d.url + ' / ' + d.model + (d.keySet ? '（已配 Key）' : '（无 Key）')) : '未配置（托管无法启动）';
          panel.querySelector('#af-model-url').value = d.url || '';
          panel.querySelector('#af-model-name').value = d.model || 'deepseek-v4-flash';
        })
        .catch(() => { modelState.textContent = '模型状态获取失败'; });
    }
    loadProviderState();
    modelBtn.onclick = () => { modelForm.style.display = modelForm.style.display === 'none' ? 'block' : 'none'; loadProviderState(); };
    modelSave.onclick = async () => {
      try {
        const body = {
          url: panel.querySelector('#af-model-url').value.trim(),
          model: panel.querySelector('#af-model-name').value.trim(),
          key: panel.querySelector('#af-model-key').value,
        };
        const r = await fetch(SERVER + '/af/agent-provider?token=' + encodeURIComponent(token), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const d = await r.json();
        const tip = modelForm.querySelector('.tip');
        if (d.ok) { modelState.textContent = '✓ ' + (d.msg || '已保存'); modelForm.style.display = 'none'; }
        else modelState.textContent = '保存失败：' + (d.msg || r.status);
      } catch (e) { modelState.textContent = '保存失败：' + e.message; }
    };
    function openPanel() { panel.style.display = 'flex'; input.focus(); }
    function closePanel() { panel.style.display = 'none'; }
    function sendMsg() {
      const t = input.value.trim();
      if (!t) return;
      if (connected) ws.send(JSON.stringify({ t: 'agent_msg', text: t }));
      else if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '尚未连接服务器，稍后再试');
      input.value = '';
      closePanel();
    }
    btn.onclick = openPanel;
    panel.querySelector('#af-agent-x').onclick = closePanel;
    sendBtn.onclick = sendMsg;
    toggleBtn.onclick = async () => {
      try {
        const r = await fetch(SERVER + '/af/agent-control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action: agentOnline ? 'stop' : 'start' }) });
        const d = await r.json();
        if (!d.ok) throw new Error(d.msg || '操作失败');
        toggleBtn.textContent = agentOnline ? '启动托管' : '停止托管';
      } catch (e) { if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', e.message || '托管操作失败'); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
    intBtn.onclick = () => {
      if (connected) ws.send(JSON.stringify({ t: 'agent_interrupt' }));
      if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '已发送打断指令');
    };
    resBtn.onclick = () => {
      if (connected) ws.send(JSON.stringify({ t: 'agent_resume' }));
      if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '已发送恢复指令');
    };
    window.__AF_AGENT_STATUS__ = updateAgentStatus;
    updateAgentStatus(false);
  }

  // ---------- 游戏内小地图 → 扩展版（133×117，含 7 个新宅基地） ----------
  // 原版 LittleMap(UiMap) 的 village 节点只是标记定位容器（底图画在 pnlContent 羊皮纸总览里），
  // 玩家/NPC 标记按 plant json 尺寸（已扩到 133×117）映射到 village 节点坐标 → 只需在 village
  // 下垫一张自绘扩展版底图（zIndex 低于标记），标记位置自动正确。
  // 修复：①缓存 mapgrid 数据 + SpriteFrame，village 出现时同步贴图（零闪现）
  //        ②原版区（LEFT/TOP 内）留透明，透出 pnlContent 原版羊皮纸美术
  //        ③删除中央金点（原版羊皮纸自带村子图标）
  //        ④cw/ch 首帧确定后固定，避免重复计算导致纹理尺寸抖动
  let mapGridCache = null, mapFrameCache = null, mapImgDone = false;
  let mapGridSize = null; // 记录首次画布尺寸，后续复用避免尺寸抖动
  // 登录后预热：立即 fetch mapgrid，village 出现时直接同步贴（零网络延迟）
  function prewarmVillageMap() {
    fetch(SERVER + '/af/mapgrid?token=' + encodeURIComponent(token))
      .then(r => r.json())
      .then((g) => {
        if (!g || !g.W) return;
        mapGridCache = g;
        // 若 injectVillageMap 已执行过（mapImgDone=true），跳过，避免竞态覆盖
        if (mapImgDone) return;
        // 若 village 已存在，立即画；否则等 injectVillageMap 首次触发时缓存已就绪
        const scene = cc.director && cc.director.getScene();
        if (!scene) return;
        let village = null;
        scene.walk(n => { if (!village && n.name === 'village' && n.parent && n.parent.name === 'pnlContent') village = n; });
        if (!village || !village.activeInHierarchy) return;
        const cw = Math.max(16, Math.round(village.width));
        const ch = Math.max(16, Math.round(village.height));
        drawAndCache(g, cw, ch, village);
      })
      .catch(() => {});
  }
  function injectVillageMap() {
    try {
      const scene = cc.director && cc.director.getScene();
      if (!scene) return;
      let village = null;
      scene.walk(n => { if (!village && n.name === 'village' && n.parent && n.parent.name === 'pnlContent') village = n; });
      if (!village || !village.activeInHierarchy) { mapImgDone = false; return; }
      // 有缓存数据 → 同步贴图（零网络延迟）
      if (mapGridCache) {
        const cw = (mapGridSize && mapGridSize.w) ? mapGridSize.w : Math.max(16, Math.round(village.width));
        const ch = (mapGridSize && mapGridSize.h) ? mapGridSize.h : Math.max(16, Math.round(village.height));
        if (!mapGridSize) mapGridSize = { w: cw, h: ch };
        let bg = village.getChildByName('afMapBg');
        if (!bg) {
          bg = new cc.Node('afMapBg');
          bg.addComponent(cc.Sprite);
          village.addChild(bg, -1);
        }
        const sprite = bg.getComponent(cc.Sprite);
        if (mapFrameCache) {
          // Texture2D 已就绪，直接应用缓存帧
          sprite.spriteFrame = mapFrameCache;
        } else {
          // 首次：mapGridCache 已就绪但 Texture2D 还在异步加载，同步画 canvas 立即贴上
          // （与 drawAndCache 同逻辑，避免首次打开时短暂闪原版）
          const cv = document.createElement('canvas');
          cv.width = cw; cv.height = ch;
          const ctx = cv.getContext('2d');
          const g = mapGridCache;
          const sx = cw / g.W, sy = ch / g.H;
          const fill = (x, y, style) => { ctx.fillStyle = style; ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.ceil(sx) + 1, Math.ceil(sy) + 1); };
          for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
            const inOrig = x >= g.LEFT && x < g.LEFT + g.origW && y >= g.TOP && y < g.TOP + g.origH;
            if (inOrig) continue;
            const i = y * g.W + x;
            if (g.water[i]) fill(x, y, '#8fb0d8');
            else if (g.blocked && g.blocked[i]) fill(x, y, '#b5a06e');
          }
          for (const h of (g.houses || [])) {
            const inOrig = h.x >= g.LEFT && h.x + h.w <= g.LEFT + g.origW && h.y >= g.TOP && h.y + h.h <= g.TOP + g.origH;
            if (inOrig) continue;
            ctx.strokeStyle = '#9a7428';
            ctx.lineWidth = Math.max(1, Math.round(cw / 220));
            ctx.strokeRect(h.x * sx + 1, h.y * sy + 1, h.w * sx - 2, h.h * sy - 2);
          }
          const tex = new cc.Texture2D();
          tex.initWithElement(cv);
          tex.handleLoadedTexture();
          const sf = new cc.SpriteFrame(tex);
          sf.setRect(new cc.Rect(0, 0, cw, ch));
          mapFrameCache = sf;
          sprite.spriteFrame = sf;
        }
        sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        bg.width = cw; bg.height = ch;
        mapImgDone = true;
        // 异步刷新缓存（宅基地变化时更新，不阻塞当前显示）
        if (!injectVillageMap._refreshing) {
          injectVillageMap._refreshing = true;
          fetch(SERVER + '/af/mapgrid?token=' + encodeURIComponent(token))
            .then(r => r.json())
            .then((g) => {
              if (g && g.W) drawAndCache(g, cw, ch, village);
            })
            .catch(() => {})
            .finally(() => { injectVillageMap._refreshing = false; });
        }
        return;
      }
      // 首次：fetch + 绘制 + 缓存（village 出现后立即发起，缓存后下次打开零等待）
      mapImgDone = false;
      fetch(SERVER + '/af/mapgrid?token=' + encodeURIComponent(token))
        .then(r => r.json())
        .then((g) => {
          if (!g || !g.W) return;
          const cw = Math.max(16, Math.round(village.width));
          const ch = Math.max(16, Math.round(village.height));
          drawAndCache(g, cw, ch, village);
        })
        .catch((e) => console.warn('[AF] 小地图更新失败:', e.message));
    } catch (e) { /* 静默 */ }
  }
  function drawAndCache(g, cw, ch, village) {
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d');
    const sx = cw / g.W, sy = ch / g.H;
    const fill = (x, y, style) => { ctx.fillStyle = style; ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.ceil(sx) + 1, Math.ceil(sy) + 1); };
    // 只画扩展区（LEFT/TOP 偏移外）：水 + 障碍 + 宅基地描边
    // 原版区（LEFT/TOP 起 origW×origH）留透明，透出 pnlContent 原版羊皮纸美术
    for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
      const inOrig = x >= g.LEFT && x < g.LEFT + g.origW && y >= g.TOP && y < g.TOP + g.origH;
      if (inOrig) continue; // 原版区透明，透底
      const i = y * g.W + x;
      if (g.water[i]) fill(x, y, '#8fb0d8');
      else if (g.blocked && g.blocked[i]) fill(x, y, '#b5a06e');
    }
    // 宅基地描边（只在扩展区画）
    for (const h of (g.houses || [])) {
      const inOrig = h.x >= g.LEFT && h.x + h.w <= g.LEFT + g.origW && h.y >= g.TOP && h.y + h.h <= g.TOP + g.origH;
      if (inOrig) continue;
      ctx.strokeStyle = '#9a7428';
      ctx.lineWidth = Math.max(1, Math.round(cw / 220));
      ctx.strokeRect(h.x * sx + 1, h.y * sy + 1, h.w * sx - 2, h.h * sy - 2);
    }
    const tex = new cc.Texture2D();
    tex.initWithElement(cv);
    tex.handleLoadedTexture();
    const sf = new cc.SpriteFrame(tex);
    sf.setRect(new cc.Rect(0, 0, cw, ch));
    mapGridCache = g;
    mapFrameCache = sf;
    // 立即贴上
    let bg = village.getChildByName('afMapBg');
    if (!bg) {
      bg = new cc.Node('afMapBg');
      bg.addComponent(cc.Sprite);
      village.addChild(bg, -1);
    }
    const sprite = bg.getComponent(cc.Sprite);
    sprite.spriteFrame = sf;
    sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
    bg.width = cw; bg.height = ch;
    mapImgDone = true;
    console.log('[AF] 村庄小地图底图已更新为扩展版 (' + g.W + 'x' + g.H + ')，原版区透明透出羊皮纸美术');
  }

  // ---------- 玩家间社交 UI（点击对方角色：对话/送礼/好感/关系；📜 任务面板） ----------
  function injectSocialUI() {
    if (document.getElementById('af-task-btn')) return;
    const css = document.createElement('style');
    css.textContent = `
      #af-task-btn { position: fixed; top: 46px; left: 10px; z-index: 99990; cursor: pointer;
        background: rgba(38,44,52,.9); color: #ffd97a; border: 1px solid #5a6b3a; border-radius: 6px;
        padding: 5px 10px; font: 13px "Microsoft YaHei", sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.4); }
      #af-task-btn:hover { background: rgba(52,60,70,.95); }
      #af-task-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 100000;
        width: 460px; max-width: 94vw; display: none; flex-direction: column;
        background: linear-gradient(180deg,#2c3138,#20242a); border: 2px solid #7a6a4a; border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,.7); font: 13px "Microsoft YaHei", sans-serif; }
      #af-task-panel .hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #3a4450; }
      #af-task-panel .hd b { color: #ffd97a; font-size: 15px; }
      #af-task-panel .hd .x { cursor: pointer; color: #9aa4b0; font-size: 16px; padding: 0 6px; }
      #af-task-list { padding: 10px 14px; max-height: 380px; overflow-y: auto; }
      #af-task-list .tl-it { padding: 8px 10px; margin-bottom: 6px; background: rgba(255,255,255,.04); border-radius: 6px; border-left: 3px solid #7a6a4a; }
      #af-task-list .tl-it.done { opacity: .55; border-left-color: #5a8a4a; }
      #af-task-list .tl-it b { color: #e8e0cc; }
      #af-task-list .tl-desc { color: #8a94a0; font-size: 11px; margin-left: 6px; }
      #af-task-list .tl-prog { float: right; color: #ffd97a; }
      #af-task-list .tl-reward { display: block; color: #8fae6a; font-size: 11px; margin-top: 3px; }
      #af-social-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 100000;
        width: 360px; max-width: 92vw; display: none; flex-direction: column;
        background: linear-gradient(180deg,#2c3138,#20242a); border: 2px solid #7a6a4a; border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,.7); font: 13px "Microsoft YaHei", sans-serif; }
      #af-social-panel .hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #3a4450; }
      #af-social-panel .hd b { color: #ffd97a; font-size: 15px; }
      #af-social-panel .hd .x { cursor: pointer; color: #9aa4b0; font-size: 16px; padding: 0 6px; }
      #af-social-panel .bd { padding: 12px 14px; color: #c8d0da; }
      #af-social-panel input, #af-social-panel select { width: 100%; box-sizing: border-box; margin-bottom: 8px; padding: 7px 9px;
        background: #1a1f26; color: #eee; border: 1px solid #3a4450; border-radius: 6px; font: 13px "Microsoft YaHei", sans-serif; outline: none; }
      #af-social-panel .row { display: flex; gap: 8px; margin-bottom: 8px; }
      #af-social-panel .btn { flex: 1; padding: 8px; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; color: #1a1f26; }
      #af-social-panel .btn-g { background: #e0a63c; }
      #af-social-panel .btn-b { background: #4a6a8a; color: #eee; }
      #af-social-panel .st { color: #8a94a0; font-size: 12px; min-height: 16px; }
    `;
    document.head.appendChild(css);
    // 📜 任务按钮 + 面板
    const tbtn = document.createElement('div');
    tbtn.id = 'af-task-btn';
    tbtn.textContent = '📜 任务';
    document.body.appendChild(tbtn);
    const tpanel = document.createElement('div');
    tpanel.id = 'af-task-panel';
    tpanel.innerHTML = '<div class="hd"><b>📜 任务书</b><span class="x" id="af-task-x">✕</span></div><div id="af-task-list"><div style="color:#6b7684">加载中…</div></div>';
    document.body.appendChild(tpanel);
    tbtn.onclick = () => { tpanel.style.display = 'flex'; refreshTasks(); };
    tpanel.querySelector('#af-task-x').onclick = () => { tpanel.style.display = 'none'; };
    // 点击玩家交互面板
    const spanel = document.createElement('div');
    spanel.id = 'af-social-panel';
    spanel.innerHTML = `
      <div class="hd"><b id="af-sp-name">玩家</b><span class="x" id="af-sp-x">✕</span></div>
      <div class="bd">
        <div class="st" id="af-sp-state"></div>
        <input id="af-sp-talk" placeholder="💬 说点什么（近距离，好感 +2）">
        <div class="row">
          <button class="btn btn-g" id="af-sp-send">发送对话</button>
          <button class="btn btn-b" id="af-sp-fav">❤️ 好感</button>
        </div>
        <input id="af-sp-give" placeholder="🎁 送礼：物品id 数量（如 18 2，送木材×2）">
        <div class="row">
          <select id="af-sp-rel">
            <option value="friend">好友（好感30）</option>
            <option value="confidant">知己（好感60）</option>
            <option value="partner">伴侣（好感90）</option>
          </select>
          <button class="btn btn-b" id="af-sp-bind">💍 绑定</button>
          <button class="btn btn-b" id="af-sp-tp">✨ 传送</button>
        </div>
      </div>`;
    document.body.appendChild(spanel);
    let spTarget = null;
    window.__AF_OPEN_SOCIAL__ = (uid2, nick) => {
      spTarget = uid2;
      spanel.querySelector('#af-sp-name').textContent = '与 ' + nick + ' 互动';
      spanel.querySelector('#af-sp-state').textContent = '点 ❤️ 查看好感；/give 可送任意物品';
      spanel.querySelector('#af-sp-talk').value = '';
      spanel.querySelector('#af-sp-give').value = '';
      spanel.style.display = 'flex';
    };
    spanel.querySelector('#af-sp-x').onclick = () => { spanel.style.display = 'none'; };
    spanel.querySelector('#af-sp-send').onclick = () => {
      const t = spanel.querySelector('#af-sp-talk').value.trim();
      if (t && spTarget) { sendSocial('talk', { target: spTarget, text: t }); spanel.querySelector('#af-sp-talk').value = ''; }
    };
    spanel.querySelector('#af-sp-fav').onclick = () => { if (spTarget) sendSocial('fav', { target: spTarget }); };
    spanel.querySelector('#af-sp-give').onkeydown = (e) => {
      if (e.key === 'Enter') {
        const m = /(\d+)\s*(\d*)/.exec(spanel.querySelector('#af-sp-give').value.trim());
        if (m && spTarget) { sendSocial('give', { target: spTarget, itemId: Number(m[1]), num: Number(m[2] || 1) }); spanel.querySelector('#af-sp-give').value = ''; }
      }
    };
    spanel.querySelector('#af-sp-bind').onclick = () => { if (spTarget) sendSocial('bind', { target: spTarget, type: spanel.querySelector('#af-sp-rel').value }); };
    spanel.querySelector('#af-sp-tp').onclick = () => { if (spTarget) sendSocial('tp', { target: spTarget }); };
  }
  function openSocialPanel(uid2) {
    try {
      if (!window.__AF_OPEN_SOCIAL__) return;
      const p = remotePlayers.get(uid2);
      window.__AF_OPEN_SOCIAL__(uid2, p ? p.nick : uid2);
    } catch (e) {}
  }

  // ---------- 隐藏原版多存档槽（只留槽位 1 作为唯一入口） ----------
  function hideExtraSlots() {
    try {
      const scene = cc.director && cc.director.getScene();
      if (!scene) return;
      const canvas = scene.getChildByName('Canvas');
      if (!canvas) return;
      let uiStorage = null;
      canvas.walk(n => { if (!uiStorage && n.name === 'UiStorage') uiStorage = n; });
      if (!uiStorage) return;
      const pnl = uiStorage.getChildByName('pnlContent');
      if (!pnl) return;
      ['storageItem2', 'storageItem3'].forEach(name => {
        const it = pnl.getChildByName(name);
        if (it && it.active) { it.active = false; console.log('[AF] 已隐藏存档槽', name); }
      });
    } catch (e) {}
  }

  window.__AF__ = { uid, nick, get remotePlayers() { return remotePlayers; } };
  console.log('[AF] AgentFarm2 注入层就绪 uid=' + uid + ' nick=' + nick + ' sync=' + syncReady);

  tryAutoLogin(); // 启动流程：自动登录或弹登录框（放在所有定义之后）

  // ★ 区域名兜底定时器：每 500ms 强制覆盖，防止原版代码在 mod 之前写入旧名
  setInterval(() => { try { injectAreaName(); } catch (e) {} }, 500);
})();
