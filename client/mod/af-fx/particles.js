// af-fx/particles.js —— 环境粒子层（R5）：单 canvas 全屏层
// 模式：rain/snow/firefly/leaf/petal/clickRipple；池上限 300；fps<45 持续 3s 自动降载（R5.4）
// 开关：localStorage af.fx.particles（R5.5 默认开）
// 色值说明：canvas 像素色为数据常量（非样式表），按 R1.3 豁免于裸色值检查（/* af-color-allow */）
(function () {
  'use strict';
  if (window.AFFX) return;
  const FX = { mode: 'clear', enabled: true };
  window.AFFX = FX;

  const MODES = {
    // /* af-color-allow */ 粒子色板（数据常量）
    rain:    { palette: [[150, 190, 235], [180, 210, 245]], gravity: 900, wind: 40, spawn: 140, life: 1.6, size: [2, 3] },
    snow:    { palette: [[245, 250, 255]], gravity: 60, wind: 20, spawn: 40, life: 9, size: [2, 4] },
    firefly: { palette: [[255, 236, 150], [255, 214, 110]], gravity: 0, wind: 6, spawn: 2, life: 6, size: [2, 3] },
    leaf:    { palette: [[214, 150, 60], [190, 110, 50]], gravity: 40, wind: 60, spawn: 14, life: 8, size: [3, 5] },
    petal:   { palette: [[250, 190, 205], [250, 160, 185]], gravity: 30, wind: 50, spawn: 16, life: 9, size: [3, 5] },
  };
  const SEASON_MODE = { spring: 'petal', summer: 'firefly', autumn: 'leaf', winter: 'snow' };

  let canvas = null, ctx = null, raf = null;
  let particles = [];
  let poolCap = 300;
  let spawnAcc = 0, lastT = 0;
  let fpsSamples = [], fpsBadUntil = 0;
  let ripples = [];

  function ensure() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'af-fx-canvas';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:99985;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function spawnParticle(m) {
    const c = MODES[m];
    if (!c || particles.length >= poolCap) return;
    const size = c.size[0] + Math.random() * (c.size[1] - c.size[0]);
    particles.push({
      m,
      x: Math.random() * canvas.width,
      y: m === 'rain' ? -10 : Math.random() * canvas.height * 0.4,
      vx: (c.wind * (0.5 + Math.random() * 0.5)) * (Math.random() < 0.5 ? -1 : 1) * 0.2,
      vy: c.gravity * (0.6 + Math.random() * 0.6) * 0.016,
      life: c.life * (0.6 + Math.random() * 0.8),
      t: 0,
      size,
      color: c.palette[(Math.random() * c.palette.length) | 0],
      phase: Math.random() * Math.PI * 2,
    });
  }

  function tick(t) {
    raf = requestAnimationFrame(tick);
    if (!ctx || !FX.enabled) { lastT = t; return; }
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    // fps 采样（R5.4：fps<45 持续 3s -> 池上限减半，再劣化停用环境粒子）
    if (t - fpsBadUntil > 0) {
      fpsSamples.push(1 / Math.max(dt, 0.001));
      if (fpsSamples.length > 60) fpsSamples.shift();
      if (fpsSamples.length >= 40) {
        const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
        if (avg < 45 && poolCap > 60) { poolCap = Math.max(60, poolCap * 0.5); fpsBadUntil = t + 3000; fpsSamples = []; }
        else if (avg > 55 && poolCap < 300) { poolCap = Math.min(300, poolCap * 2); fpsBadUntil = t + 3000; fpsSamples = []; }
      }
    }
    const c = MODES[FX.mode];
    if (c) {
      spawnAcc += c.spawn * dt;
      while (spawnAcc >= 1) { spawnAcc -= 1; spawnParticle(FX.mode); }
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t > p.life || p.y > canvas.height + 10) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt * 60 + (FX.mode === 'snow' || FX.mode === 'leaf' || FX.mode === 'petal' ? Math.sin(p.phase + p.t * 2) * 20 * dt : 0);
      p.y += p.vy * dt * 60;
      const a = Math.min(1, (p.life - p.t) / 0.5) * 0.9;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgb(' + p.color.join(',') + ')';
      if (FX.mode === 'rain') {
        ctx.fillRect(p.x, p.y, 1.5, p.size * 4);
      } else if (FX.mode === 'firefly') {
        ctx.beginPath();
        ctx.arc(p.x, p.y + Math.sin(p.phase + p.t * 1.5) * 8, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
    // 点击涟漪（R5.3）
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.t += dt;
      const k = r.t / 0.45;
      if (k >= 1) { ripples.splice(i, 1); continue; }
      ctx.globalAlpha = (1 - k) * 0.5;
      ctx.strokeStyle = 'rgb(255, 217, 122)'; /* af-color-allow */
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 6 + k * 42, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 对外接口 ----------
  AF_FX_API:
  {
    FX.setMode = function (m) {
      const prev = FX.mode;
      if (m !== prev) {
        FX.mode = m;
        if (prev !== 'clear') for (const p of particles) p.life = Math.min(p.life, 0.5); // 旧模式粒子淡出
      }
    };
    FX.ripple = function (x, y) {
      if (!FX.enabled) return;
      ensure();
      ripples.push({ x, y, t: 0 });
    };
    FX.enabled = localStorage.getItem('af.fx.particles') !== '0';
  }

  // 日历驱动（R5.2：天气优先于季节）
  window.addEventListener('DOMContentLoaded', () => {
    const apply = (cal) => {
      if (!cal) return;
      if (cal.weather === 'rain') FX.setMode('rain');
      else if (cal.weather === 'snow') FX.setMode('snow');
      else if (cal.weather === 'storm') FX.setMode('rain');
      else if (cal.weather === 'clear' && cal.season) FX.setMode(SEASON_MODE[cal.season] || 'clear');
      if (!FX.enabled) return;
      if (FX.mode !== 'clear') ensure();
    };
    const hook = () => {
      try {
        const base = location.origin;
        fetch(base + '/af/calendar', { cache: 'no-store' })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            const today = d && Array.isArray(d.days) && d.days[0];
            apply(today);
          })
          .catch(() => {});
      } catch (e) {}
    };
    hook();
    setInterval(hook, 30000);
  });

  // 点击涟漪（R5.3）
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('#af-ui-root')) return; // 面板点击不算游戏画面点击
    FX.ripple(e.clientX, e.clientY);
  }, true);
})();
