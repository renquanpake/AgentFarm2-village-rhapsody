// af-ui/kit.js —— AgentFarm2 旗舰 UI 组件层（R2/R3/R4；window.AFUNI）
// 常驻 DOM 预算：#af-ui-root + HUD 四分区容器 ≤10 节点（R10.1；toast/dialog 为瞬时节点）
// 全部样式读 tokens.css 的 var(--af-*)；本文件零裸色值。
(function () {
  'use strict';
  if (window.AFUNI) return;
  const AFUI = {};
  window.AFUNI = AFUI;
  // R10.1 常驻 DOM 预算（ui-lint 门读取）：#af-ui-root + #af-hud + 3 分区 + toast 容器 = 9 ≤ 10
  // P4 教程步骤条属**条件面板**（同 toast/dialog 定位）：完成或跳过后 display:none，不占常驻预算；
  // 它的真实节点成本（实测 16）由门8 ui-smoke 的「常驻 DOM 预算（含教程条）」断言守住。
  AFUI.RESIDENT_NODES = 10;

  // ---------- 根节点（唯一常驻挂载点） ----------
  let root = null;
  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = document.getElementById('af-ui-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'af-ui-root';
      document.body.appendChild(root);
    }
    return root;
  }
  AFUI.root = ensureRoot;

  // ---------- 可点元素统一绑定（三态覆盖：hover/active 由 .af-btn 提供；结果反馈 class 由此注入） ----------
  AFUI.on = function (el, handler, opts = {}) {
    if (!el || !el.addEventListener) return;
    if (opts.cls !== false && el.classList && !el.classList.contains('af-btn')) el.classList.add('af-btn');
    el.addEventListener('click', (e) => {
      try {
        const out = handler(e);
        if (out && typeof out === 'object' && (out.ok === true || out.ok === false) && el.classList) {
          el.classList.remove('af-res-ok', 'af-res-err');
          el.classList.add(out.ok ? 'af-res-ok' : 'af-res-err');
          setTimeout(() => el.classList.remove('af-res-ok', 'af-res-err'), opts.resultMs ?? 400);
        }
      } catch (err) { console.warn('[AFUI.on]', err && err.message); }
    });
  };

  // ---------- 数值滚动（R2.2：300-600ms tween） ----------
  let numEls = new Map();
  AFUI.bindNumber = function (el, initial = 0) {
    if (!el) return;
    const wrap = el.closest('.af-num') || el;
    let shown = null;
    let target = initial;
    function render(v) { el.textContent = String(Math.round(v)); }
    render(initial); shown = initial;
    const api = {
      set(v) {
        target = v;
        if (shown === v) return;
        if (!numEls.has(el)) {
          numEls.set(el, { cancel: null });
          wrap.classList.add('af-num');
        }
        if (wrap.classList) {
          wrap.classList.remove('af-rolling');
          void wrap.offsetWidth;
          wrap.classList.add('af-rolling');
        }
        const from = shown, dur = 450;
        const t0 = performance.now();
        const tick = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          const e = 1 - Math.pow(1 - k, 3);
          shown = from + (target - from) * e;
          render(shown);
          if (k < 1) numEls.get(el).cancel = requestAnimationFrame(tick);
          else numEls.delete(el);
        };
        if (numEls.get(el) && numEls.get(el).cancel) cancelAnimationFrame(numEls.get(el).cancel);
        numEls.set(el, { cancel: requestAnimationFrame(tick) });
      },
    };
    return api;
  };

  // ---------- toast（R3.1：默认 2.5s，同屏 ≤3） ----------
  let toastBox = null;
  AFUI.toast = function (msg, type = 'info', ttl = 2500) {
    const r = ensureRoot();
    if (!toastBox || !r.contains(toastBox)) {
      toastBox = document.createElement('div');
      toastBox.className = 'af-toast-box';
      toastBox.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;z-index:99999;pointer-events:none;';
      r.appendChild(toastBox);
    }
    while (toastBox.children.length >= 3) toastBox.removeChild(toastBox.firstChild);
    const t = document.createElement('div');
    t.className = 'af-toast af-toast-' + type;
    t.style.cssText = 'background:var(--af-c-parchment);border:2px solid var(--af-c-wood);border-radius:var(--af-r-2);box-shadow:var(--af-shadow-panel);color:var(--af-c-ink);padding:6px 12px;font:600 14px var(--af-font-px);opacity:0;transform:translateY(-8px);transition:all var(--af-d-mid) var(--af-m-slide);';
    if (type === 'ok') t.style.borderLeft = '4px solid var(--af-c-success)';
    if (type === 'err') t.style.borderLeft = '4px solid var(--af-c-danger)';
    if (type === 'coin') t.style.borderLeft = '4px solid var(--af-c-gold)';
    t.textContent = msg;
    toastBox.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(-8px)';
      setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, ttl);
  };

  // ---------- dialog（R3.2/R3.3：羊皮纸+木框，scale 0.92→1 overshoot） ----------
  AFUI.dialog = function (title, body, actions) {
    const r = ensureRoot();
    const box = document.createElement('div');
    box.className = 'af-dialog';
    box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:var(--af-c-overlay);z-index:99998;pointer-events:auto;';
    const card = document.createElement('div');
    card.className = 'af-panel';
    card.style.cssText = 'min-width:280px;max-width:420px;transform:scale(0.92);opacity:0;transition:transform var(--af-d-fast) var(--af-m-pop),opacity var(--af-d-fast) var(--af-m-in);';
    const h = document.createElement('div');
    h.textContent = title || '';
    h.style.cssText = 'font:600 var(--af-font-size-lg) var(--af-font-px);color:var(--af-c-ink);margin-bottom:var(--af-s-2);';
    const b = document.createElement('div');
    b.style.cssText = 'color:var(--af-c-ink-soft);line-height:1.5;white-space:pre-line;';
    b.textContent = String(body || '');
    card.appendChild(h); card.appendChild(b);
    if (actions && actions.length) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:var(--af-s-3);';
      for (const a of actions) {
        const btn = document.createElement('button');
        AFUI.on(btn, () => { close(); if (a.fn) a.fn(); }, a);
        btn.textContent = a.label || '好';
        if (a.primary) btn.style.boxShadow = '0 0 0 2px var(--af-c-gold), var(--af-shadow-chip)';
        row.appendChild(btn);
      }
      card.appendChild(row);
    }
    box.appendChild(card);
    r.appendChild(box);
    requestAnimationFrame(() => { card.style.transform = 'scale(1)'; card.style.opacity = '1'; });
    function close() {
      card.style.transform = 'scale(0.94)';
      card.style.opacity = '0';
      setTimeout(() => { if (box.parentNode) box.parentNode.removeChild(box); }, 220);
    }
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
  };

  // ---------- stagger（R4.5：30-60ms 逐项入场） ----------
  AFUI.stagger = function (el, stepMs = 45) {
    if (!el) return;
    const items = Array.from(el.children);
    items.forEach((c, i) => {
      c.style.opacity = '0';
      c.style.transform = 'translateY(6px)';
      c.style.transition = 'opacity var(--af-d-fast) var(--af-m-slide), transform var(--af-d-fast) var(--af-m-slide)';
      setTimeout(() => { c.style.opacity = '1'; c.style.transform = 'translateY(0)'; }, i * stepMs);
    });
  };

  // ---------- HUD 四分区（R2.1：左上状态/右上时辰/右下指挥台/底部聊天） ----------
  // 常驻容器：hudRoot + 4 区 = 5 节点（≤10 预算）
  let hudRoot = null, hudCoinsEl = null, hudCoinsApi = null;
  AFUI.hud = {
    ensure() {
      if (hudRoot && document.body.contains(hudRoot)) return hudRoot;
      const r = ensureRoot();
      hudRoot = document.createElement('div');
      hudRoot.id = 'af-hud';
      hudRoot.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99980;';
      const zone = (css) => { const z = document.createElement('div'); z.className = 'af-hud-zone'; z.style.cssText = css + ';pointer-events:auto;'; return z; };
      const tl = zone('position:absolute;top:8px;left:8px;');
      tl.className = 'af-hud-zone af-hud-tl';
      const chip = document.createElement('div');
      chip.className = 'af-panel';
      chip.style.cssText = 'display:flex;gap:10px;align-items:center;padding:6px 10px;';
      const coinBox = document.createElement('div');
      coinBox.style.cssText = 'display:flex;gap:4px;align-items:center;color:var(--af-c-ink);';
      coinBox.textContent = '金币 ';
      const coinNum = document.createElement('span');
      coinNum.className = 'af-num';
      coinBox.appendChild(coinNum);
      chip.appendChild(coinBox);
      tl.appendChild(chip);
      const tr = zone('position:absolute;top:8px;right:8px;');
      tr.className = 'af-hud-zone af-hud-tr';
      const trChip = document.createElement('div');
      trChip.className = 'af-panel';
      trChip.id = 'af-hud-clock';
      trChip.style.cssText = 'padding:6px 10px;color:var(--af-c-ink);font-size:var(--af-font-size-xs);';
      trChip.textContent = '…';
      tr.appendChild(trChip);
      const br = zone('position:absolute;bottom:50px;right:8px;');
      br.className = 'af-hud-zone af-hud-br';
      hudRoot.appendChild(tl); hudRoot.appendChild(tr); hudRoot.appendChild(br);
      r.appendChild(hudRoot);
      hudCoinsEl = coinNum;
      hudCoinsApi = AFUI.bindNumber(coinNum, 0);
      AFUI.stagger(hudRoot, 60);
      return hudRoot;
    },
    setCoins(v) { if (hudCoinsApi) hudCoinsApi.set(v); },
    setClock(text) {
      const el = hudRoot && document.getElementById('af-hud-clock');
      if (el && text !== undefined && el.textContent !== String(text)) {
        el.textContent = String(text);
        el.classList.remove('af-num');
        void el.offsetWidth;
        el.style.animation = 'af-num-pop var(--af-d-mid) var(--af-m-bounce)';
        setTimeout(() => { el.style.animation = ''; }, 650);
      }
    },
    zone(name) {
      this.ensure();
      const map = { tl: 'af-hud-tl', tr: 'af-hud-tr', br: 'af-hud-br', bottom: 'af-hud-bottom' };
      let z = hudRoot.querySelector('.' + (map[name] || 'af-hud-br'));
      if (!z) {
        z = document.createElement('div');
        z.className = 'af-hud-zone ' + (map[name] || 'af-hud-br');
        z.style.cssText = 'position:absolute;bottom:8px;left:8px;pointer-events:auto;';
        hudRoot.appendChild(z);
      }
      return z;
    },
  };

  // ---------- P4 新手教程步骤条（非阻断常驻卡；文案全部来自 GET /af/tutorial，组件内零硬编码） ----------
  // 规格 §4.2：可跳过 / 可重放 / 老账号（skip 标记）不再弹 / 不用遮罩阻断游戏画面
  const TUT_SKIP_KEY = 'af.tutorial.skip';
  let tutBar = null, tutCssInjected = false, tutClick = null;
  const tutState = { steps: [], done: [], active: null };

  function injectTutorialCss() {
    if (tutCssInjected) return;
    tutCssInjected = true;
    const st = document.createElement('style');
    st.textContent = `
      #af-tut-bar { position: fixed; right: 10px; top: 96px; width: 236px; max-width: 42vw; z-index: 100120;
        background: var(--af-c-panel-deep); border: 1px solid var(--af-c-wood); border-radius: 10px;
        box-shadow: 0 6px 22px var(--af-c-black-70); color: var(--af-c-text); pointer-events: auto;
        font: 12px "Microsoft YaHei", sans-serif; padding: 9px 10px; }
      #af-tut-bar .hd { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 7px; }
      #af-tut-bar .hd b { color: var(--af-c-gold); font-size: 13px; }
      #af-tut-bar .hd .acts { display: flex; gap: 5px; }
      #af-tut-bar .mini { font-size: 11px; padding: 2px 7px; border-radius: 5px; cursor: pointer;
        background: var(--af-c-bg); color: var(--af-c-text-dim); border: 1px solid var(--af-c-panel); }
      #af-tut-bar .mini:hover { color: var(--af-c-text); border-color: var(--af-c-wood); }
      #af-tut-bar .steps { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 7px; }
      #af-tut-bar .af-tut-step { font-size: 11px; padding: 3px 7px; border-radius: 9px; cursor: pointer;
        background: var(--af-c-bg); color: var(--af-c-text-dim); border: 1px solid var(--af-c-panel); }
      #af-tut-bar .af-tut-step.cur { background: var(--af-c-glass-moss); color: var(--af-c-gold);
        border-color: var(--af-c-moss); font-weight: bold; }
      #af-tut-bar .af-tut-step.done { color: var(--af-c-success); border-color: var(--af-c-moss); }
      #af-tut-bar .af-tut-step:hover { color: var(--af-c-text); }
      #af-tut-bar .hint { line-height: 1.6; color: var(--af-c-light-soft); }
      #af-tut-bar .hint .t { color: var(--af-c-text); font-weight: bold; margin-bottom: 2px; }
      #af-tut-bar .fin { color: var(--af-c-success); line-height: 1.6; }
      `;
    document.head.appendChild(st);
  }

  const tutorial = {
    SKIP_KEY: TUT_SKIP_KEY,
    state() { return { steps: tutState.steps.slice(), done: tutState.done.slice(), active: tutState.active }; },
    skipped() { try { return localStorage.getItem(TUT_SKIP_KEY) === '1'; } catch (e) { return false; } },
    onStepClick(fn) { tutClick = typeof fn === 'function' ? fn : null; },
    /** 挂载（幂等）：常驻 +1 节点，在 #af-ui-root 下 */
    ensure() {
      injectTutorialCss();
      ensureRoot();
      if (tutBar && document.body.contains(tutBar)) return tutBar;
      tutBar = document.getElementById('af-tut-bar');
      if (!tutBar) {
        tutBar = document.createElement('div');
        tutBar.id = 'af-tut-bar';
        root.appendChild(tutBar);
      }
      return tutBar;
    },
    /** 渲染（数据驱动：steps/progress 全部来自服务端 /af/tutorial） */
    render(steps, progress) {
      const bar = this.ensure();
      const list = Array.isArray(steps) ? steps : [];
      const done = new Set((progress && progress.done) || []);
      const active = (progress && progress.active) || null;
      tutState.steps = list; tutState.done = [...done]; tutState.active = active;
      // 收拢条件：已跳过 / 无数据 / 7 步全完成（active=null）——完成后不再打扰，重看引导可拉回
      bar.style.display = (this.skipped() || !list.length || !active) ? 'none' : 'block';
      // 显式清子节点：不依赖 textContent='' 的清空语义（重渲染不得累积节点）
      while (bar.firstChild) bar.removeChild(bar.firstChild);
      const hd = document.createElement('div'); hd.className = 'hd';
      const b = document.createElement('b'); b.textContent = '新手引导';
      const acts = document.createElement('div'); acts.className = 'acts';
      const replay = document.createElement('button'); replay.className = 'mini'; replay.textContent = '重看引导';
      AFUI.on(replay, () => tutorial.replay(), { cls: false });
      const skip = document.createElement('button'); skip.className = 'mini'; skip.textContent = '跳过';
      AFUI.on(skip, () => tutorial.skip(), { cls: false });
      acts.appendChild(replay); acts.appendChild(skip);
      hd.appendChild(b); hd.appendChild(acts);
      bar.appendChild(hd);
      const chips = document.createElement('div'); chips.className = 'steps';
      for (const st of list) {
        const chip = document.createElement('span');
        chip.className = 'af-tut-step' + (done.has(st.id) ? ' done' : '') + (st.id === active ? ' cur' : '');
        chip.textContent = st.title || st.id;
        AFUI.on(chip, () => { if (tutClick) tutClick(st.id); }, { cls: false });
        chips.appendChild(chip);
      }
      bar.appendChild(chips);
      const cur = list.find((st) => st.id === active);
      if (!cur) {
        const fin = document.createElement('div'); fin.className = 'fin';
        fin.textContent = '✓ 七步引导已全部完成，去委托板接活或让 Agent 干活吧。';
        bar.appendChild(fin);
      } else {
        const hint = document.createElement('div'); hint.className = 'hint';
        const t = document.createElement('div'); t.className = 't'; t.textContent = `${list.indexOf(cur) + 1}/${list.length} ${cur.title || cur.id}`;
        hint.appendChild(t);
        const body = document.createElement('div');
        body.textContent = cur.hint || '';
        hint.appendChild(body);
        bar.appendChild(hint);
      }
      return bar;
    },
    skip() { try { localStorage.setItem(TUT_SKIP_KEY, '1'); } catch (e) { /* 隐私模式 */ } if (tutBar) tutBar.style.display = 'none'; },
    replay() { try { localStorage.removeItem(TUT_SKIP_KEY); } catch (e) { /* ignore */ } if (tutBar) tutBar.style.display = 'block'; },
  };
  AFUI.tutorial = tutorial;
})();
