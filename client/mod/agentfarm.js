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
  // 朋友打开 https://你的域名 进游戏，无感连房主服。本地开发/内网才需手动改地址。
  // 静态资源可来自任意来源（本地启动器/房主/CDN），API+WS 连这里填的房间服务器。
  let SERVER = window.__AF_SERVER__ || (typeof localStorage !== 'undefined' && localStorage.getItem('af_server'))
    || ((location.protocol === 'https:' ? 'https://' : 'http://') + (location.hostname || '127.0.0.1') + (location.port ? ':' + location.port : ''));
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
      toast('已进入游戏 · ' + nick, 'ok');
    }
  }

  // 登录界面（联机大厅：选模式 → 选存档/输地址 → 账号登录）
  function showLoginUI(msg) {
    if (document.getElementById('af-login')) return;
    const css = document.createElement('style');
    css.textContent = `
      #af-login { position: fixed; inset: 0; z-index: 200000; display: flex; align-items: center; justify-content: center;
        background: var(--af-c-glass-bg-deep); font: 14px "Microsoft YaHei", sans-serif; }
      #af-login .box { width: 460px; max-width: 92vw; box-sizing: border-box; background: var(--af-c-panel-deep); border: 1px solid var(--af-c-panel);
        border-radius: 12px; padding: 26px 26px; box-shadow: 0 12px 44px var(--af-c-black-60); }
      #af-login h2 { margin: 0 0 4px; color: var(--af-c-gold); font-size: 22px; letter-spacing: 1px; }
      #af-login p.sub, #af-login .sub { color: var(--af-c-text-dim); margin: 0 0 22px; font-size: 12px; line-height: 1.7; }
      #af-login .back { cursor: pointer; color: var(--af-c-text-dim); font-size: 12px; margin: 0 0 14px; display: inline-block; }
      #af-login .back:hover { color: var(--af-c-gold); }
      #af-login input { display: block; width: 100%; box-sizing: border-box; margin-bottom: 10px; padding: 8px 10px;
        background: var(--af-c-bg); color: var(--af-c-light-soft); border: 1px solid var(--af-c-panel); border-radius: 6px; outline: none; font-size: 14px; }
      #af-login .btn { width: 100%; padding: 12px; border: 0; border-radius: 8px; font-size: 15px; cursor: pointer;
        margin-bottom: 12px; box-sizing: border-box; }
      #af-login .btn:active { transform: translateY(1px); }
      #af-login .btn-host { background: linear-gradient(180deg,var(--af-c-amber),var(--af-c-amber)); color: var(--af-c-bg); font-weight: bold;
        font-size: 18px; padding: 16px; }
      #af-login .btn-host:hover { background: linear-gradient(180deg,var(--af-c-amber),var(--af-c-amber)); }
      #af-login .btn-join { background: var(--af-c-panel); color: var(--af-c-paper-hud); font-size: 18px; padding: 16px; }
      #af-login .btn-join:hover { background: var(--af-c-edge); }
      #af-login .btn-primary { background: var(--af-c-amber); color: var(--af-c-bg); font-weight: bold; }
      #af-login .btn-primary:hover { background: var(--af-c-amber); }
      #af-login .btn-ghost { background: transparent; color: var(--af-c-text-dim); border: 1px solid var(--af-c-panel); font-size: 14px; }
      #af-login .err { color: var(--af-c-danger); font-size: 12px; min-height: 16px; margin: 0 0 8px; }
      #af-login .foot-hint { color: var(--af-c-text-dim); font-size: 11px; margin-top: 4px; text-align: center; }
      #af-login .misc { color: var(--af-c-text-dim); font-size: 11px; margin-top: 14px; text-align: center; line-height: 1.7; }
      #af-login .saves { display: flex; flex-direction: column; gap: 10px; }
      #af-login .save { background: var(--af-c-bg); border: 1px solid var(--af-c-panel); border-radius: 8px; padding: 12px 14px;
        cursor: pointer; text-align: left; }
      #af-login .save:hover { border-color: var(--af-c-gold); background: var(--af-c-panel-deep); }
      #af-login .save .sn { color: var(--af-c-gold); font-size: 15px; font-weight: bold; margin-bottom: 4px; }
      #af-login .save .sm { color: var(--af-c-text-dim); font-size: 12px; }
      #af-login .save .cur { color: var(--af-c-amber); font-size: 11px; margin-left: 6px; }
      #af-login .save.empty { opacity: .55; cursor: default; }
      #af-login .warn { color: var(--af-c-gold); font-size: 12px; margin: 0 0 8px; }
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
          <a class="back" data-act="back">← 返回</a>
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
      AFUNI.on(d.querySelector('#af-login-btn'), doAuth);
      d.querySelector('#af-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
      AFUNI.on(d.querySelector('#af-clear-btn'), () => {
        LS.removeItem('af_token'); LS.removeItem('af_uid'); LS.removeItem('af_nick');
        location.reload();
      });
      AFUNI.on(d.querySelector('[data-act="back"]'), viewMode, { cls: false });
      // 房间信息（穿透地址/房间码）：打到 SERVER 即房主服。容器部署（Fly/无隧道）
      // 下 tunnel/roomCode 为 null，整块隐藏；仅本地 localtunnel 隧道场景才显示。
      fetch(SERVER + '/af/room').then(r => r.json()).then(data => {
        if (!data || (!data.tunnelUrl && !data.roomCode)) return;
        const lines = [];
        if (data.tunnelUrl) lines.push(`<br>穿透地址：<span style="color:var(--af-c-gold);">${esc(data.tunnelUrl)}</span>`);
        if (data.roomCode) lines.push(`房间码：<span style="color:var(--af-c-text-dim);">${esc(data.roomCode)}</span>`);
        if (lines.length) {
          const el = d.querySelector('.misc');
          if (el) el.innerHTML += lines.join('');
        }
      }).catch(() => {});
    }



    // ---------- 第二步B：加入房间 → 房间码或地址 ----------
    function viewJoin() {
      setView(`
        <div class="box">
          <a class="back" data-act="back">← 返回</a>
          <h2>🚪 加入房间</h2>
          <p class="sub">输入房主给你的6位房间码，或直接输入地址</p>
          <input id="af-roomcode" placeholder="6位房间码（如 382915）" maxlength="6" style="text-align:center;font-size:24px;letter-spacing:8px;font-weight:bold;">
          <div style="text-align:center;color:var(--af-c-text-dim);font-size:12px;margin:8px 0">—— 或手动输入地址 ——</div>
          <input id="af-srv" placeholder="如 http://192.168.1.5:8080" value="${esc(SERVER)}" maxlength="120">
          <div class="err" id="af-err"></div>
          <button class="btn btn-primary" id="af-join-btn">连接</button>
          <div class="foot-hint">让房主告诉你他的房间码或地址。</div>
        </div>`);
      AFUNI.on(d.querySelector('[data-act="back"]'), viewMode, { cls: false });
      const codeInput = d.querySelector('#af-roomcode');
      const srvInput = d.querySelector('#af-srv');
      const errEl = d.querySelector('#af-err');
      const doJoin = async () => {
        // 优先用房间码（打到 SERVER 即房主服查 roomCodes）
        const code = codeInput.value.trim();
        if (code.length === 6 && /^\d+$/.test(code)) {
          try {
            const r = await fetch(SERVER + '/af/join-room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
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
      AFUNI.on(d.querySelector('#af-join-btn'), doJoin);
      srvInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
      codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
    }

    // ---------- 第一步：直接进登录（无感化：跟随页面域名自动连服，无需输地址）----------
    // 朋友打开 https://你的域名 → SERVER 自动 = 该域名 → API/WS 全指向它
    // 仅本地开发/内网场景才需要手动改地址（viewJoin 保留作备选）
    function viewMode() {
      setView(`
        <div class="box" style="text-align:center;">
          <h2>🏡 乡村狂想曲 · 联机版</h2>
          <p class="sub">点击下方登录或注册，直接进入游戏</p>
          <button class="btn btn-primary" id="af-enter-btn" style="width:100%;font-size:16px;">进入</button>
          <a class="back" id="af-join-link" style="display:inline-block;margin-top:12px;">🚪 手动连接其他房间</a>
          <div class="foot-hint">默认连接你当前打开的地址所在服务器</div>
        </div>`);
      AFUNI.on(d.querySelector('#af-enter-btn'), () => viewLogin(() => SERVER));
      AFUNI.on(d.querySelector('#af-join-link'), viewJoin, { cls: false });
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

  function injectHudUI() {
    // M2：四分区 HUD（TL 金币滚动 / TR 历法胶囊 / BR 托管状态）+ toast 统一入口（P3 隔离：AFUNI 缺失静默）
    let hud = null;
    try { hud = window.AFUNI && window.AFUNI.hud ? window.AFUNI.hud : null; } catch (e) {}
    if (!hud) return;
    hud.ensure();
    // TL 金币：读 LS 同步缓存 knapData（服务端 save_broadcast 已回灌），30s 轮询兜底
    const readCoins = () => {
      try {
        const raw = LS.getItem('knapData_100001');
        if (!raw) return 0;
        const kn = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const c = (kn && kn.props || []).find(p => p && p.id === 1);
        return c && Number.isFinite(c.num) ? Math.round(c.num) : 0;
      } catch (e) { return 0; }
    };
    try { hud.setCoins(readCoins()); setInterval(() => hud.setCoins(readCoins()), 30000); } catch (e) {}
    // BR 托管状态胶囊（承接原 #af-agent-status；agent_status 推送经 renderAgentStatus 双写）
    const brZone = hud.zone('br');
    if (brZone && !document.getElementById('af-hud-agent')) {
      const chip = document.createElement('div');
      chip.id = 'af-hud-agent';
      chip.className = 'af-hud-agent off';
      chip.style.cssText = 'display:inline-block;padding:4px 10px;';
      chip.textContent = '🤖 Agent 未连接';
      brZone.appendChild(chip);
    }
    window.__AF_HUD__ = hud;
  }

  function startNetwork() {
    connect();
    injectHudUI();
    injectChatUI();
    injectDiaryUI();
    injectAgentUI();
    injectSocialUI();
    injectDmUI();
  }

  // M2 toast 统一入口（AFUNI 缺失/异常静默降级；同屏上限 3 由 AFUNI 内建；M5：伴随 SFX）
  function toast(msg, type) {
    try {
      if (window.AFUNI && window.AFUNI.toast) window.AFUNI.toast(msg, type || 'info');
      if (window.AFAUD && window.AFAUD.play) {
        const cue = type === 'ok' ? 'ok' : type === 'err' ? 'err' : type === 'coin' ? 'coin' : 'click';
        window.AFAUD.play(cue);
      }
    } catch (e) {}
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
      toast('已连接 · ' + (nick || uid), 'ok');
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
          toast(msg.msg || '连接已被服务器断开，请刷新页面重新登录', 'err', 5000);
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
          if (msg.activity && window.__AF_AGENT_ACTIVITY__) {
            const waiting = msg.activity.includes('让位') || msg.activity.includes('停下') || msg.activity.includes('等你');
            window.__AF_AGENT_ACTIVITY__(msg.activity, waiting);
          }
          if (window.__AF_CHAT_ADD__ && msg.activity) window.__AF_CHAT_ADD__('Agent', msg.activity);
          break;
        }
        case 'agent_move': onAgentMove(msg); break;
        case 'agent_move_done': onAgentMoveDone(msg); break;
        case 'agent_status': if (window.__AF_AGENT_STATUS__) window.__AF_AGENT_STATUS__(!!msg.online, msg.nick); break;
        case 'npc_move': if (window.__AF_NPC_TICK__ && msg.npc) window.__AF_NPC_TICK__(msg.npc, msg.hour); break;
        case 'camera': if (window.__AF_CAM__) window.__AF_CAM__(msg.shot, msg.watch); break;
        case 'dm_in': onDmIn(msg); break;
        case 'dm_result': onDmResult(msg); break;
        case 'dm_log': onDmLog(msg); break;
        case 'dm_unlocked_list': onDmUnlockedList(msg); break;
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
      // D1 执行确认闭环：托管期间到达航点即回报实际落点（服务端校验/重规划）
      if (pos && connected && hostedAgentOnline && agentMoveTarget && !agentArriveSent) {
        const dx = Math.abs(pos.x - agentMoveTarget.x), dy = Math.abs(pos.y - agentMoveTarget.y);
        if (agentMoveTarget.scene === undefined || pos.scene === agentMoveTarget.scene) {
          if (dx <= 80 && dy <= 80) {
            agentArriveSent = true;
            try { ws.send(JSON.stringify({ t: 'agent_arrive', index: agentArriveIndex, x: pos.x, y: pos.y, scene: pos.scene })); } catch (e) {}
          }
        }
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
      try { injectVillageMap(); } catch (e) { console.warn('[AF] injectVillageMap err:', e.message); }
      try { injectMapLayerToggles(); } catch (e) { /* 图层开关注入失败不影响主流程 */ }
      try { injectMunicipalDecor(); } catch (e) { /* 装饰反射失败不影响主流程 */ }
      try { injectBuildingSigns(); } catch (e) { /* 招牌反射失败不影响主流程 */ }
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

  let agentMoveTarget = null; // {x,y,scene} 当前 agent 目标
  let agentArriveIndex = null, agentArriveSent = false; // D1 确认环：当前航点序号 + 已回报标记
  function clearAgentMoveState(item) {
    agentMoveTarget = null;
    agentArriveIndex = null;
    agentArriveSent = false;
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
    // D6 跨场景段：目标场景与当前不同 -> 走原版场景传送（changeSceneEasy + 门户 passage 名）
    const myScene = (() => {
      try {
        const PM = mods['PlayerMoudle'] && mods['PlayerMoudle'].exports;
        const p = PM && (PM._gPlayer || (PM.default && PM.default._gPlayer));
        return p ? p.getSceneType() : null;
      } catch (e) { return null; }
    })();
    if (msg.scene !== undefined && myScene !== null && msg.scene !== myScene) {
      try {
        const GD = mods['GameDefine'] && mods['GameDefine'].exports;
        const GM = mods['GameManager'] && mods['GameManager'].exports;
        const GMClass = GM && (GM.default || GM);
        if (GD && GMClass && typeof GMClass.getIns().changeSceneEasy === 'function') {
          const passageType = msg.passage && GD.ScenePassageType ? GD.ScenePassageType[msg.passage] : undefined;
          if (typeof passageType === 'number') {
            console.log('[AF] 跨场景传送:', myScene, '->', msg.scene, msg.passage);
            GMClass.getIns().changeSceneEasy(msg.scene, passageType);
          }
        }
      } catch (e) { console.warn('[AF] 跨场景传送失败:', e.message); }
    }
    const p = node.getPosition(), dx = msg.x - p.x, dy = msg.y - p.y;
    // 原版 DirType：LEFT=2 RIGHT=5 UP=10 DOWN=11。走路状态机负责动画、碰撞和镜头。
    const dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 5 : 2) : (dy >= 0 ? 10 : 11);
    item.changeDir(dir, false);
    agentMoveTarget = { x: msg.x, y: msg.y, scene: msg.scene };
    agentArriveIndex = (typeof msg.seg === 'number') ? msg.seg : null;
    agentArriveSent = false;
    // agent 移动期间不自动回传本地坐标，避免与 Agent 位置竞争
    hostedAgentOnline = true;
    if (agentStopTimer) clearTimeout(agentStopTimer);
    // 兜底：完成事件丢失则恢复本地同步（跨场景段含传送+加载，给更宽窗口）
    agentStopTimer = setTimeout(() => { clearAgentMoveState(item); }, (msg.scene !== undefined && msg.scene !== myScene) ? 20000 : 12000);
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
  // ---------- P1d 场景内市政装饰（路牌/路灯/花箱）：/af/mapgrid.decor -> 村景 TiledMap 节点 Cocos 精灵 ----------
  // 数据 = data/municipal-decor.json（服务端 municipalOf mtime 缓存）；坐标与 injectBlockers 同口径（H 行 y 翻转）。
  // 幂等：节点名 afMuni_<id>；场景切换随 TiledMap 节点销毁，回村景由 1s tick 重新注入。
  function injectMunicipalDecor() {
    const g = mapGridCache;
    if (!g || !Array.isArray(g.decor) || !g.decor.length) return;
    const scene = cc.director && cc.director.getScene();
    if (!scene) return;
    const pos = readPlayerPos();
    if (!pos || pos.scene !== 2) return; // 仅村景
    const tiledNode = getTiledMapNode();
    if (!tiledNode || !tiledNode.isValid) return;
    const art = window.__AF_ART__;
    if (!art || typeof art.toSprite !== 'function') return;
    const tm = tiledNode.getComponent(cc.TiledMap);
    const ms = tm && tm.getMapSize ? tm.getMapSize() : null;
    const H = ms && ms.height;
    if (!H) return;
    const lx = (tx) => tx * 100 + 50;
    const ly = (ty) => (H - ty) * 100 - 50;
    const DIMS = { 301: [32, 48], 302: [32, 48], 303: [32, 32] }; // manifest 301-306 生成尺寸
    for (const d of g.decor) {
      if (!d || !d.id) continue;
      const node = 'afMuni_' + d.id;
      if (tiledNode.getChildByName(node)) continue;
      const scale = Number(d.scale) > 0 ? Number(d.scale) : 1.4;
      const dim = DIMS[d.sprite] || [48, 48];
      art.toSprite(d.sprite, {
        parent: tiledNode, name: node,
        x: lx(d.x), y: ly(d.y),
        w: Math.round(dim[0] * scale), h: Math.round(dim[1] * scale),
      });
    }
    // L1 指路牌文字（landmarks.json signs，图不带字）：多行 Label 叠在路牌精灵上方；就近吸附 3 格内 301 精灵，无精灵则落数据点
    try {
      const signs = Array.isArray(g.signs) ? g.signs : [];
      const signSprites = (g.decor || []).filter(d => d && d.sprite === 301);
      signs.forEach((s, i) => {
        if (!s || !Array.isArray(s.lines) || !s.lines.length) return;
        const nm = 'afSignLbl_' + i;
        if (tiledNode.getChildByName(nm)) return;
        let ax = s.x, ay = s.y;
        let best = null, bestD = 3;
        for (const sp of signSprites) {
          const dd = Math.max(Math.abs(sp.x - s.x), Math.abs(sp.y - s.y));
          if (dd <= bestD) { best = sp; bestD = dd; }
        }
        if (best) { ax = best.x; ay = best.y; }
        const ln = new cc.Node(nm);
        const lb = ln.addComponent(cc.Label);
        lb.string = s.lines.join('\n');
        lb.fontSize = 12;
        lb.lineHeight = 14;
        lb.color = new cc.Color(255, 235, 180, 255);
        ln.setPosition(lx(ax), ly(ay) + 52);
        ln.zIndex = ay * 100 + 50;
        tiledNode.addChild(ln);
      });
    } catch (e) { /* Label API 缺失：路牌仅图形，文字降级 */ }
  }

  // ---------- P2 建筑招牌（A 挂牌模式：原版建筑 + 挂件 311 + cc.Label 名；B 覆盖建筑随 +28 环 P3 落位后自动生效） ----------
  // 数据 = /af/buildings?scene=N（buildings.json mtime 缓存）；场景切换随 TiledMap 节点销毁，回场景由 1s tick 重新注入。
  const bldgSceneCache = {};
  let bldgInjectedScene = null;
  function injectBuildingSigns() {
    const pos = readPlayerPos();
    if (!pos || !pos.scene) return;
    const sceneId = pos.scene;
    if (bldgInjectedScene !== sceneId) {
      bldgInjectedScene = sceneId;
      if (window.__AF_BLDG_DONE__) delete window.__AF_BLDG_DONE__[sceneId]; // 场景树已换新，重置幂等标记
    }
    if (window.__AF_BLDG_DONE__ && window.__AF_BLDG_DONE__[sceneId]) return;
    const tiledNode = getTiledMapNode();
    if (!tiledNode || !tiledNode.isValid) return;
    const art = window.__AF_ART__;
    if (!art || typeof art.toSprite !== 'function') return;
    const deliver = (list) => {
      if (!list.length) { window.__AF_BLDG_DONE__ = window.__AF_BLDG_DONE__ || {}; window.__AF_BLDG_DONE__[sceneId] = true; return; }
      const tm = tiledNode.getComponent(cc.TiledMap);
      const ms = tm && tm.getMapSize ? tm.getMapSize() : null;
      const H = ms && ms.height;
      if (!H) return;
      const lx = (gx) => gx * 100 + 50;
      const ly = (gy) => (H - gy) * 100 - 50;
      for (const b of list) {
        if (b.pending) continue;
        const sx = lx(b.sign.x), sy = ly(b.sign.y);
        const sn = 'afBldg_' + b.id;
        if (b.mode === 'cover' && b.rect) {
          // B 覆盖：生图建筑（307-310）盖住 fanzi 块；锚点=底边中点，zIndex 与角色同公式（底边行深）
          if (!tiledNode.getChildByName(sn)) {
            const DIMC = { 307: [288, 384], 308: [288, 384], 309: [384, 288], 310: [288, 384] };
            const dim = DIMC[b.artId] || [288, 384];
            const fw = b.rect.w * 100, fh = b.rect.h * 100 * 0.9;
            const sc = Math.min(fw / dim[0], fh / dim[1]);
            const cx = lx(b.rect.x + b.rect.w / 2), byBase = ly(b.rect.y + b.rect.h);
            art.toSprite(b.artId, { parent: tiledNode, name: sn, x: cx, y: byBase, w: Math.round(dim[0] * sc), h: Math.round(dim[1] * sc) });
            // toSprite 默认锚点(0.5,0.5)：底边中点定位需下移半高
            const node = tiledNode.getChildByName(sn);
            if (node) node.setPosition(cx, byBase - Math.round(dim[1] * sc) / 2 + 2);
          }
        } else if (b.mode === 'hang' && !tiledNode.getChildByName(sn)) {
          art.toSprite(b.artId, { parent: tiledNode, name: sn, x: sx, y: sy + 24, w: 40, h: 40 });
        } else {
          continue;
        }
        try { // 招牌文字（图不带字，Label 运行时叠加；金 12px）
          if (!b.sign || tiledNode.getChildByName('afBldgLbl_' + b.id)) continue;
          const ln = new cc.Node('afBldgLbl_' + b.id);
          const lb = ln.addComponent(cc.Label);
          lb.string = b.name;
          lb.fontSize = 12;
          lb.lineHeight = 14;
          lb.color = new cc.Color(255, 215, 90, 255);
          ln.setPosition(sx, sy + 48);
          ln.zIndex = (b.rect ? (b.rect.y + b.rect.h) * 100 : 0) + 50;
          tiledNode.addChild(ln);
        } catch (e) { /* Label API 缺失：挂件已挂，文字降级 */ }
      }
      window.__AF_BLDG_DONE__ = window.__AF_BLDG_DONE__ || {};
      window.__AF_BLDG_DONE__[sceneId] = true;
    };
    if (bldgSceneCache[sceneId]) { deliver(bldgSceneCache[sceneId]); return; }
    fetch(SERVER + '/af/buildings?scene=' + sceneId + '&token=' + encodeURIComponent(token))
      .then(r => r.json())
      .then(d => { bldgSceneCache[sceneId] = (d && d.buildings) || []; deliver(bldgSceneCache[sceneId]); })
      .catch(() => { bldgSceneCache[sceneId] = []; window.__AF_BLDG_DONE__ = window.__AF_BLDG_DONE__ || {}; window.__AF_BLDG_DONE__[sceneId] = true; });
  }

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
      #af-chat .af-line { color: var(--af-c-light); text-shadow: 1px 1px 2px var(--af-c-black-70); background: var(--af-c-black-35);
        padding: 2px 8px; margin: 2px 0; border-radius: 4px; word-break: break-all; }
      #af-chat .af-line .af-nick { color: var(--af-c-gold); }
      #af-chat-input { position: fixed; left: 8px; bottom: 8px; z-index: 100000; width: 340px;
        display: none; background: var(--af-c-black-60); color: var(--af-c-light); border: 1px solid var(--af-c-text-dim);
        border-radius: 4px; padding: 4px 8px; font: 13px "Microsoft YaHei", sans-serif; outline: none; }
      #af-chat-btn { position: fixed; left: 8px; bottom: 8px; z-index: 99998; width: 36px; height: 36px;
        border: 1px solid var(--af-c-text-dim); border-radius: 6px; background: var(--af-c-glass-panel); color: var(--af-c-light);
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
    AFUNI.on(button, toggle);
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
      b.style.cssText = 'border:1px solid var(--af-c-text-dim);border-radius:6px;background:var(--af-c-glass-panel);color:var(--af-c-gold);cursor:pointer;font:12px "Microsoft YaHei",sans-serif;padding:3px 8px;';
      AFUNI.on(b, () => { input.value = cmd; input.focus(); }, { cls: false });
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
  // ---------- 1:1 私聊（微信式，无距离限制）----------
  // 服务器消息：dm_in（收到私聊）、dm_result（发送结果）、dm_log（历史，msgs 数组）、dm_unlocked_list（已解锁对象）
  // 已解锁的私聊对象：首次见面（打招呼/送礼）后服务器标记 pair.dmUnlocked
  let dmUnlockedPeers = new Map(); // uid -> nick
  const dmCache = { logs: new Map(), target: '', lastSent: '' }; // logs: targetUid -> 最近私聊历史数组
  function renderDmLog() {
    const box = document.getElementById('af-dm-log');
    if (!box) return;
    box.innerHTML = '';
    const entries = dmCache.logs.get(dmCache.target) || [];
    if (entries.length === 0) { box.innerHTML = '<div class="dm-empty">暂无私聊记录</div>'; return; }
    for (const m of entries.slice(-30)) {
      const div = document.createElement('div');
      div.className = 'dm-line' + (m.from === uid ? ' me' : '');
      const t = new Date(m.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      div.innerHTML = '<span class="dm-at">' + t + '</span> <b class="dm-nick">' + esc(m.nick || m.from) + '</b>：' + esc(m.text);
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
  }
  function onDmUnlockedList(msg) {
    dmUnlockedPeers = new Map();
    for (const p of (msg.peers || [])) dmUnlockedPeers.set(p.other, p.nick);
    refreshDmPeerList();
  }
  function onDmIn(msg) {
    if (msg.from === uid) return;
    const log = dmCache.logs.get(msg.from);
    if (log) log.push({ from: msg.from, nick: msg.nick, text: msg.text, at: Date.now() });
    if (dmCache.target === msg.from) renderDmLog();
    if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('私聊·' + msg.nick, msg.text + '（点 💬 打开私聊面板回复）');
  }
  function onDmResult(msg) {
    if (!window.__AF_CHAT_ADD__) return;
    if (msg.ok) {
      const log = dmCache.logs.get(dmCache.target);
      if (log && dmCache.lastSent) log.push({ from: uid, nick, text: dmCache.lastSent, at: Date.now() });
      dmCache.lastSent = '';
      if (dmPanelOpen()) renderDmLog();
    } else {
      window.__AF_CHAT_ADD__('系统', '❌ 私聊失败：' + msg.msg);
    }
  }
  function onDmLog(msg) {
    dmCache.logs.set(dmCache.target, msg.msgs || []);
    if (dmPanelOpen()) renderDmLog();
  }
  function sendDm(targetUid, text) {
    if (!connected) return;
    dmCache.lastSent = text;
    dmCache.target = targetUid;
    ws.send(JSON.stringify({ t: 'dm_send', target: targetUid, text }));
  }
  function requestDmLog(targetUid) {
    if (!connected) return;
    dmCache.target = targetUid;
    ws.send(JSON.stringify({ t: 'dm_log', target: targetUid }));
  }
  function requestDmUnlockedList() {
    if (connected) ws.send(JSON.stringify({ t: 'dm_unlocked' }));
  }
  function dmPanelOpen() {
    const p = document.getElementById('af-dm-panel');
    return p && p.style.display === 'flex';
  }
  function openDmPanel(peerUid) {
    const panel = document.getElementById('af-dm-panel');
    if (panel) panel.style.display = 'flex';
    refreshDmPeerList();
    if (peerUid && dmUnlockedPeers.has(peerUid)) selectDmPeer(peerUid);
    else {
      document.getElementById('af-dm-name').textContent = '未选择';
      document.getElementById('af-dm-status').textContent = '';
      document.getElementById('af-dm-log').innerHTML = '<div class="dm-empty">左侧选择一位已解锁的私聊对象</div>';
    }
  }
  function selectDmPeer(peerUid) {
    const peer = dmUnlockedPeers.get(peerUid);
    if (!peer) return;
    dmCache.target = peerUid;
    document.getElementById('af-dm-name').textContent = peer;
    document.getElementById('af-dm-status').textContent = '已解锁 · ' + peer;
    document.getElementById('af-dm-input').focus();
    document.getElementById('af-dm-log').innerHTML = '<div class="dm-empty">加载中…</div>';
    requestDmLog(peerUid);
  }
  function refreshDmPeerList() {
    const list = document.getElementById('af-dm-peers');
    if (!list) return;
    list.innerHTML = '';
    if (dmUnlockedPeers.size === 0) { list.innerHTML = '<div class="dm-empty">暂无已解锁对象</div>'; return; }
    for (const [pu, pn] of dmUnlockedPeers) {
      const div = document.createElement('div');
      div.className = 'dm-peer';
      div.textContent = '💬 ' + pn;
      AFUNI.on(div, () => selectDmPeer(pu), { cls: false });
      list.appendChild(div);
    }
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
      case 'dm': {
        const target = a(0);
        const rest = parts.slice(2).join(' ');
        if (!target || !rest) { if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '用法：/dm 昵称 私聊内容（需已解锁）'); return true; }
        const targetUid = dmUnlockedPeers.size ? [...dmUnlockedPeers.entries()].find(([, n]) => n === target)?.[0] : null;
        if (!targetUid) { if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '未找到该私聊对象，先点 💬 打开面板解锁'); return true; }
        sendDm(targetUid, rest);
        return true;
      }
      case 'help': {
        if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '命令：/give 昵称 物品id 数量 · /fav 昵称 · /bind 昵称 关系 · /tp 昵称 · /task · /dm 昵称 消息（私聊）· 对话请点对方角色');
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
        background: var(--af-c-glass-panel); color: var(--af-c-gold); border: 1px solid var(--af-c-moss); border-radius: 6px;
        padding: 5px 10px; font: 13px "Microsoft YaHei", sans-serif; box-shadow: 0 2px 6px var(--af-c-black-40); }
      #af-diary-btn:hover { background: var(--af-c-glass-solid); }
      #af-diary { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 100000;
        width: 680px; max-width: 94vw; height: 440px; display: none; flex-direction: column;
        background: linear-gradient(180deg,var(--af-c-panel-deep),var(--af-c-panel-deep)); border: 2px solid var(--af-c-wood); border-radius: 10px;
        box-shadow: 0 8px 30px var(--af-c-black-70), inset 0 0 0 1px var(--af-c-panel); font: 13px "Microsoft YaHei", sans-serif; }
      #af-diary .hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;
        border-bottom: 1px solid var(--af-c-panel); }
      #af-diary .hd b { color: var(--af-c-gold); font-size: 15px; }
      #af-diary .hd .x { cursor: pointer; color: var(--af-c-text-dim); font-size: 16px; padding: 0 6px; }
      #af-diary .hd .x:hover { color: var(--af-c-danger); }
      #af-diary .bd { display: flex; flex: 1; min-height: 0; }
      #af-diary .list { width: 170px; border-right: 1px solid var(--af-c-panel); overflow-y: auto; padding: 8px 0; }
      #af-diary .list .it { padding: 7px 14px; color: var(--af-c-text); cursor: pointer; border-left: 3px solid transparent; }
      #af-diary .list .it:hover { background: var(--af-c-glow-gold); }
      #af-diary .list .it.on { background: var(--af-c-glow-gold-strong); border-left-color: var(--af-c-gold); color: var(--af-c-gold); }
      #af-diary .content { flex: 1; overflow-y: auto; padding: 14px 18px; color: var(--af-c-text); line-height: 1.7; white-space: pre-wrap; }
      #af-diary .empty { color: var(--af-c-text-dim); text-align: center; margin-top: 60px; }
      #af-diary .foot { padding: 6px 14px; border-top: 1px solid var(--af-c-panel); color: var(--af-c-text-dim); font-size: 11px; }
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
          AFUNI.on(it, () => {
            list.querySelectorAll('.it').forEach(x => x.classList.remove('on'));
            it.classList.add('on');
            content.textContent = d.content;
          }, { cls: false });
          list.appendChild(it);
        });
        content.textContent = days[0].content;
      } catch (e) {
        content.innerHTML = '<div class="empty">日记加载失败：' + (e.message || '网络错误') + '</div>';
      }
    }
    function close() { panel.style.display = 'none'; }
    AFUNI.on(btn, open);
    AFUNI.on(panel.querySelector('#af-diary-x'), close, { cls: false });
  }

  // ---------- Agent 指挥 UI（📮 实时指挥 + ⏸ 打断 + ▶ 恢复 + 🤖 托管中状态） ----------
  function injectAgentUI() {
    if (document.getElementById('af-agent-btn')) return;
    const css = document.createElement('style');
    css.textContent = `
      #af-agent-btn, #af-interrupt-btn, #af-resume-btn { position: fixed; right: 10px; z-index: 99990; cursor: pointer;
        background: var(--af-c-glass-panel); color: var(--af-c-gold); border: 1px solid var(--af-c-moss); border-radius: 6px;
        padding: 5px 10px; font: 13px "Microsoft YaHei", sans-serif; box-shadow: 0 2px 6px var(--af-c-black-40); }
      #af-agent-btn { top: 46px; }
      #af-interrupt-btn { top: 126px; color: var(--af-c-danger); border-color: var(--af-c-wood); }
      #af-resume-btn { top: 126px; right: 88px; color: var(--af-c-success); border-color: var(--af-c-moss); }
      #af-agent-btn:hover, #af-interrupt-btn:hover, #af-resume-btn:hover { background: var(--af-c-glass-solid); }
      #af-agent-status { position: fixed; top: 166px; right: 10px; z-index: 99990; cursor: default;
        padding: 5px 12px; border-radius: 6px; font: 12px "Microsoft YaHei", sans-serif;
        box-shadow: 0 2px 6px var(--af-c-black-40); max-width: 320px; }
      #af-agent-status.on { background: var(--af-c-glass-moss); color: var(--af-c-success); border: 1px solid var(--af-c-moss); }
      #af-agent-status.waiting { background: var(--af-c-glass-wood); color: var(--af-c-danger); border: 1px solid var(--af-c-wood-dark); }
        #af-agent-status.off { background: var(--af-c-glass-panel); color: var(--af-c-text-dim); border: 1px solid var(--af-c-panel); }
        #af-hud-agent { padding: 4px 10px; border-radius: 6px; font: 12px "Microsoft YaHei", sans-serif; box-shadow: 0 2px 6px var(--af-c-black-40); max-width: 300px; }
        #af-hud-agent.on { background: var(--af-c-glass-moss); color: var(--af-c-success); border: 1px solid var(--af-c-moss); }
        #af-hud-agent.waiting { background: var(--af-c-glass-wood); color: var(--af-c-danger); border: 1px solid var(--af-c-wood-dark); }
        #af-hud-agent.off { background: var(--af-c-glass-panel); color: var(--af-c-text-dim); border: 1px solid var(--af-c-panel); }
      #af-map-layers { position: fixed; top: 190px; right: 10px; z-index: 99990; display: flex; gap: 4px; }
      #af-map-layers button { cursor: pointer; background: var(--af-c-glass-panel); color: var(--af-c-text-dim);
        border: 1px solid var(--af-c-panel); border-radius: 6px; padding: 3px 8px; font: 11px "Microsoft YaHei", sans-serif;
        box-shadow: 0 2px 6px var(--af-c-black-40); }
      #af-map-layers button.on { background: var(--af-c-glass-moss); color: var(--af-c-gold); border-color: var(--af-c-moss); }
      #af-map-layers button:hover { background: var(--af-c-glass-solid); }
      #af-agent { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 100000;
        width: 420px; max-width: 92vw; display: none; flex-direction: column;
        background: linear-gradient(180deg,var(--af-c-panel-deep),var(--af-c-panel-deep)); border: 2px solid var(--af-c-wood); border-radius: 10px;
        box-shadow: 0 8px 30px var(--af-c-black-70); font: 13px "Microsoft YaHei", sans-serif; }
      #af-agent .hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--af-c-panel); }
      #af-agent .hd b { color: var(--af-c-gold); font-size: 15px; }
      #af-agent .hd .x { cursor: pointer; color: var(--af-c-text-dim); font-size: 16px; padding: 0 6px; }
      #af-agent .hd .x:hover { color: var(--af-c-danger); }
      #af-agent .bd { padding: 12px 14px; color: var(--af-c-text); line-height: 1.7; }
      #af-agent .bd p { margin: 0 0 10px; color: var(--af-c-text-dim); font-size: 12px; }
      #af-agent textarea { width: 100%; box-sizing: border-box; height: 64px; resize: none; padding: 8px 10px;
        background: var(--af-c-bg); color: var(--af-c-light-soft); border: 1px solid var(--af-c-panel); border-radius: 6px;
        font: 13px "Microsoft YaHei", sans-serif; outline: none; }
      #af-agent .row { display: flex; gap: 8px; margin-top: 10px; }
      #af-agent .btn { flex: 1; padding: 8px; border: 0; border-radius: 6px; font-size: 14px; cursor: pointer; }
      #af-agent .btn-primary { background: var(--af-c-amber); color: var(--af-c-bg); font-weight: bold; }
      #af-agent .btn-primary:hover { background: var(--af-c-amber); }
      #af-agent .tip { margin-top: 10px; color: var(--af-c-text-dim); font-size: 11px; }
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
    let agentOnline = false, agentNick = '', agentActivity = '', agentWaiting = false;
    window.addEventListener('keydown', (e) => {
      if (!agentOnline || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
    function renderAgentStatus() {
      if (document.getElementById('af-agent-status')) {
        const st = document.getElementById('af-agent-status');
        if (!agentOnline) { st.textContent = '🤖 Agent 未连接'; st.className = 'off'; }
        else if (agentWaiting) { st.textContent = '⏸ Agent 已让位 · ' + (agentActivity || '等你指挥'); st.className = 'waiting'; }
        else { st.textContent = '🤖 自动执行 · ' + (agentActivity || '运行中'); st.className = 'on'; }
      }
      const chip = document.getElementById('af-hud-agent');
      if (chip) {
        if (!agentOnline) { chip.textContent = '🤖 Agent 未连接'; chip.className = 'af-hud-agent off'; }
        else if (agentWaiting) { chip.textContent = '⏸ 已让位 · ' + (agentActivity || '等你指挥'); chip.className = 'af-hud-agent waiting'; }
        else { chip.textContent = '🤖 自动执行 · ' + (agentActivity || '运行中'); chip.className = 'af-hud-agent on'; }
      }
    }
    function updateAgentStatus(online, nick) {
      agentOnline = online;
      hostedAgentOnline = online;
      if (!online && agentStopTimer) { clearTimeout(agentStopTimer); agentStopTimer = null; }
      const toggle = document.getElementById('af-agent-toggle');
      if (toggle) toggle.textContent = online ? '停止托管' : '启动托管';
      if (nick) agentNick = nick;
      if (!online) { agentWaiting = false; agentActivity = ''; }
      renderAgentStatus();
      intBtn.style.display = online ? 'block' : 'none';
      resBtn.style.display = online ? 'block' : 'none';
    }
    function setAgentActivity(text, waiting) {
      if (text) agentActivity = text;
      if (waiting !== undefined) agentWaiting = waiting;
      renderAgentStatus();
    }
    window.__AF_AGENT_ACTIVITY__ = setAgentActivity;
    // 轮询兜底（WS 推送丢失时）
    setInterval(() => {
      fetch(SERVER + '/af/agent-status?token=' + encodeURIComponent(token))
        .then(r => r.json())
        .then(d => { if (d && typeof d.online === 'boolean') updateAgentStatus(d.online, d.nick); })
        .catch(() => {});
    }, 10000);

    // ---------- 村民动态（B7 日程：npc_move 广播 -> 轻量 DOM 走马灯） ----------
    if (!document.getElementById('af-npc-ticker')) {
      const tcss = document.createElement('style');
      tcss.textContent = `
        #af-npc-ticker { position: fixed; bottom: 120px; left: 10px; z-index: 99989; max-width: 260px;
          padding: 6px 10px; border-radius: 8px; background: var(--af-c-glass-bg); color: var(--af-c-text);
          font: 12px/1.5 'Microsoft YaHei', sans-serif; pointer-events: none; opacity: 0; transition: opacity .4s; }
        #af-npc-ticker.show { opacity: 1; }
        #af-npc-ticker .who { color: var(--af-c-success); font-weight: 600; }
      `;
      document.head.appendChild(tcss);
      const tick = document.createElement('div');
      tick.id = 'af-npc-ticker';
      document.body.appendChild(tick);
      let tickTimer = null;
      const ACT_CN = { work: '干活', rest: '休息', social: '社交', eat: '吃饭', sleep: '睡觉', fish: '钓鱼', farm: '农作', trade: '赶集' };
      window.__AF_NPC_TICK__ = function (npc, hour) {
        try {
          const act = ACT_CN[npc.activity] || npc.activity || '';
          const h = hour != null ? (' ' + String(hour).padStart(2, '0') + ':00') : '';
          tick.innerHTML = '🧑 ' + '<span class="who">' + (npc.name || '村民') + '</span>' + ' ' + act + h;
          tick.classList.add('show');
          if (tickTimer) clearTimeout(tickTimer);
          tickTimer = setTimeout(() => tick.classList.remove('show'), 6000);
        } catch (e) { /* ignore */ }
      };
    }

    // ---------- 今日村况（B8 历法/天气：/af/calendar -> 轻量 DOM 显示；节日高亮） ----------
    if (!document.getElementById('af-village-today')) {
      const vcss = document.createElement('style');
      vcss.textContent = `
        #af-village-today { position: fixed; bottom: 92px; left: 10px; z-index: 99988; max-width: 300px;
          padding: 5px 9px; border-radius: 8px; background: var(--af-c-glass-bg); color: var(--af-c-text);
          font: 12px/1.4 'Microsoft YaHei', sans-serif; pointer-events: none; }
        #af-village-today .fx { color: var(--af-c-gold); font-weight: 600; }
      `;
      document.head.appendChild(vcss);
      const vd = document.createElement('div');
      vd.id = 'af-village-today';
      document.body.appendChild(vd);
      const WX = { clear: '☀️ 晴', rain: '🌧️ 雨', snow: '❄️ 雪', storm: '⛈️ 风暴' };
      const SEASON_CN = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
      function pollVillageToday() {
        fetch(SERVER + '/af/calendar')
          .then(r => r.json())
          .then(d => {
            if (!d || !d.ok || !d.days || !d.days[0]) return;
            const t = d.days[0];
            vd.innerHTML = '📅 第' + t.day + '日 · ' + (SEASON_CN[t.season] || t.season) + ' · ' + (WX[t.weather] || t.weather)
              + (t.festival ? ' · <span class="fx">' + t.festival + '</span>' : '');
            vd.style.display = '';
            if (window.__AF_HUD__ && window.__AF_HUD__.setClock) {
              window.__AF_HUD__.setClock('📅 第' + t.day + '日 · ' + (SEASON_CN[t.season] || t.season) + ' · ' + (WX[t.weather] || t.weather) + (t.festival ? ' · ' + t.festival : ''));
            }
            if (window.__AF_WEATHER_FX__) window.__AF_WEATHER_FX__(t.weather);
            // M4 氛围 + M5 音频：日历驱动（hour 服务端游戏时钟；season/weather LUT；BGM 昼夜按 19:00/05:00）
            try {
              if (window.AFATMO && window.AFATMO.update) {
                const hour = Number.isFinite(d.hour) ? d.hour : new Date().getHours();
                window.AFATMO.update(hour, t.season, t.weather);
              }
              if (window.AFFX && window.AFFX.setMode && (t.weather === 'rain' || t.weather === 'snow' || t.weather === 'storm')) {
                window.AFFX.setMode(t.weather === 'storm' ? 'rain' : t.weather);
              } else if (window.AFFX && window.AFFX.setMode && t.season) {
                const SM = { spring: 'petal', summer: 'firefly', autumn: 'leaf', winter: 'snow' };
                window.AFFX.setMode(SM[t.season] || 'clear');
              }
              if (window.AFAUD && window.AFAUD.setBgmMode && Number.isFinite(d.hour)) {
                window.AFAUD.setBgmMode(d.hour >= 19 || d.hour < 5 ? 'night' : 'day', t.season);
              }
            } catch (e) {}
          })
          .catch(() => { vd.style.display = 'none'; });
      }
      pollVillageToday();
      setInterval(pollVillageToday, 60000);
      // B8 天气全屏特效层（同轮询数据驱动；CSS 动画，pointer-events:none 不挡操作）
      if (!document.getElementById('af-weather-fx')) {
        const wx = document.createElement('style');
        wx.textContent = `
          @keyframes afRainMove { from { background-position: 0 0; } to { background-position: -40px 60px; } }
          @keyframes afSnowMove { from { background-position: 0 0; } to { background-position: 30px 40px; } }
          #af-weather-fx { position: fixed; inset: 0; z-index: 99985; pointer-events: none; display: none; }
          #af-weather-fx.rain { display: block; background: repeating-linear-gradient(100deg, transparent 0 5px, var(--af-c-glass-snow) 5px 6px); animation: afRainMove .55s linear infinite; }
          #af-weather-fx.snow { display: block; background: radial-gradient(var(--af-c-white-70) 1px, transparent 1.5px) 0 0 / 26px 26px; animation: afSnowMove 4s linear infinite; }
          #af-weather-fx.storm { display: block; background: var(--af-c-glass-night); }
          #af-weather-fx.storm::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(100deg, transparent 0 5px, var(--af-c-glass-sky) 5px 6px); animation: afRainMove .4s linear infinite; }
        `;
        document.head.appendChild(wx);
        const fx = document.createElement('div');
        fx.id = 'af-weather-fx';
        document.body.appendChild(fx);
        window.__AF_WEATHER_FX__ = function (weather) { fx.className = (weather === 'rain' || weather === 'snow' || weather === 'storm') ? weather : ''; };
      }
    }

    // ---------- 视觉轨面板（A8 导演观战 / A10 回放 / B9 动物 / B10 庭院榜；DOM best-effort） ----------
    if (!document.getElementById('af-visual-panel')) {
      const vcss = document.createElement('style');
      vcss.textContent = `
        #af-visual-panel { position: fixed; top: 200px; right: 10px; z-index: 99987; width: 230px;
          background: var(--af-c-glass-bg); color: var(--af-c-text); border: 1px solid var(--af-c-panel); border-radius: 8px;
          font: 12px/1.5 'Microsoft YaHei', sans-serif; }
        #af-visual-panel .hd { padding: 6px 10px; background: var(--af-c-glass-bg-solid); border-bottom: 1px solid var(--af-c-panel);
          display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
        #af-visual-panel .sec { padding: 6px 10px; border-bottom: 1px solid var(--af-c-panel-deep); }
        #af-visual-panel .sec:last-child { border-bottom: none; }
        #af-visual-panel .tt { color: var(--af-c-text-dim); font-size: 11px; margin-bottom: 3px; }
        #af-visual-panel .line { margin: 2px 0; }
        #af-visual-panel .cam { color: var(--af-c-success); }
        #af-visual-panel .muted { color: var(--af-c-text-dim); }
        #af-visual-panel.collapsed .sec { display: none; }
      `;
      document.head.appendChild(vcss);
      const vp = document.createElement('div');
      vp.id = 'af-visual-panel';
      vp.innerHTML = '<div class="hd"><b>📷 村事</b><span id="af-vp-x">▾</span></div>' +
        '<div class="sec"><div class="tt">导演观战</div><div id="af-vp-cam" class="line muted">未观战</div></div>' +
        '<div class="sec"><div class="tt">动物（点击刷新）</div><div id="af-vp-animals" class="line muted">…</div></div>' +
        '<div class="sec"><div class="tt">庭院榜</div><div id="af-vp-decor" class="line muted">…</div></div>' +
        '<div class="sec"><div class="tt">回放（M1.4 确定性）</div><div id="af-vp-replay" class="line muted">…</div>' +
        '<button id="af-vp-replay-btn" style="margin-top:4px;padding:3px 8px;background:var(--af-c-panel-deep);color:var(--af-c-text);border:1px solid var(--af-c-panel);border-radius:4px;cursor:pointer;font:11px \'Microsoft YaHei\',sans-serif;">刷新回放时间线</button></div>';
      document.body.appendChild(vp);
      AFUNI.on(vp.querySelector('#af-vp-x'), () => { vp.classList.toggle('collapsed'); vp.querySelector('#af-vp-x').textContent = vp.classList.contains('collapsed') ? '▸' : '▾'; }, { cls: false });

      // A8 导演镜头：WS camera 广播 -> 观战提示（10s 自动隐回"未观战"）
      let camTimer = null;
      window.__AF_CAM__ = function (shot, watch) {
        if (!shot) return;
        const el = vp.querySelector('#af-vp-cam');
        el.textContent = '跟随 ' + (shot.target || '世界') + '（' + (shot.kind === 'follow_agent' ? '托管行动' : '事件') + '）';
        el.className = 'line cam';
        if (camTimer) clearTimeout(camTimer);
        camTimer = setTimeout(() => { el.textContent = '未观战'; el.className = 'line muted'; }, 10000);
      };

      // B9 动物面板
      function pollAnimals() {
        fetch(SERVER + '/af/animals')
          .then(r => r.json())
          .then(d => {
            const el = vp.querySelector('#af-vp-animals');
            if (!d.ok || !d.animals || !d.animals.length) { el.textContent = '暂无动物（去牧场领养）'; el.className = 'line muted'; return; }
            el.innerHTML = d.animals.slice(0, 6).map(a =>
              a.name + '(' + a.stage + ') 饱' + (a.satiety == null ? '-' : a.satiety)
            ).join('<br>') + (d.animals.length > 6 ? '<br><span class="muted">…共 ' + d.animals.length + ' 只</span>' : '');
            el.className = 'line';
          })
          .catch(() => {});
      }
      pollAnimals();
      AFUNI.on(vp.querySelector('#af-vp-animals'), pollAnimals);
      vp.querySelector('#af-vp-animals').style.cursor = 'pointer';

      // B10 庭院榜
      function pollDecor() {
        fetch(SERVER + '/af/decor-board?token=' + encodeURIComponent(token))
          .then(r => r.json())
          .then(d => {
            const el = vp.querySelector('#af-vp-decor');
            if (!d.ok || !d.top || !d.top.length) { el.textContent = '暂无布置'; el.className = 'line muted'; return; }
            el.innerHTML = d.top.slice(0, 5).map((r, i) => (i + 1) + '. ' + r.username + ' ' + r.score + '分').join('<br>');
            el.className = 'line';
          })
          .catch(() => {});
      }
      pollDecor();

      // A10 回放时间线（只读；verify=1 附确定性校验）
      AFUNI.on(vp.querySelector('#af-vp-replay-btn'), function () {
        const el = vp.querySelector('#af-vp-replay');
        el.textContent = '加载中…';
        fetch(SERVER + '/af/replay?events=40&verify=1&token=' + encodeURIComponent(token))
          .then(r => r.json())
          .then(d => {
            if (!d.ok) { el.textContent = '回放不可用'; return; }
            const shots = (d.shots || []).slice(-5).map(s => s.kind + ':' + s.target + '@' + s.x + ',' + s.y).join(' → ');
            el.textContent = 'seq ' + d.fromSeq + '-' + d.toSeq + ' · ' + (d.shots || []).length + ' 镜头' +
              (d.deterministic === false ? ' · ⚠ 非确定' : ' · 确定性✓') +
              (shots ? '<br><span class="muted">' + shots + '</span>' : '');
          })
          .catch(() => { el.textContent = '回放获取失败'; });
      });

      setInterval(pollAnimals, 30000);
      setInterval(pollDecor, 60000);
    }

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
        <div id="af-agent-model-form" style="display:none;margin-top:10px;border-top:1px solid var(--af-c-panel);padding-top:10px;">
          <p>配置 Agent 大脑的 LLM（OpenAI 兼容接口）。配置保存在房间服务器，一次配好全房间托管都能用。</p>
          <input id="af-model-url" placeholder="API 地址，如 https://opencode.ai/zen/go/v1" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:7px 9px;background:var(--af-c-bg);color:var(--af-c-light-soft);border:1px solid var(--af-c-panel);border-radius:6px;font:13px 'Microsoft YaHei',sans-serif;outline:none;">
          <input id="af-model-key" placeholder="API Key（已配置时留空则保留）" type="password" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:7px 9px;background:var(--af-c-bg);color:var(--af-c-light-soft);border:1px solid var(--af-c-panel);border-radius:6px;font:13px 'Microsoft YaHei',sans-serif;outline:none;">
          <input id="af-model-name" placeholder="模型名，如 deepseek-v4-flash" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:7px 9px;background:var(--af-c-bg);color:var(--af-c-light-soft);border:1px solid var(--af-c-panel);border-radius:6px;font:13px 'Microsoft YaHei',sans-serif;outline:none;">
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
    AFUNI.on(modelBtn, () => { modelForm.style.display = modelForm.style.display === 'none' ? 'block' : 'none'; loadProviderState(); });
    AFUNI.on(modelSave, async () => {
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
    });
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
    AFUNI.on(btn, openPanel);
    AFUNI.on(panel.querySelector('#af-agent-x'), closePanel, { cls: false });
    AFUNI.on(sendBtn, sendMsg);
    AFUNI.on(toggleBtn, async () => {
      try {
        const r = await fetch(SERVER + '/af/agent-control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action: agentOnline ? 'stop' : 'start' }) });
        const d = await r.json();
        if (!d.ok) throw new Error(d.msg || '操作失败');
        toggleBtn.textContent = agentOnline ? '启动托管' : '停止托管';
        toast(agentOnline ? '已停止托管' : '托管已启动', agentOnline ? 'info' : 'ok');
      } catch (e) { toast(e.message || '托管操作失败', 'err'); if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', e.message || '托管操作失败'); }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
    AFUNI.on(intBtn, () => {
      if (connected) ws.send(JSON.stringify({ t: 'agent_interrupt' }));
      if (window.__AF_AGENT_ACTIVITY__) window.__AF_AGENT_ACTIVITY__('你手动按了 ⏸，Agent 已停手等你指挥', true);
      if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '已发送打断指令');
      toast('已打断 Agent', 'info');
    });
    AFUNI.on(resBtn, () => {
      if (connected) ws.send(JSON.stringify({ t: 'agent_resume' }));
      if (window.__AF_AGENT_ACTIVITY__) window.__AF_AGENT_ACTIVITY__('恢复行动，继续原计划', false);
      if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '已发送恢复指令');
      toast('Agent 恢复行动', 'ok');
    });
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
            if (g.water[i]) fill(x, y, 'var(--af-c-sky)');
            else if (g.blocked && g.blocked[i]) fill(x, y, 'var(--af-c-wood)');
          }
          for (const h of (g.houses || [])) {
            const inOrig = h.x >= g.LEFT && h.x + h.w <= g.LEFT + g.origW && h.y >= g.TOP && h.y + h.h <= g.TOP + g.origH;
            if (inOrig) continue;
            ctx.strokeStyle = 'var(--af-c-wood-dark)';
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
          if (g.roads || g.landmarks) attachMapOverlays(village, g, cw, ch);
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
      if (g.water[i]) fill(x, y, 'var(--af-c-sky)');
      else if (g.blocked && g.blocked[i]) fill(x, y, 'var(--af-c-wood)');
    }
    // 宅基地描边（只在扩展区画）
    for (const h of (g.houses || [])) {
      const inOrig = h.x >= g.LEFT && h.x + h.w <= g.LEFT + g.origW && h.y >= g.TOP && h.y + h.h <= g.TOP + g.origH;
      if (inOrig) continue;
      ctx.strokeStyle = 'var(--af-c-wood-dark)';
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
    if (g.roads || g.landmarks) attachMapOverlays(village, g, cw, ch);
    console.log('[AF] 村庄小地图底图已更新为扩展版 (' + g.W + 'x' + g.H + ')，原版区透明透出羊皮纸美术');
  }

  // ---------- L2 市政图层（roads-landmarks 规划书 §4）：小地图 路/地标 双覆盖层 + 独立显隐开关 ----------
  // 路=浅色线（宽随路宽）、地标=按 type 的简笔图标（色盲安全：形状互异，不靠色相区分）；开关状态持久化
  let mapLayerState = (function () {
    try {
      const s = JSON.parse(localStorage.getItem('af.map.layers') || 'null');
      if (s && typeof s === 'object') return { roads: s.roads !== false, landmarks: s.landmarks !== false };
    } catch (e) { /* 损坏状态回落默认 */ }
    return { roads: true, landmarks: true };
  })();
  function paintMapOverlays(g, cw, ch) {
    const sx = cw / g.W, sy = ch / g.H;
    const roadsCv = document.createElement('canvas');
    roadsCv.width = cw; roadsCv.height = ch;
    const rc = roadsCv.getContext('2d');
    rc.lineCap = 'round'; rc.lineJoin = 'round';
    for (const r of (g.roads || [])) {
      if (!Array.isArray(r.line) || r.line.length < 2) continue;
      rc.strokeStyle = 'var(--af-c-gold)';
      rc.lineWidth = Math.max(1, Math.round((r.width || 1) * sx * 0.75));
      rc.beginPath();
      for (let i = 0; i < r.line.length; i++) {
        const px = (r.line[i][0] + 0.5) * sx, py = (r.line[i][1] + 0.5) * sy;
        if (i) rc.lineTo(px, py); else rc.moveTo(px, py);
      }
      rc.stroke();
    }
    const lmCv = document.createElement('canvas');
    lmCv.width = cw; lmCv.height = ch;
    const lc = lmCv.getContext('2d');
    const s = Math.max(2, Math.round(cw / 40)); // 图标半径
    for (const L of (g.landmarks || [])) {
      if (!Number.isFinite(L.x) || !Number.isFinite(L.y)) continue;
      const px = (L.x + 0.5) * sx, py = (L.y + 0.5) * sy;
      lc.fillStyle = 'var(--af-c-amber)';
      lc.strokeStyle = 'var(--af-c-amber)';
      lc.lineWidth = 1;
      lc.beginPath();
      switch (L.type) {
        case 'monument': lc.moveTo(px, py - s); lc.lineTo(px + s, py + s * 0.8); lc.lineTo(px - s, py + s * 0.8); lc.closePath(); lc.fill(); break; // 三角
        case 'building': lc.rect(px - s, py - s, s * 2, s * 2); lc.fill(); break; // 方
        case 'bridge':
          lc.beginPath(); lc.moveTo(px - s, py - s * 0.4); lc.lineTo(px + s, py - s * 0.4); lc.moveTo(px - s, py + s * 0.4); lc.lineTo(px + s, py + s * 0.4); lc.stroke(); break; // 双横杠
        case 'tower': lc.moveTo(px, py - s); lc.lineTo(px + s, py); lc.lineTo(px, py + s); lc.lineTo(px - s, py); lc.closePath(); lc.fill(); break; // 菱形
        case 'dock':
          lc.beginPath(); lc.moveTo(px - s, py - s * 0.6); lc.lineTo(px + s, py - s * 0.6); lc.moveTo(px, py - s * 0.6); lc.lineTo(px, py + s); lc.stroke(); break; // T
        case 'gate': lc.arc(px, py + s * 0.4, s, Math.PI, 0); lc.fill(); break; // 拱
        case 'stall':
          lc.beginPath(); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; const b = px + s * Math.cos(a), b2 = py + s * Math.sin(a); if (k) lc.lineTo(b, b2); else lc.moveTo(b, b2); } lc.closePath(); lc.fill(); break; // 五边
        default: lc.arc(px, py, s, 0, Math.PI * 2); lc.fill(); // 圆（fountain/未分类）
      }
    }
    return { roads: roadsCv, landmarks: lmCv };
  }
  function attachMapOverlays(village, g, cw, ch) {
    const layers = paintMapOverlays(g, cw, ch);
    for (const [name, key] of [['afMapRoads', 'roads'], ['afMapLandmarks', 'landmarks']]) {
      let n = village.getChildByName(name);
      if (!n) { n = new cc.Node(name); n.addComponent(cc.Sprite); village.addChild(n, 0); }
      const tex = new cc.Texture2D();
      tex.initWithElement(layers[key]);
      tex.handleLoadedTexture();
      const sf = new cc.SpriteFrame(tex);
      sf.setRect(new cc.Rect(0, 0, cw, ch));
      const sp = n.getComponent(cc.Sprite);
      sp.spriteFrame = sf;
      sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
      n.width = cw; n.height = ch;
      n.active = mapLayerState[key];
    }
  }
  function applyMapLayerState() {
    const scene = cc.director && cc.director.getScene();
    if (!scene) return;
    let village = null;
    scene.walk(n => { if (!village && n.name === 'village' && n.parent && n.parent.name === 'pnlContent') village = n; });
    if (!village) return;
    const r = village.getChildByName('afMapRoads');
    if (r) r.active = mapLayerState.roads;
    const l = village.getChildByName('afMapLandmarks');
    if (l) l.active = mapLayerState.landmarks;
  }
  function injectMapLayerToggles() {
    if (document.getElementById('af-map-layers')) return;
    const wrap = document.createElement('div');
    wrap.id = 'af-map-layers';
    wrap.title = '小地图图层显隐（设置持久化）';
    const mk = (key, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = mapLayerState[key] ? 'on' : '';
      const apply = function () {
        mapLayerState[key] = !mapLayerState[key];
        b.className = mapLayerState[key] ? 'on' : '';
        try { localStorage.setItem('af.map.layers', JSON.stringify(mapLayerState)); } catch (e) { /* 存储不可用则仅本次生效 */ }
        applyMapLayerState();
      };
      // R4.4：点击绑定统一走 AFUNI.on（三态）；AFUNI 缺失时静默降级（P3 隔离），不回落直接绑定
      try { if (window.AFUNI && window.AFUNI.on) window.AFUNI.on(b, apply, { cls: false }); } catch (e) { /* 降级 */ }
      return b;
    };
    wrap.appendChild(mk('roads', '路网'));
    wrap.appendChild(mk('landmarks', '地标'));
    document.body.appendChild(wrap);
    applyMapLayerState();
  }

  // ---------- 玩家间社交 UI（点击对方角色：对话/送礼/好感/关系；📜 任务面板） ----------
  function injectSocialUI() {
    if (document.getElementById('af-task-btn')) return;
    const css = document.createElement('style');
    css.textContent = `
      #af-task-btn { position: fixed; top: 46px; left: 10px; z-index: 99990; cursor: pointer;
        background: var(--af-c-glass-panel); color: var(--af-c-gold); border: 1px solid var(--af-c-moss); border-radius: 6px;
        padding: 5px 10px; font: 13px "Microsoft YaHei", sans-serif; box-shadow: 0 2px 6px var(--af-c-black-40); }
      #af-task-btn:hover { background: var(--af-c-glass-solid); }
      #af-task-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 100000;
        width: 460px; max-width: 94vw; display: none; flex-direction: column;
        background: linear-gradient(180deg,var(--af-c-panel-deep),var(--af-c-panel-deep)); border: 2px solid var(--af-c-wood); border-radius: 10px;
        box-shadow: 0 8px 30px var(--af-c-black-70); font: 13px "Microsoft YaHei", sans-serif; }
      #af-task-panel .hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--af-c-panel); }
      #af-task-panel .hd b { color: var(--af-c-gold); font-size: 15px; }
      #af-task-panel .hd .x { cursor: pointer; color: var(--af-c-text-dim); font-size: 16px; padding: 0 6px; }
      #af-task-list { padding: 10px 14px; max-height: 380px; overflow-y: auto; }
      #af-task-list .tl-it { padding: 8px 10px; margin-bottom: 6px; background: var(--af-c-white-04); border-radius: 6px; border-left: 3px solid var(--af-c-wood); }
      #af-task-list .tl-it.done { opacity: .55; border-left-color: var(--af-c-moss); }
      #af-task-list .tl-it b { color: var(--af-c-paper); }
      #af-task-list .tl-desc { color: var(--af-c-text-dim); font-size: 11px; margin-left: 6px; }
      #af-task-list .tl-prog { float: right; color: var(--af-c-gold); }
      #af-task-list .tl-reward { display: block; color: var(--af-c-moss); font-size: 11px; margin-top: 3px; }
      #af-social-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 100000;
        width: 360px; max-width: 92vw; display: none; flex-direction: column;
        background: linear-gradient(180deg,var(--af-c-panel-deep),var(--af-c-panel-deep)); border: 2px solid var(--af-c-wood); border-radius: 10px;
        box-shadow: 0 8px 30px var(--af-c-black-70); font: 13px "Microsoft YaHei", sans-serif; }
      #af-social-panel .hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--af-c-panel); }
      #af-social-panel .hd b { color: var(--af-c-gold); font-size: 15px; }
      #af-social-panel .hd .x { cursor: pointer; color: var(--af-c-text-dim); font-size: 16px; padding: 0 6px; }
      #af-social-panel .bd { padding: 12px 14px; color: var(--af-c-text); }
      #af-social-panel input, #af-social-panel select { width: 100%; box-sizing: border-box; margin-bottom: 8px; padding: 7px 9px;
        background: var(--af-c-bg); color: var(--af-c-light-soft); border: 1px solid var(--af-c-panel); border-radius: 6px; font: 13px "Microsoft YaHei", sans-serif; outline: none; }
      #af-social-panel .row { display: flex; gap: 8px; margin-bottom: 8px; }
      #af-social-panel .btn { flex: 1; padding: 8px; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; color: var(--af-c-bg); }
      #af-social-panel .btn-g { background: var(--af-c-amber); }
      #af-social-panel .btn-b { background: var(--af-c-sky-deep); color: var(--af-c-light-soft); }
      #af-social-panel .st { color: var(--af-c-text-dim); font-size: 12px; min-height: 16px; }
    `;
    document.head.appendChild(css);
    // 📜 任务按钮 + 面板
    const tbtn = document.createElement('div');
    tbtn.id = 'af-task-btn';
    tbtn.textContent = '📜 任务';
    document.body.appendChild(tbtn);
    const tpanel = document.createElement('div');
    tpanel.id = 'af-task-panel';
    tpanel.innerHTML = '<div class="hd"><b>📜 任务书</b><span class="x" id="af-task-x">✕</span></div><div id="af-task-list"><div style="color:var(--af-c-text-dim)">加载中…</div></div>';
    document.body.appendChild(tpanel);
    AFUNI.on(tbtn, () => { tpanel.style.display = 'flex'; refreshTasks(); });
    AFUNI.on(tpanel.querySelector('#af-task-x'), () => { tpanel.style.display = 'none'; }, { cls: false });
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
    AFUNI.on(spanel.querySelector('#af-sp-x'), () => { spanel.style.display = 'none'; }, { cls: false });
    AFUNI.on(spanel.querySelector('#af-sp-send'), () => {
      const t = spanel.querySelector('#af-sp-talk').value.trim();
      if (t && spTarget) { sendSocial('talk', { target: spTarget, text: t }); spanel.querySelector('#af-sp-talk').value = ''; }
    });
    AFUNI.on(spanel.querySelector('#af-sp-fav'), () => { if (spTarget) sendSocial('fav', { target: spTarget }); }, { cls: false });
    spanel.querySelector('#af-sp-give').onkeydown = (e) => {
      if (e.key === 'Enter') {
        const m = /(\d+)\s*(\d*)/.exec(spanel.querySelector('#af-sp-give').value.trim());
        if (m && spTarget) { sendSocial('give', { target: spTarget, itemId: Number(m[1]), num: Number(m[2] || 1) }); spanel.querySelector('#af-sp-give').value = ''; }
      }
    };
    AFUNI.on(spanel.querySelector('#af-sp-bind'), () => {         if (spTarget) sendSocial('bind', { target: spTarget, type: spanel.querySelector('#af-sp-rel').value }); toast('已绑定 ' + spTarget, 'ok'); }, { cls: false });
    AFUNI.on(spanel.querySelector('#af-sp-tp'), () => { if (spTarget) sendSocial('tp', { target: spTarget }); }, { cls: false });
  }
  function openSocialPanel(uid2) {
    try {
      if (!window.__AF_OPEN_SOCIAL__) return;
      const p = remotePlayers.get(uid2);
      window.__AF_OPEN_SOCIAL__(uid2, p ? p.nick : uid2);
    } catch (e) {}
  }

  // ---------- 1:1 私聊面板（💬 按钮 + 左侧已解锁列表 + 右侧聊天框）----------
  function injectDmUI() {
    if (document.getElementById('af-dm-btn')) return;
    const css = document.createElement('style');
    css.textContent = `
      #af-dm-btn { position: fixed; top: 46px; left: 56px; z-index: 99990; cursor: pointer;
        background: var(--af-c-glass-panel); color: var(--af-c-gold); border: 1px solid var(--af-c-moss); border-radius: 6px;
        padding: 5px 10px; font: 13px "Microsoft YaHei", sans-serif; box-shadow: 0 2px 6px var(--af-c-black-40); }
      #af-dm-btn:hover { background: var(--af-c-glass-solid); }
      #af-dm-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 100000;
        width: 540px; max-width: 94vw; display: none; flex-direction: column;
        background: linear-gradient(180deg,var(--af-c-panel-deep),var(--af-c-panel-deep)); border: 2px solid var(--af-c-wood); border-radius: 10px;
        box-shadow: 0 8px 30px var(--af-c-black-70); font: 13px "Microsoft YaHei", sans-serif; }
      #af-dm-panel .hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;
        border-bottom: 1px solid var(--af-c-panel); }
      #af-dm-panel .hd b { color: var(--af-c-gold); font-size: 15px; }
      #af-dm-panel .hd .x { cursor: pointer; color: var(--af-c-text-dim); font-size: 16px; padding: 0 6px; }
      #af-dm-panel .hd .x:hover { color: var(--af-c-danger); }
      #af-dm-panel .bd { display: flex; flex: 1; min-height: 340px; }
      #af-dm-panel .list { width: 170px; border-right: 1px solid var(--af-c-panel); overflow-y: auto; padding: 8px 0; }
      #af-dm-panel .list .dm-peer { padding: 7px 14px; color: var(--af-c-text); cursor: pointer; }
      #af-dm-panel .list .dm-peer:hover { background: var(--af-c-glow-gold); }
      #af-dm-panel .list .dm-empty { color: var(--af-c-text-dim); padding: 10px 14px; font-size: 12px; }
      #af-dm-panel .chat-col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
      #af-dm-panel .chat-name { padding: 8px 14px; color: var(--af-c-text); font-size: 12px; border-bottom: 1px solid var(--af-c-panel-deep); }
      #af-dm-panel .chat-name b { color: var(--af-c-gold); font-size: 14px; }
      #af-dm-panel .chat-name .st { color: var(--af-c-text-dim); font-size: 11px; margin-left: 8px; }
      #af-dm-panel #af-dm-log { flex: 1; overflow-y: auto; padding: 10px 14px; color: var(--af-c-text); line-height: 1.7; }
      #af-dm-panel #af-dm-log .dm-line { margin-bottom: 6px; }
      #af-dm-panel #af-dm-log .dm-line.me { color: var(--af-c-sky-bright); }
      #af-dm-panel #af-dm-log .dm-at { color: var(--af-c-text-dim); font-size: 11px; margin-right: 6px; }
      #af-dm-panel #af-dm-log .dm-nick { color: var(--af-c-gold); font-size: 12px; }
      #af-dm-panel #af-dm-log .dm-empty { color: var(--af-c-text-dim); text-align: center; margin-top: 40px; }
      #af-dm-panel .chat-input { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--af-c-panel); }
      #af-dm-panel .chat-input input { flex: 1; background: var(--af-c-bg); color: var(--af-c-light-soft); border: 1px solid var(--af-c-panel);
        border-radius: 6px; padding: 7px 9px; font: 13px "Microsoft YaHei", sans-serif; outline: none; }
      #af-dm-panel .chat-input button { background: var(--af-c-amber); border: 0; border-radius: 6px; padding: 7px 14px;
        cursor: pointer; font: 13px "Microsoft YaHei", sans-serif; }
      #af-dm-panel .chat-input button:hover { background: var(--af-c-amber); }
    `;
    document.head.appendChild(css);
    const btn = document.createElement('div');
    btn.id = 'af-dm-btn';
    btn.textContent = '💬 私聊';
    AFUNI.on(btn, () => openDmPanel(null));
    document.body.appendChild(btn);
    const panel = document.createElement('div');
    panel.id = 'af-dm-panel';
    panel.innerHTML = `
      <div class="hd"><b>💬 我的私聊</b><span class="x" id="af-dm-x">✕</span></div>
      <div class="bd">
        <div class="list" id="af-dm-peers"></div>
        <div class="chat-col">
          <div class="chat-name"><b id="af-dm-name">未选择</b><span class="st" id="af-dm-status"></span></div>
          <div id="af-dm-log"><div class="dm-empty">左侧选择一位已解锁的私聊对象</div></div>
          <div class="chat-input">
            <input id="af-dm-input" placeholder="输入消息，Enter 发送" maxlength="500">
            <button id="af-dm-send">发送</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(panel);
    AFUNI.on(panel.querySelector('#af-dm-x'), () => { panel.style.display = 'none'; }, { cls: false });
    const inp = panel.querySelector('#af-dm-input');
    const send = () => {
      const t = inp.value.trim();
      const targetUid = dmCache.target;
      if (!targetUid) { if (window.__AF_CHAT_ADD__) window.__AF_CHAT_ADD__('系统', '先选一位已解锁对象'); return; }
      if (!t) return;
      sendDm(targetUid, t);
      inp.value = '';
    };
    AFUNI.on(panel.querySelector('#af-dm-send'), send);
    inp.onkeydown = (e) => { if (e.key === 'Enter') send(); };
    requestDmUnlockedList();
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

  // ---------- C8 美术资产：服务端 /af/art-manifest + /af/art/{id}.png 交付 ----------
  // load(id) 取 PNG dataURL（缓存）；toSprite(id, {parent,x,y,w,h,name}) 挂 Cocos 节点（best-effort：
  // 无 Cocos 运行环境/节点不存在时静默 no-op，不碰原版外壳）。
  if (!window.__AF_ART__) {
    const art = {
      manifest: null,
      _cache: new Map(),
      _img: new Map(),
      fetchManifest() {
        if (this.manifest) return Promise.resolve(this.manifest);
        return fetch(SERVER + '/af/art-manifest')
          .then(r => r.json())
          .then(d => { this.manifest = (d && d.manifest) || null; return this.manifest; })
          .catch(() => { this.manifest = null; return null; });
      },
      item(id) {
        return this.manifest && this.manifest.queue ? this.manifest.queue.find(q => q.id === Number(id)) : null;
      },
      dataUrl(id) {
        if (this._cache.has(id)) return Promise.resolve(this._cache.get(id));
        return fetch(SERVER + '/af/art/' + Number(id) + '.png')
          .then(async r => {
            if (!r.ok) throw new Error('art ' + id + ' -> HTTP ' + r.status);
            const buf = new Uint8Array(await r.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
            const url = 'data:image/png;base64,' + btoa(bin);
            this._cache.set(id, url);
            return url;
          });
      },
      image(id) {
        if (this._img.has(id)) return this._img.get(id);
        const p = this.dataUrl(id).then(u => new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => { this._img.set(id, im); res(im); };
          im.onerror = e => rej(e);
          im.src = u;
        }));
        this._img.set(id, p);
        return p;
      },
      // Cocos 节点级贴图（复用 mapgrid 注入的 Texture2D/SpriteFrame 模式）
      toSprite(id, opts = {}) {
        try {
          if (typeof cc === 'undefined' || !cc.director) return null; // 无 Cocos 环境：静默 no-op
          const parent = opts.parent && opts.parent.isValid ? opts.parent : null;
          if (!parent) return null;
          const node = new cc.Node('afArt_' + id);
          const sprite = node.addComponent(cc.Sprite);
          parent.addChild(node);
          if (opts.x !== undefined || opts.y !== undefined) node.setPosition(cc.v2(opts.x || 0, opts.y || 0));
          if (opts.name) node.name = opts.name;
          this.image(id).then(im => {
            if (!sprite.isValid) return;
            const tex = new cc.Texture2D();
            tex.initWithElement(im);
            tex.handleLoadedTexture();
            const sf = new cc.SpriteFrame(tex);
            sf.setRect(new cc.Rect(0, 0, im.width, im.height));
            sprite.spriteFrame = sf;
            sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            node.width = opts.w || im.width;
            node.height = opts.h || im.height;
          }).catch(() => { try { node.destroy(); } catch (e) {} });
          return node;
        } catch (e) { console.warn('[AF] art.toSprite 跳过（Cocos 环境不可用）:', e && e.message); return null; }
      },
    };
    window.__AF_ART__ = art;
  }

  window.__AF__ = { uid, nick, get remotePlayers() { return remotePlayers; } };
  console.log('[AF] AgentFarm2 注入层就绪 uid=' + uid + ' nick=' + nick + ' sync=' + syncReady);

  tryAutoLogin(); // 启动流程：自动登录或弹登录框（放在所有定义之后）

  // ★ 区域名兜底定时器：每 500ms 强制覆盖，防止原版代码在 mod 之前写入旧名
  setInterval(() => { try { injectAreaName(); } catch (e) {} }, 500);
})();
