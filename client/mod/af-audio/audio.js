// af-audio/audio.js —— 情境音频系统（R8，M5 代码侧）
// - 首次交互解锁 AudioContext（R8.3 浏览器自动播放策略）
// - BGM：昼夜双轨 + 季节滤镜（playbackRate/低通映射，R8.1 变调方案；≥2s 交叉淡化）
//   曲目源：CC0 文件（assets/audio-cc0/bgm/，缺省时用程序生成的氛围轨，R8.5 静默降级）
// - SFX 线索 9 项（R8.2：点击/按下/成功/失败/金币/开关面板/环境/对话框）
// - 设置：BGM/SFX 独立开关 + 音量，localStorage af.audio.*（R8.4）
// - 解码失败/5s 超时 -> 静默降级（R8.5）
(function () {
  'use strict';
  if (window.AFAUD) return;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const AFAUD = {
    ctx: null,
    sfxGain: null,
    bgmLayers: [], // {src, gain, filter}
    sfxCache: new Map(),
    cues: ['click', 'press', 'ok', 'err', 'coin', 'open', 'close', 'dialog', 'ambient'],
    enabled: { bgm: LS.get('af.audio.bgm', '1') === '1', sfx: LS.get('af.audio.sfx', '1') === '1' },
    volume: { bgm: Math.min(1, Math.max(0, Number(LS.get('af.audio.bgmVol', 0.5)) || 0.5)), sfx: Math.min(1, Math.max(0, Number(LS.get('af.audio.sfxVol', 0.8)) || 0.8)) },
  };
  window.AFAUD = AFAUD;

  function ensureCtx() {
    if (AFAUD.ctx) return AFAUD.ctx.state === 'suspended' ? AFAUD.ctx : AFAUD.ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      AFAUD.ctx = new AC();
      AFAUD.sfxGain = AFAUD.ctx.createGain();
      AFAUD.sfxGain.gain.value = AFAUD.volume.sfx;
      AFAUD.sfxGain.connect(AFAUD.ctx.destination);
    } catch (e) { AFAUD.ctx = null; }
    return AFAUD.ctx;
  }

  // R8.3：首次 pointerdown/keydown 解锁
  const unlock = () => {
    const ctx = ensureCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (AFAUD.enabled.bgm && typeof AFAUD.setBgmMode === 'function') AFAUD.setBgmMode(AFAUD._lastMode || 'day');
  };
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });

  // ---------- SFX（decodeAudioData；失败/5s 超时静默降级 R8.5） ----------
  AFAUD.play = function (cue) {
    if (!AFAUD.enabled.sfx || AFAUD.cues.indexOf(cue) < 0) return;
    const ctx = ensureCtx();
    if (!ctx || ctx.state !== 'running') return;
    let node = AFAUD.sfxCache.get(cue);
    if (node) {
      const s = ctx.createBufferSource();
      s.buffer = node;
      const g = ctx.createGain();
      g.gain.value = 1;
      s.connect(g); g.connect(AFAUD.sfxGain);
      s.start();
      return;
    }
    const t0 = Date.now();
        fetch('assets/audio-cc0/sfx/sfx-' + cue + '.wav')
      .then(r => { if (Date.now() - t0 > 5000) throw new Error('slow'); if (!r.ok) throw new Error('http'); return r.arrayBuffer(); })
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => {
        AFAUD.sfxCache.set(cue, decoded);
        const s = ctx.createBufferSource();
        s.buffer = decoded;
        s.connect(AFAUD.sfxGain);
        s.start();
      })
      .catch(() => { /* R8.5 静默降级 */ });
  };

  // ---------- BGM：昼夜双轨（CC0 文件优先；缺省程序生成氛围轨）+ 季节滤镜 ----------
  const SEASON_BPM = { spring: 1.0, summer: 1.06, autumn: 0.97, winter: 0.94 };
  const SEASON_LOW = { spring: 9000, summer: 11000, autumn: 6500, winter: 4500 }; // 低通截止（Hz）

  function generativeTone(ctx, freqs, dur, loop, dest) {
    // 程序氛围轨：柔和五声音阶 pluck 序列（昼）/ 慢速小调琶音（夜）
    const now = ctx.currentTime;
    const seq = loop ? freqs.concat(freqs) : freqs;
    const step = dur / seq.length;
    seq.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * step);
      g.gain.linearRampToValueAtTime(0.16, now + i * step + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + (i + 1) * step);
      o.connect(g); g.connect(dest);
      o.start(now + i * step);
      o.stop(now + (i + 1) * step + 0.05);
    });
  }

  function loadBgmFile(ctx, url, dest) {
    return fetch(url).then(r => { if (!r.ok) throw new Error('http'); return r.arrayBuffer(); })
      .then(buf => ctx.decodeAudioData(buf));
  }

  AFAUD.setBgmMode = function (mode, season) {
    const ctx = ensureCtx();
    if (!ctx || ctx.state !== 'running' || !AFAUD.enabled.bgm) return;
    if (AFAUD._lastMode === mode) { applySeasonFilter(season); return; }
    AFAUD._lastMode = mode;
    const cross = 2.5; // ≥2s 交叉淡化（R8.1）
    const now = ctx.currentTime;
    for (const L of AFAUD.bgmLayers) {
      L.gain.gain.cancelScheduledValues(now);
      L.gain.gain.setValueAtTime(L.gain.gain.value, now);
      L.gain.gain.linearRampToValueAtTime(0.0001, now + cross);
      const old = L;
      setTimeout(() => { try { old.src.stop(); } catch (e) {} }, cross * 1000 + 100);
    }
    AFAUD.bgmLayers = AFAUD.bgmLayers.filter(() => false);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = SEASON_LOW[season] || 8000;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.linearRampToValueAtTime(AFAUD.volume.bgm, now + cross);
    filter.connect(gain);
    gain.connect(ctx.destination);
    const layer = { src: null, gain, filter, mode };
    AFAUD.bgmLayers.push(layer);
    // CC0 曲目（昼夜各 1 首母带；文件缺失走程序生成兜底）
    const dayFreqs = [261.6, 329.6, 392.0, 523.3, 587.3, 659.3];
    const nightFreqs = [220.0, 261.6, 311.1, 349.2, 440.0];
    const fileUrl = 'assets/audio-cc0/bgm/bgm-' + mode + '.ogg';
    loadBgmFile(ctx, fileUrl, filter)
      .then((buf) => {
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.loop = true;
        s.playbackRate.value = SEASON_BPM[season] || 1;
        s.connect(filter);
        s.start();
        layer.src = s;
      })
      .catch(() => {
        // 程序生成氛围轨（循环调度）
        const timer = setInterval(() => {
          if (!AFAUD.enabled.bgm || !ctx || ctx.state !== 'running') { clearInterval(timer); return; }
          if (mode === 'day') generativeTone(ctx, dayFreqs, 8, true, filter);
          else generativeTone(ctx, nightFreqs, 10, true, filter);
        }, 2000);
        layer._genTimer = timer;
      });
    function applySeasonFilter(se) {
      try {
        const g = ctx.createBiquadFilter;
        AFAUD.bgmLayers.forEach((L) => {
          L.filter.frequency.setTargetAtTime(SEASON_LOW[se] || 8000, ctx.currentTime, 0.4);
          if (L.src) L.src.playbackRate.setTargetAtTime(SEASON_BPM[se] || 1, ctx.currentTime, 0.4);
        });
        void g;
      } catch (e) {}
    }
  };

  // ---------- 日历驱动（昼夜/季节/天气 -> BGM 模式；天气叠加滤镜） ----------
  let lastCal = null;
  const calPoll = () => {
    try {
      fetch(location.origin + '/af/calendar', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d || !Array.isArray(d.days) || !d.days[0]) return;
          const today = d.days[0];
          const h = Number(today.hour !== undefined ? today.hour : (today.time !== undefined ? today.time : 12));
          const mode = h >= 5 && h < 19 ? 'day' : 'night';
          const season = today.season || 'summer';
          if (lastCal && lastCal.mode === mode && lastCal.season === season) return;
          lastCal = { mode, season };
          AFAUD.setBgmMode(mode, season);
        })
        .catch(() => {});
    } catch (e) {}
  };
  setInterval(calPoll, 30000);

  // ---------- 设置接口（R8.4 持久化） ----------
  AFAUD.setToggle = function (which, on) {
    AFAUD.enabled[which] = !!on;
    LS.set('af.audio.' + which, on ? '1' : '0');
    if (which === 'sfx' && AFAUD.sfxGain) AFAUD.sfxGain.gain.value = on ? AFAUD.volume.sfx : 0;
    if (which === 'bgm') {
      if (!on) {
        const ctx = AFAUD.ctx;
        if (ctx) for (const L of AFAUD.bgmLayers) L.gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      } else {
        if (AFAUD._lastMode) AFAUD.setBgmMode(AFAUD._lastMode, 'summer');
      }
    }
  };
  AFAUD.setVolume = function (which, v) {
    AFAUD.volume[which] = Math.min(1, Math.max(0, Number(v) || 0));
    LS.set('af.audio.' + which + 'Vol', String(AFAUD.volume[which]));
    if (which === 'sfx' && AFAUD.sfxGain) AFAUD.sfxGain.gain.value = AFAUD.enabled.sfx ? AFAUD.volume.sfx : 0;
    if (which === 'bgm' && AFAUD.ctx) for (const L of AFAUD.bgmLayers) L.gain.gain.setTargetAtTime(AFAUD.enabled.bgm ? AFAUD.volume.bgm : 0, AFAUD.ctx.currentTime, 0.3);
  };
})();
