// af-fx/atmosphere.js —— Cocos 氛围注入（R6/R7，M4 代码侧；实机效果待用户验收）
// 全部反射调用 try/catch 隔离（R9.3）；纯函数（时段插值/LUT 映射）挂 window.AFATMO 供单测。
(function () {
  'use strict';
  if (window.AFATMO) return;

  // ---------- 纯函数：时段色调（晨金/昼白/暮橙/夜蓝） ----------
  const TIME_STOPS = [
    // /* af-color-allow */ 氛围色表（数据常量）
    { h: 5, tint: [255, 214, 150], alpha: 0.20 },  // 晨金
    { h: 8, tint: [255, 255, 245], alpha: 0.06 },  // 昼白
    { h: 17, tint: [255, 255, 245], alpha: 0.06 },
    { h: 19, tint: [255, 170, 90], alpha: 0.26 },  // 暮橙
    { h: 21, tint: [60, 80, 160], alpha: 0.34 },   // 夜蓝
    { h: 24, tint: [40, 60, 130], alpha: 0.40 },
  ];
  /** 游戏小时(0-24) -> 时段色调 {r,g,b,a}（分段线性插值） */
  function tintOf(hour) {
    const h = ((hour % 24) + 24) % 24;
    let a = TIME_STOPS[0], b = TIME_STOPS[TIME_STOPS.length - 1];
    for (let i = 0; i < TIME_STOPS.length - 1; i++) {
      if (h >= TIME_STOPS[i].h && h <= TIME_STOPS[i + 1].h) { a = TIME_STOPS[i]; b = TIME_STOPS[i + 1]; break; }
    }
    const k = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
    const mix = (x, y) => Math.round(x + (y - x) * k);
    return { r: mix(a.tint[0], b.tint[0]), g: mix(a.tint[1], b.tint[1]), b: mix(a.tint[2], b.tint[2]), a: a.alpha + (b.alpha - a.alpha) * k };
  }

  // 季节 LUT（R6.2：春嫩绿/夏浓绿/秋金/冬灰白，低强度叠色）
  const SEASON_TINT = {
    // /* af-color-allow */
    spring: { r: 200, g: 255, b: 190, a: 0.10 },
    summer: { r: 150, g: 220, b: 160, a: 0.12 },
    autumn: { r: 250, g: 200, b: 120, a: 0.14 },
    winter: { r: 220, g: 230, b: 245, a: 0.16 },
  };
  // 天气滤镜（R6.3：雨冷色/雪亮化/风暴暗压）
  const WEATHER_TINT = {
    // /* af-color-allow */
    rain: { r: 150, g: 170, b: 210, a: 0.16 },
    snow: { r: 245, g: 250, b: 255, a: 0.22 },
    storm: { r: 40, g: 45, b: 70, a: 0.34 },
  };

  /** 合成最终叠加色：时段 x 季节 x 天气（加权平均，alpha 取最大） */
  function compositeTint(hour, season, weather) {
    const t = tintOf(hour);
    let r = t.r, g = t.g, b = t.b, a = t.a, w = 1;
    const s = SEASON_TINT[season];
    if (s) { const m = 0.5; r = r * (1 - m) + s.r * m; g = g * (1 - m) + s.g * m; b = b * (1 - m) + s.b * m; a = Math.max(a, s.a); }
    const wT = WEATHER_TINT[weather];
    if (wT) { const m = 0.4; r = r * (1 - m) + wT.r * m; g = g * (1 - m) + wT.g * m; b = b * (1 - m) + wT.b * m; a = Math.max(a, wT.a * 0.9); }
    void w;
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: Math.min(0.6, a) };
  }

  // ---------- 反射注入（R6/R7；API 缺失静默跳过） ----------
  let overlayNode = null, glowNodes = new Map(), breathTimer = null;

  function sceneRoot() {
    try {
      const mods = window.__AF_MODS__;
      const App = mods && mods['Application'] && mods['Application'].exports;
      const app = App && App.default && App.default.getIns && App.default.getIns();
      return app && (app.pnlSceneLayer || (window.cc && cc.director && cc.director.getScene())) || null;
    } catch (e) { return null; }
  }

  /** 在场景层挂全屏 tint 叠加节点（Graphics 矩形 + 半透明色；运行时反射，零文件修改） */
  function applyOverlay(tint) {
    try {
      const root = sceneRoot();
      if (!root || !window.cc) return;
      if (!overlayNode || !overlayNode.isValid) {
        const n = new window.cc.Node('af-tint-overlay');
        root.addChild(n);
        const g = n.addComponent(window.cc.Graphics);
        overlayNode = n;
        overlayNode._afGraphics = g;
      }
      if (overlayNode._afGraphics) {
        const W = 4000, H = 4000;
        overlayNode._afGraphics.clear();
        overlayNode._afGraphics.fillColor = new window.cc.Color(tint.r, tint.g, tint.b, Math.round(tint.a * 255));
        overlayNode._afGraphics.rect(-W / 2, -H / 2, W, H);
        overlayNode._afGraphics.fill();
      }
    } catch (e) { console.warn('[AFATMO] overlay 注入跳过:', e.message); }
  }

  /** 夜间灯笼光晕（R6.4：程序生成径向渐变贴图，挂光晕节点） */
  function applyLanternGlow(night, art) {
    try {
      const root = sceneRoot();
      if (!root || !window.cc) return;
      if (!night) {
        for (const n of glowNodes.values()) { if (n.isValid) n.destroy(); }
        glowNodes.clear();
        return;
      }
      if (glowNodes.size) return;
      // 单色径向 alpha 贴图（程序生成，不生图）
      const S = 64;
      const cvs = document.createElement('canvas');
      cvs.width = cvs.height = S;
      const cx = cvs.getContext('2d');
      const grad = cx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
      grad.addColorStop(0, 'rgba(255,214,140,0.85)'); /* af-color-allow 灯笼光晕渐变（程序生成贴图） */
      grad.addColorStop(1, 'rgba(255,214,140,0)'); /* af-color-allow */
      cx.fillStyle = grad;
      cx.fillRect(0, 0, S, S);
      const tex = new window.cc.Texture2D();
      tex.init(cvs);
      // 为场景内灯笼资产（名含 lantern/deng 或 af-art 灯笼）挂光晕子节点
      const found = [];
      root.walk((n) => {
        if (found.length < 12 && /lantern|deng/i.test(n.name || '')) found.push(n);
      });
      for (const ln of found) {
        const g = new window.cc.Node('af-lantern-glow');
        ln.addChild(g);
        const s = g.addComponent(window.cc.Sprite);
        s.spriteFrame = new window.cc.SpriteFrame();
        s.spriteFrame.texture = tex;
        g.scale = 3.2;
        g.opacity = 160;
        glowNodes.set(ln.uuid, g);
      }
      void art;
    } catch (e) { console.warn('[AFATMO] 光晕注入跳过:', e.message); }
  }

  /** 主角待机呼吸（R7.2：1-2px 等效幅度；用 scale 微脉动实现——不碰位置，避免与原版位置管理竞争） */
  function startBreathing() {
    if (breathTimer) return;
    breathTimer = setInterval(() => {
      try {
        const mods = window.__AF_MODS__;
        const App = mods && mods['Application'] && mods['Application'].exports;
        const node = App && App.default && App.default.getIns && App.default.getIns().playerNode;
        if (!node || !node.isValid || !window.cc) return;
        const t = performance.now() / 1000;
        const k = 1 + Math.sin(t * 1.4) * 0.012; // ~1.2% 脉动（64px 角色 ≈ 亚像素-2px 视觉幅度）
        node.setScale(k, k, 1);
      } catch (e) { /* 隔离 */ }
    }, 66);
  }
  function stopBreathing() {
    if (breathTimer) { clearInterval(breathTimer); breathTimer = null; }
    try {
      const mods = window.__AF_MODS__;
      const App = mods && mods['Application'] && mods['Application'].exports;
      const node = App && App.default && App.default.getIns && App.default.getIns().playerNode;
      if (node && node.isValid && node.setScale) node.setScale(1, 1, 1);
    } catch (e) {}
  }

  // ---------- 对外 API（纯函数可单测；update 由 mod 主循环按游戏时刻/日历驱动） ----------
  window.AFATMO = {
    tintOf, compositeTint,
    SEASON_TINT, WEATHER_TINT, TIME_STOPS,
    update(hour, season, weather, opts = {}) {
      try {
        const tint = compositeTint(hour, season, weather);
        applyOverlay(tint);
        applyLanternGlow(weather === 'storm' ? false : hour >= 19 || hour < 5, opts.art);
        if (opts.idle !== false) startBreathing(); else stopBreathing();
      } catch (e) { console.warn('[AFATMO] update 失败（降级停用）:', e.message); }
    },
    dispose() {
      stopBreathing();
      try { if (overlayNode && overlayNode.isValid) overlayNode.destroy(); } catch (e) {}
      for (const n of glowNodes.values()) { try { if (n.isValid) n.destroy(); } catch (e) {} }
      glowNodes.clear();
      overlayNode = null;
    },
  };
})();
