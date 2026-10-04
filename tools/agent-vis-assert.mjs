// tools/agent-vis-assert.mjs —— 批1 P1.3/P1.4 画面可视化五场景活体断言（RED 基线 / 终局 GREEN）
//
// 验的是「agent 动作在玩家画面实时可见」的 P0 命题（服务端生效但画面无表现 = P0）：
//   A dir 步随    agent act move dir ×6 → node 位移 == 服务端位移（±40px/步），终漂移 ≤440px
//   B 行为飘字    move_to 到可砍树 → act chop → floatCount() ≥1（P1.3 待实现 → RED）
//   C 黑洞重放    blackhole(3) 丢弃 3 条 → act move → 400ms 后解除 → 等 ≤2.5s node 对齐服务端（P1.1 待实现 → RED）
//   D 终点对齐    act move_to → 等 done/20s → node 距服务端 ≤40px（P1.2 待实现 → RED）
//   E 面板文案    act chop 后 #af-agent-live-t / #af-hud-agent 文本含「砍|正在」
//
// 页面侧契约（Task 2-4 实现）：localStorage.af.test==='1' 时 window.__AF_TEST__ =
//   { node():{x,y,scene}|null, serverPos():{x,y,scene}|null, blackhole(n), floatCount():number }
//
// 用法：node tools/agent-vis-assert.mjs --base http://127.0.0.1:8097 [--out /tmp/af-vis] [--user v --pass p]
//   exit 1 于任何 FAIL；report.json 每场景 pass/expected/actual
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const arg = (k, d = null) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const CHROME = process.env.AF_CHROME
  || '/root/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome';
const BASE = arg('base', 'http://127.0.0.1:8097').replace(/\/$/, '');
const OUT = arg('out', '/tmp/af-vis');
const USER = arg('user', 'vis_' + Date.now() % 1e6);
const PASS = arg('pass', 'vis_pass_1');
const WAIT = Number(arg('wait', 15000)); // move_to 长路程的宽限
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const j = async (p, b) => {
  const r = await fetch(BASE + p, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {});
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { ok: false, raw: t.slice(0, 120) }; }
};

// ---------- 备号 / 铸 agent token ----------
let acc = await j('/af/register', { username: USER, password: PASS });
if (!acc.token) acc = await j('/af/login', { username: USER, password: PASS });
if (!acc.token) { console.error('[agent-vis] 备号失败'); process.exit(1); }
const ag = await j('/af/agent-token', { token: acc.token });
if (!ag.agentToken) { console.error('[agent-vis] agent-token 失败'); process.exit(1); }
console.log(`[agent-vis] 账号 ${USER} uid=${acc.uid}`);

// ---------- 结果收集 ----------
const results = [];
const check = (name, cond, expected, actual) => {
  results.push({ name, pass: !!cond, expected, actual });
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${actual ? ` | ${actual}` : ''}`);
};

// ---------- 启动浏览器（复用 shot-session 生命周期；1440x900 是「开始游戏」按钮坐标公式标定口径） ----------
const VPW = Number(arg('viewport-w', 1440)), VPH = Number(arg('viewport-h', 900));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--window-size=${VPW},${VPH}`] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: VPW, height: VPH, deviceScaleFactor: 1 });
  await page.setCacheEnabled(false);
  const consoleErrors = [];
  const resource404s = [];
  // 静态资源 404（favicon 等）是资源缺失信号，归入 resource404s；JS 野错（pageerror / 非资源 console error）才计 P0 野错
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = String(m.text());
    if (/Failed to load resource/i.test(t)) { resource404s.push(t.slice(0, 120)); return; }
    consoleErrors.push(t.slice(0, 200));
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 200)));

  // 身份 + 测试钩子旗标在页面脚本执行前注入（免登录直达；af.test=1 才注册 __AF_TEST__）
  await page.evaluateOnNewDocument((c) => {
    try {
      localStorage.setItem('af_token', c.token);
      localStorage.setItem('af_uid', c.uid);
      localStorage.setItem('af_nick', c.nick);
      localStorage.setItem('af.test', '1');
    } catch (e) { /* ignore */ }
  }, { token: acc.token, uid: acc.uid, nick: USER });

  // 注：不另开 /ws 连接——join 是单点登录，会踢掉客户端页面的连接。
  // 观察节点/服务端位置一律走页面钩子 __AF_TEST__；_agent 通道只下 act 指令。
  // /agent 在页面 boot 前接入：state.online 尚无 → agentPos 走存档回落 = 客户端节点出生位，天然对齐。

  // 注：不另开 /ws 连接——join 是单点登录，会踢掉客户端页面的连接。
  // 观察一律走页面钩子 __AF_TEST__；/agent 在「游戏世界就绪」之后才接入，
  // 此时页面 posTimer 已把真实节点坐标同步进 state.online，agentPos 起步即与画面对齐。
  await page.goto(BASE + '/?ci=1', { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => console.log('[agent-vis] goto 警告（客户端可能未就绪）'));

  // 1) mod 钩子注册（af.test=1 时 IIFE 顶层定义 __AF_TEST__）
  const hook = await page.waitForFunction('window.__AF_TEST__ !== undefined', { timeout: 20000 })
    .then(() => 'ok').catch(() => 'MISSING-TEST-HOOK');
  // 1.5) 关掉 mod 新手引导弹层（「连接你的 Agent」弹窗居中，会挡住原版「开始游戏」按钮——shot-session 同款坑）
  for (let i = 0; i < 10; i++) {
    const dismissed = await page.evaluate(() => {
      const texts = ['稍后再说', '✕', '关闭'];
      for (const t of texts) {
        const el = [...document.querySelectorAll('button, .x, [data-act="back"]')].find(e => (e.innerText || '').trim() === t && e.offsetParent !== null);
        if (el) { el.click(); return t; }
      }
      return null;
    }).catch(() => null);
    if (!dismissed) break;
    console.log(`[agent-vis] 已关弹层: ${dismissed}`);
    await sleep(800);
  }
  // 2) 等原版主菜单出现「开始游戏」并点击
  //    主路径用 ClickEvent.emit 直派发（tools/_probe13.mjs 已验 fired=1/1，鼠标坐标点击在软渲染下不落点）；
  //    循环内持续尝试关弹层（引导弹窗可能延迟出现，会挡住按钮）
  let startClicked = false, btnSeen = false;
  const t0boot = Date.now();
  while (Date.now() - t0boot < 200000 && !startClicked) {
    await sleep(2000);
    if (hook !== 'ok') continue;
    await page.evaluate(() => {
      const texts = ['稍后再说', '✕', '关闭'];
      for (const t of texts) {
        const el = [...document.querySelectorAll('button, .x, [data-act="back"]')].find(e => (e.innerText || '').trim() === t && e.offsetParent !== null);
        if (el) { el.click(); return; }
      }
    }).catch(() => {});
    const fired = await page.evaluate(() => {
      try {
        const scene = cc.director.getRunningScene ? cc.director.getRunningScene() : cc.director.getScene();
        if (!scene) return 'no-scene';
        let hit = null;
        scene.walk((n) => { if (hit || !n.activeInHierarchy) return; const lb = n.getComponent && n.getComponent(cc.Label); if (lb && /开始游戏/.test(lb.string || '')) hit = n; });
        if (!hit) return 'label-not-found';
        let node = hit;
        for (let i = 0; i < 5 && node; i++) {
          const btn = node.getComponent && node.getComponent(cc.Button);
          if (btn) {
            const evs = btn.clickEvents || [];
            if (!evs.length) return 'no-click-events';
            let n = 0;
            for (const ce of evs) { try { ce.emit([btn]); n++; } catch (e) { return 'emit-err'; } }
            return 'fired=' + n + '/' + evs.length;
          }
          node = node.parent;
        }
        return 'no-button-ancestor';
      } catch (e) { return 'err ' + String(e.message).slice(0, 50); }
    }).catch(() => 'eval-err');
    if (String(fired).startsWith('fired')) {
      btnSeen = true;
      startClicked = true;
      console.log(`[agent-vis] 已点「开始游戏」（ClickEvent.emit ${fired}）t=${Math.round((Date.now() - t0boot) / 1000)}s`);
      break;
    }
    // 兜底：坐标点击（emit 路径不通时）
    if (Date.now() - t0boot > 60000 && !btnSeen) {
      const btn = await page.evaluate(`(() => {
        try {
          const scene = cc.director.getRunningScene ? cc.director.getRunningScene() : cc.director.getScene(); if (!scene) return null;
          let hit = null;
          scene.walk((n) => { if (hit || !n.activeInHierarchy) return; const lb = n.getComponent && n.getComponent(cc.Label); if (lb && /开始游戏/.test(lb.string||'')) hit = n; });
          if (!hit) return null;
          const wp = hit.parent ? hit.parent.convertToWorldSpaceAR(hit.position) : hit.position;
          return { x: Math.round(${VPW / 1920} * wp.x), y: Math.round(${VPH} - ${VPW / 1920} * wp.y) };
        } catch (e) { return null; }
      })()`).catch(() => null);
      if (btn) {
        btnSeen = true;
        await page.mouse.click(btn.x, btn.y).catch(() => {});
        startClicked = true;
        console.log(`[agent-vis] 已点「开始游戏」@(${btn.x},${btn.y})（坐标兜底）t=${Math.round((Date.now() - t0boot) / 1000)}s`);
      }
    }
  }
  // 2.5) 进村：原版流程是 主菜单 → 开始游戏 → 存档面板 → 点槽 →（新号）改名框 → 确定
  //      存档槽走原版自定义 MouseEventMgr，ClickEvent/坐标点击都不落点；
  //      直接调组件入口（实测 tools/_probe21.mjs 拿到的方法体）：
  //        storageItem.onClick(e) 需 e.getButton()===BUTTON_LEFT；无存档时先弹 UiRename
  //        UiRename.onBtnSure() 才真正 startGame(storageKey)
  const enterVillage = () => {
    try {
      const scene = cc.director.getRunningScene ? cc.director.getRunningScene() : cc.director.getScene();
      if (!scene) return 'no-scene';
      let slot = null;
      scene.walk((n) => { if (!slot && n.activeInHierarchy && /^storageItem1$/.test(n.name)) slot = n; });
      if (!slot) return 'no-slot';
      let clicked = false;
      for (const c of (slot.getComponents(cc.Component) || [])) {
        if (c && typeof c.onClick === 'function' && typeof c.storageKey === 'number') {
          c.onClick({ getButton: () => cc.Event.EventMouse.BUTTON_LEFT });
          clicked = true;
          break;
        }
      }
      if (!clicked) return 'no-slot-comp';
      let rn = null;
      scene.walk((n) => { if (!rn && n.name === 'UiRename' && n.activeInHierarchy) rn = n; });
      if (rn) {
        for (const c of (rn.getComponents(cc.Component) || [])) {
          if (c && typeof c.onBtnSure === 'function') {
            try { if (c.editBoxName && !c.editBoxName.string) c.editBoxName.string = 'vis'; } catch (e) { /* ignore */ }
            c.onBtnSure();
            return 'slot+sure';
          }
        }
        return 'slot(rename-open)';
      }
      return 'slot-clicked';
    } catch (e) { return 'err ' + String(e.message).slice(0, 70); }
  };
  let slotClicked = false, slotSeen = false;
  const t0slot = Date.now();
  while (Date.now() - t0slot < 150000 && !slotClicked) {
    await sleep(2000);
    const r = await page.evaluate(enterVillage).catch(() => 'err');
    if (r === 'slot+sure' || r === 'slot-clicked') {
      slotSeen = true; slotClicked = true;
      console.log(`[agent-vis] 已点存档槽（${r}）t=${Math.round((Date.now() - t0slot) / 1000)}s`);
      break;
    }
    await page.evaluate(() => {
      const texts = ['稍后再说', '✕', '关闭'];
      for (const t of texts) {
        const el = [...document.querySelectorAll('button, .x, [data-act="back"]')].find(e => (e.innerText || '').trim() === t && e.offsetParent !== null);
        if (el) { el.click(); return; }
      }
    }).catch(() => {});
  }
  // 3) 等 Cocos 玩家节点挂载（Application.playerNode 挂上即世界就绪；轻量直读避免 scene.walk 反复开销；软件 WebGL 下村景贴图慢，给 240s）
  const boot = hook !== 'ok' ? hook
    : await page.waitForFunction(`(() => { try { const m=window.__AF_MODS__; const A=m&&m['Application']&&m['Application'].exports; const i=A&&A.default&&A.default.getIns&&A.default.getIns(); return !!(i&&i.playerNode&&i.playerNode.isValid); } catch (e) { return false; } })()`, { timeout: 240000, polling: 1500 })
      .then(() => 'ok').catch(() => 'GAME-NOT-READY');
  check('boot：页面加载 & __AF_TEST__ 就位 & 玩家节点就绪', boot === 'ok', '__AF_TEST__ + node() 非 null',
    `${boot}${btnSeen ? '' : ' | 未见开始游戏按钮'}${slotSeen ? '' : ' | 未点存档槽'}${resource404s.length ? ' | 资源404 x' + resource404s.length : ''}`);

  // agent WS（游戏就绪后才接入，下 act 指令）
  const aws = new WebSocket(BASE.replace(/^http/, 'ws') + '/agent?token=' + encodeURIComponent(ag.agentToken));
  await new Promise((res) => aws.on('open', res));
  await sleep(1000);
  let seq = 0;
  const act = (action, payload = {}, ms = 20000) => new Promise((resolve) => {
    const s = ++seq;
    const onMsg = (d) => { const m = JSON.parse(d.toString()); if ((m.t === 'result' || m.t === 'move_started') && m.action === action && m.seq === s) { aws.off('message', onMsg); resolve(m); } };
    aws.on('message', onMsg);
    aws.send(JSON.stringify({ t: 'act', action, seq: s, ...payload }));
    setTimeout(() => { aws.off('message', onMsg); resolve(null); }, ms);
  });

  const ts = (v) => `window.__AF_TEST__ && window.__AF_TEST__.${v}`;
  const nodePos = async () => page.evaluate(`${ts('node()')}  ? JSON.parse(JSON.stringify(window.__AF_TEST__.node())) : null`);
  const serverPos = async () => page.evaluate(`${ts('serverPos()')} ? JSON.parse(JSON.stringify(window.__AF_TEST__.serverPos())) : null`);
  const floatCount = async () => page.evaluate(`(window.__AF_TEST__ && typeof window.__AF_TEST__.floatCount === 'function') ? window.__AF_TEST__.floatCount() : -1`);
  const setBlackhole = async (n) => page.evaluate(`${ts('blackhole')} ? window.__AF_TEST__.blackhole(${n}) : 0`);
  const doneCount = async () => page.evaluate(`(window.__AF_TEST__ && typeof window.__AF_TEST__.doneCount === 'function') ? window.__AF_TEST__.doneCount() : -1`);

  // 等 move_to 走完（页面钩子计 agent_move_done，串行避免服务端「上个移动没走完」拒单）
  const waitAgentDone = async (timeoutMs = 45000) => {
    const base = await doneCount();
    const t0 = Date.now();
    for (;;) {
      const n = await doneCount();
      if (n > base) return true;
      if (Date.now() - t0 > timeoutMs) return false;
      await sleep(400);
    }
  };
  const moveToDone = async (target, ms = 45000) => {
    const r = await act('move_to', target, ms);
    const done = await waitAgentDone(ms);
    return { r, done };
  };

  // ---------- 场景 A：dir 步随 ----------
  // 先读服务端位置锚点（无 agent_move 帧则先发 1 步 dir 生成锚点），再 dir ×5 共 6 步，比对 node 与服务端位移
  let apos0 = await serverPos();
  await sleep(800);
  if (!apos0) {
    const w = await act('move', { dir: 'down' }, 8000);
    if (w && w.ok) { const sp = await serverPos(); apos0 = sp ? { x: sp.x, y: sp.y } : null; }
  }
  let aOk = false, aInfo = '';
  if (apos0) {
    for (const dir of ['down', 'down', 'down', 'down', 'down']) {
      await act('move', { dir }, 8000);
      await sleep(250);
    }
    const a1 = await nodePos();
    const a2 = await serverPos();
    if (a1 && a2) {
      const dn = Math.hypot(a1.x - apos0.x, a1.y - apos0.y);
      const ds = Math.hypot(a2.x - apos0.x, a2.y - apos0.y);
      aOk = Math.abs(dn - ds) <= 40 * 6 && Math.hypot(a1.x - a2.x, a1.y - a2.y) <= 440;
      aInfo = `node 位移 ${dn.toFixed(0)} vs 服务端 ${ds.toFixed(0)}; 终距 ${Math.hypot(a1.x - a2.x, a1.y - a2.y).toFixed(0)}px`;
    } else aInfo = 'node/serverPos 不可用';
  } else aInfo = '初始 serverPos 为 null';
  check('A dir 步随：node 位移≈服务端且终漂移 ≤440px', aOk, '|Δnode-Δserver| ≤240 且 dist ≤440', aInfo);

  // ---------- 场景 C：黑洞重放 ----------
  // blackhole(3) → 发 3 步 dir move（每步 1 条 agent_move，共 3 帧全入 pending）
  // → 400ms 后解除黑洞 → posTimer flush 重放 → 等 ≤2.5s node 对齐服务端
  const cBase = apos0 ? apos0 : { x: 3500, y: 3000 };
  setBlackhole(3);
  for (let i = 0; i < 3; i++) await act('move', { dir: 'right' }, 8000);
  await sleep(400);
  setBlackhole(0);
  await sleep(2500);
  const c1 = await nodePos(), c2 = await serverPos();
  check('C 黑洞重放：解除后 2.5s 内 node 对齐服务端', !!(c1 && c2 && Math.hypot(c1.x - c2.x, c1.y - c2.y) <= 40),
    'dist ≤40px', c1 && c2 ? `dist ${Math.hypot(c1.x - c2.x, c1.y - c2.y).toFixed(0)}px` : 'node/serverPos null');
  check('C-blackhole 钩子可用（RED 信号）', boot === 'ok', 'blackhole() 存在', boot);

  // ---------- 场景 D：move_to 终点对齐 ----------
  // 串行：move_to 后必须等 agent_move_done（服务端走完）再读终点，避免与下一场景并发被拒单
  const dTarget = { x: 3350, y: 550 };
  const { r: dres, done: dDone } = await moveToDone(dTarget);
  await sleep(1500);
  const d1 = await nodePos(), d2 = await serverPos();
  check('D move_to 终点对齐：node 距服务端 ≤40px', !!(d1 && d2 && Math.hypot(d1.x - d2.x, d1.y - d2.y) <= 40),
    'dist ≤40px', d1 && d2 ? `dist ${Math.hypot(d1.x - d2.x, d1.y - d2.y).toFixed(0)}px (done=${dDone})` : 'null (done=' + dDone + ')');
  check('D-move_to 可发起（服务端未回 error）', !!dres, 'move_started', dres?.msg || dres?.t || 'timeout');

  // ---------- 场景 B/E：行为飘字 + 面板文案 ----------
  // D 走后在当前位置附近找树丛（observe.regions 格坐标），move_to 到树丛边缘再 chop
  let chopRes = null, chopped = false;
  const obs = await act('observe', {}, 8000);
  const regions = (obs && obs.obstacles && Array.isArray(obs.obstacles.regions)) ? obs.obstacles.regions : [];
  const treeR = regions.find(r => String(r.name).includes('树'));
  let chopTarget = null;
  if (treeR) {
    const cx = Math.round((treeR.x1 + treeR.x2) / 2), cy = Math.round((treeR.y1 + treeR.y2) / 2);
    chopTarget = { x: cx * 100 + 50, y: cy * 100 + 50 };
    await moveToDone({ x: treeR.x1 * 100 + 50, y: treeR.y1 * 100 + 50 }, 45000); // 到树丛边缘
    chopRes = await act('chop', chopTarget, 15000);
    chopped = !!(chopRes && (chopRes.ok || /砍/.test(String(chopRes.msg || ''))));
  }
  await sleep(1200);
  const fc = await floatCount();
  check('B 行为飘字：chop 后 floatCount ≥1', fc >= 1, '≥1', `fc=${fc} chopped=${chopped} msg=${(chopRes && chopRes.msg) || 'n/a'}`);
  const liveT = await page.evaluate(() => (document.getElementById('af-agent-live-t') || { textContent: '' }).textContent);
  const hudT = await page.evaluate(() => (document.getElementById('af-hud-agent') || { textContent: '' }).textContent);
  check('E 面板文案：chop 后含「砍|正在」', /砍|正在/.test(String(liveT) + ' ' + String(hudT)),
    '/砍|正在/', (liveT + '|' + hudT).slice(0, 60));

  check('页面 console error = 0（P0 无野错）', consoleErrors.length === 0, '0', consoleErrors[0] || '0');

  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ base: BASE, user: USER, results, pass: results.filter((r) => r.pass).length, total: results.length, consoleErrors }, null, 2));
  const passN = results.filter((r) => r.pass).length;
  console.log(`----\n[agent-vis] ${passN}/${results.length} 通过 | report: ${OUT}/report.json`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
} catch (e) {
  console.error('[agent-vis] 异常：' + (e && e.message));
  process.exit(1);
} finally {
  await browser.close().catch(() => {});
}