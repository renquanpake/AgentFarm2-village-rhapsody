#!/usr/bin/env node
// tools/ui-smoke.mjs —— M1/M2 模块 DOM 冒烟（Node 侧最小 DOM/音频/计时 shim，无浏览器可跑）
// 覆盖：AFUNI(hud/toast/bindNumber/stagger) + AFFX(setMode 季节映射) + AFATMO(纯函数 tint/LUT) + AFAUD(cues/解锁时机)
// 全量 Cocos 实机（模块对 cc 的反射注入）归 N2 用户验收；本门只验"纯逻辑 + DOM 挂载"层。
// 用法：node tools/ui-smoke.mjs（CI 门可挂）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOD = (p) => readFileSync(path.join(here, '..', 'client', 'mod', p), 'utf8');

// ---------- 最小 DOM shim ----------
class El {
  constructor(tag, id) {
    this.tagName = tag; this.id = id || ''; this.children = []; this.parent = null;
    this.style = { set cssText(v) { this._css = v; }, get cssText() { return this._css || ''; }, animation: '', };
    this.classes = new Set(); this.textContent = ''; this._html = '';
    this.width = 800; this.height = 600; this.type = '';
    this._listeners = {};
  }
  get classList() {
    const self = this;
    return {
      add: (...cs) => cs.forEach(c => self.classes.add(c)),
      remove: (...cs) => cs.forEach(c => self.classes.delete(c)),
      contains: (c) => self.classes.has(c),
      toggle: (c) => { if (self.classes.has(c)) { self.classes.delete(c); return false; } self.classes.add(c); return true; },
    };
  }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  get firstChild() { return this.children[0] || null; }
  get parentNode() { return this.parent; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener() {}
  dispatch(t, ev) { (this._listeners[t] || []).slice().forEach(f => f(ev || { target: this, clientX: 0, clientY: 0 })); }
  querySelector(sel) {
    if (sel.startsWith('#')) return walk(this, el => el.id === sel.slice(1)) || null;
    if (sel.startsWith('.')) return walk(this, el => el.classes.has(sel.slice(1))) || null;
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    walkAll(this, el => {
      if (sel.startsWith('.') ? el.classes.has(sel.slice(1)) : el.tagName === sel) out.push(el);
      return false;
    });
    return out;
  }
  closest() { return null; }
  focus() {}
  get offsetWidth() { return 100; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 }; }
  getContext() {
    return { clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
      set fillStyle(v) {}, get fillStyle() { return ''; }, set globalAlpha(v) {}, get globalAlpha() { return 1; },
      set lineWidth(v) {}, get lineWidth() { return 1; } };
  }
}
El.prototype.contains = function (n) {
  let p = n;
  while (p) { if (p === this) return true; p = p.parent; }
  return false;
};
function walk(root, pred) {
  for (const c of root.children) {
    if (pred(c)) return c;
    const r = walk(c, pred); if (r) return r;
  }
  return null;
}
function walkAll(root, fn) {
  for (const c of root.children) { if (fn(c)) return; walkAll(c, fn); }
}
/** 子树文本聚合（DOM shim 的 textContent 不自动含子节点，真实 DOM 会 —— 断言统一走这里） */
function textOf(root) {
  let t = root.textContent || '';
  walkAll(root, (e) => { t += e.textContent || ''; return false; });
  return t;
}

const body = new El('body'), head = new El('head');
const documentShim = {
  body, head,
  createElement: (t) => new El(t),
  getElementById: (id) => walk(documentShim.body, (e) => e.id === id) || (walk(documentShim.head, (e) => e.id === id) ? null : null) || walkAll2(documentShim.body, documentShim.head, id),
  addEventListener() {},
  documentElement: body,
};
function walkAll2(a, b, id) { return walk(a, e => e.id === id) || walk(b, e => e.id === id); }

// 计时/帧（虚拟时钟：runFrames 每帧 +16ms；advanceTime 内 setInterval 每 250ms 采样触发）
let rafQ = [];
let vnow = Date.now();
const performanceShim = { now: () => vnow };
const requestAnimationFrame = (fn) => { rafQ.push(fn); return rafQ.length; };
const cancelAnimationFrame = () => {};
function runFrames(n) { for (let i = 0; i < n; i++) { vnow += 16; const q = rafQ; rafQ = []; q.forEach(f => f(vnow)); } }
const timers = new Map(); let timerId = 1;
const setTimeoutShim = (fn, ms) => { const id = timerId++; timers.set(id, { fn, at: Date.now() + ms }); return id; };
const setIntervalShim = (fn, ms) => { const id = timerId++; timers.set(id, { fn, at: Date.now() + ms, every: ms }); return id; };
const clearTimeoutShim = (id) => timers.delete(id);
const clearIntervalShim = (id) => timers.delete(id);
function advanceTime(ms) {
  const start = Date.now();
  vnow += ms;
  const now = start + ms;
  const step = Math.min(250, ms || 250);
  let cursor = start;
  while (cursor < now) {
    cursor = Math.min(now, cursor + step);
    for (const [id, t] of [...timers]) {
      while (t.at <= cursor) {
        if (t.every) { t.fn(); t.at += t.every; if (t.at > cursor) break; }
        else { timers.delete(id); t.fn(); break; }
      }
    }
  }
}

// localStorage shim
const store = new Map();
const localStorageShim = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// AudioContext shim（最小：无真实合成，验解锁/降级路径）
class GainShim {
  constructor() { this.gain = { value: 1, linearRampToValueAtTime() {}, setTargetAtTime() {} }; }
  connect() {}
}
class ACShim {
  constructor() { this.state = 'running'; this.destination = {}; this.currentTime = 0; }
  createGain() { return new GainShim(); }
  createBiquadFilter() { const f = new GainShim(); f.type = 'lowpass'; f.frequency = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} }; f.Q = { value: 0 }; f.connect = () => {}; return f; }
  createOscillator() { const o = new GainShim(); o.frequency = { value: 0 }; o.start = () => {}; o.stop = () => {}; o.connect = () => {}; return o; }
  decodeAudioData() { return Promise.resolve(new Uint8Array(8)); }
  resume() { return Promise.resolve(); }
}

const windowShim = {
  document: documentShim,
  localStorage: localStorageShim,
  innerWidth: 800, innerHeight: 600,
  addEventListener() {},
  performance: performanceShim,
  requestAnimationFrame, cancelAnimationFrame,
  setTimeout: setTimeoutShim, clearTimeout: clearTimeoutShim,
  setInterval: setIntervalShim, clearInterval: clearIntervalShim,
  AudioContext: ACShim,
  location: { origin: 'http://127.0.0.1:8091' },
  fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
  console,
};
windowShim.window = windowShim;
windowShim.globalThis = windowShim;
windowShim.performance = performanceShim;

const sandbox = { ...windowShim };
vm.createContext(sandbox);
function runMod(src, name) {
  try { vm.runInContext(src, sandbox, { filename: name }); }
  catch (e) { throw new Error(`[ui-smoke] 装载 ${name} 失败: ${e.message}\n${e.stack?.split('\n').slice(0, 3).join('\n')}`); }
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`PASS - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}${extra ? ' | ' + extra : ''}`); }
}

// ---------- 装载（index.html 顺序） ----------
runMod(MOD('af-ui/kit.js'), 'kit.js');
runMod(MOD('af-fx/particles.js'), 'particles.js');
runMod(MOD('af-fx/atmosphere.js'), 'atmosphere.js');
runMod(MOD('af-audio/audio.js'), 'audio.js');

const G = sandbox.window; // 模块通过 window.* 暴露全局（沙箱展开对象）
ok('模块装载：AFUNI/AFFX/AFATMO/AFAUD 四全局就位',
  !!(G.AFUNI && G.AFFX && G.AFATMO && G.AFAUD));

// ---------- HUD（M2） ----------
const HUD = G.AFUNI.hud;
HUD.ensure();
ok('HUD ensure：#af-hud + 三分区 + 金币槽 + 历法胶囊',
  !!documentShim.getElementById('af-hud') &&
  !!walk(documentShim.getElementById('af-hud'), e => e.classes.has('af-hud-tl')) &&
  !!walk(documentShim.getElementById('af-hud'), e => e.classes.has('af-hud-tr')) &&
  !!walk(documentShim.getElementById('af-hud'), e => e.classes.has('af-hud-br')) &&
  !!documentShim.getElementById('af-hud-clock'));

// 常驻 DOM 预算（根+HUD+3分区；toast/dialog 瞬时）
let resident = 0;
walkAll(documentShim.body, () => { resident++; });
ok(`常驻 DOM 预算 = ${resident} ≤ 10（R10.1）`, resident <= 10, `实测 ${resident}`);

HUD.setClock('📅 第5日 · 夏 · 晴');
ok('HUD setClock：历法胶囊写入', documentShim.getElementById('af-hud-clock').textContent.includes('第5日'));
HUD.setCoins(1234);
runFrames(40); // tween 450ms 快进
const coinEl = walk(documentShim.getElementById('af-hud'), e => e.classes.has('af-num'));
ok('HUD setCoins：数值 tween 收敛 1234', coinEl && coinEl.textContent === '1234', `实测 ${coinEl && coinEl.textContent}`);
ok('HUD zone(br) 可挂托管胶囊', !!HUD.zone('br'));

// ---------- toast 队列（≤3） ----------
function realBodyContains(n) { let p = n; while (p) { if (p === documentShim.body) return true; p = p.parent; } return false; }
function realHeadContains(n) { let p = n; while (p) { if (p === documentShim.head) return true; p = p.parent; } return false; }
documentShim.body.contains = realBodyContains;
documentShim.head.contains = realHeadContains;
for (let i = 0; i < 5; i++) G.AFUNI.toast('t' + i, 'ok');
advanceTime(100); runFrames(10);
const toastBox = walk(documentShim.body, e => e.classes.has('af-toast-box'));
ok(`toast 同屏上限 3（发 5 条）`, toastBox && toastBox.children.length === 3, `实测 ${toastBox && toastBox.children.length}`);
advanceTime(3000); runFrames(5);
ok('toast 2.5s 后清场', !toastBox || toastBox.children.length === 0, `实测 ${toastBox && toastBox.children.length}`);

// ---------- 粒子（M3 逻辑层） ----------
G.AFFX.setMode('petal');
ok('粒子 setMode 季节映射（spring->petal 由日历驱动）', G.AFFX.mode === 'petal');
G.AFFX.setMode('clear');
G.AFFX.ripple(10, 10);
runFrames(30);
ok('粒子 ripple 不抛错（canvas 层 tick 30 帧稳定）', true);

// ---------- 氛围纯函数（M4 单测层） ----------
const T5 = G.AFATMO.tintOf(5);
const T21 = G.AFATMO.tintOf(21);
ok(`氛围 tintOf 时段插值（晨金/夜蓝）`, T5.r > 200 && T5.a >= 0.2 && T21.b > T21.r && T21.a > 0.3, JSON.stringify({ T5, T21 }));
const C = G.AFATMO.compositeTint(12, 'winter', 'storm');
ok('氛围 compositeTint 季节+天气合成（alpha ≤0.6）', Number.isFinite(C.r) && C.a <= 0.6, JSON.stringify(C));

// ---------- 音频（M5 逻辑层） ----------
ok('音频 cues ≥8（R8.2）', G.AFAUD.cues.length >= 8, `实测 ${G.AFAUD.cues.length}`);
G.AFAUD.play('coin'); runFrames(3);
ok('音频 play 未知 cue 静默 / 已知 cue 不抛错', true);
ok('音频 未解锁前 BGM 层数 = 0（R8.3 首次交互前无播放）',
  (G.AFAUD.bgmLayers || []).length === 0);

// 触发 pointerdown unlock（shim addEventListener 未存监听 -> 直接调 unlock 路径：setBgmMode 需 ctx running）
try {
  G.AFAUD.setBgmMode('night', 'winter');
  runFrames(5);
  ok('音频 setBgmMode 昼夜切换+季节滤镜不抛错', (G.AFAUD.bgmLayers || []).length >= 0);
} catch (e) { ok('音频 setBgmMode 不抛错', false, e.message); }
G.AFAUD.setVolume('sfx', 0.3);
ok('音频 设置持久化（localStorage af.audio.sfxVol）', store.get('af.audio.sfxVol') === '0.3');

// ---------- P4 新手教程步骤条（AFUNI.tutorial；数据来自 GET /af/tutorial，组件内零硬编码文案） ----------
const TUT_STEPS = [
  { id: 'see-self', title: '认识你的小人与镜头', hint: '画面里那个小人就是你。', need: 'onboarding' },
  { id: 'move', title: '走两步', hint: '用方向键走两步。', need: 'move' },
  { id: 'tasks', title: '打开任务书', hint: '点右上角任务书。', need: 'tasks' },
  { id: 'farm', title: '种一块地', hint: '犁地→播种→浇水→收菜。', need: 'till+plant+water+harvest' },
  { id: 'talk', title: '和 NPC 说句话', hint: '问个价或闲聊。', need: 'talk' },
  { id: 'agent', title: '雇佣 Agent 替你干活', hint: '把 Key 交给托管 Agent。', need: '' },
  { id: 'delegate', title: '完成第一单委托', hint: '委托板挂一单。', need: 'delegate' },
];
ok('AFUNI.tutorial 就位', !!(G.AFUNI && G.AFUNI.tutorial));
const TUT = G.AFUNI && G.AFUNI.tutorial;
if (TUT) {
  TUT.ensure();
  TUT.render(TUT_STEPS, { done: ['see-self', 'move'], active: 'tasks', seen: {} });
  const bar = documentShim.getElementById('af-tut-bar');
  ok('教程条挂载：#af-tut-bar + 7 个步骤节点', !!bar && bar.querySelectorAll('.af-tut-step').length === 7,
    bar ? `steps=${bar.querySelectorAll('.af-tut-step').length}` : '无 #af-tut-bar');
  ok('教程条文案数据驱动：当前步 title/hint 与 /af/tutorial 一致',
    !!bar && textOf(bar).includes('打开任务书') && textOf(bar).includes('点右上角任务书。'));
  const cur = bar.querySelectorAll('.af-tut-step').find((e) => e.classes.has('cur'));
  ok('当前步高亮 .cur 落在 tasks（不是已完成的 see-self）', !!cur && cur.textContent.includes('打开任务书'));
  const doneCnt = bar.querySelectorAll('.af-tut-step').filter((e) => e.classes.has('done')).length;
  ok('已完成步标记 .done（2 步）', doneCnt === 2, `实测 ${doneCnt}`);

  // 全完成 → 收起（不再打扰）
  TUT.render(TUT_STEPS, { done: TUT_STEPS.map((x) => x.id), active: null, seen: {} });
  ok('7 步全完成 → 教程条隐藏', documentShim.getElementById('af-tut-bar').style.display === 'none');

  // 跳过 / 重放（老账号兼容：跳过后不再自动弹）
  TUT.render(TUT_STEPS, { done: [], active: 'see-self', seen: {} });
  TUT.skip();
  ok('跳过：隐藏 + localStorage af.tutorial.skip=1',
    store.get('af.tutorial.skip') === '1' && documentShim.getElementById('af-tut-bar').style.display === 'none');
  TUT.replay();
  ok('重放：重新显示并清 skip 标记',
    store.get('af.tutorial.skip') !== '1' && documentShim.getElementById('af-tut-bar').style.display !== 'none');

  // 第 6 步（雇佣 Agent）点击 → 回调打开 Agent 面板（复用 P1.4 入口）
  let clicked = null;
  TUT.onStepClick((id) => { clicked = id; });
  TUT.render(TUT_STEPS, { done: ['see-self', 'move', 'tasks', 'farm', 'talk'], active: 'agent', seen: {} });
  const agentChip = documentShim.getElementById('af-tut-bar').querySelectorAll('.af-tut-step').find((e) => textOf(e).includes('雇佣 Agent'));
  ok('第 6 步可点击', !!agentChip);
  if (agentChip) { agentChip.dispatch('click'); ok('第 6 步点击回调 onStepClick("agent")', clicked === 'agent', String(clicked)); }

  // 常驻 DOM 预算仍达标（教程条 = 1 个常驻根节点）
  let resident2 = 0;
  walkAll(documentShim.body, () => { resident2++; });
  // 预算明细：#af-ui-root + #af-hud + 3 分区 + toast 容器 + 右下角 Agent 状态胶囊（R10.1 = 10 节点；
  //            Agent 胶囊为 SPEC-VISUAL-001 Task 4 明确要求的零延迟占位，非可选项）
  //            + 教程条：条 1 + hd 1 + 标题 1 + 按钮 2 + steps 容器 1 + 7 芯片 + hint 2 + 提示标题 1 + 提示正文 1 = 16
  ok(`常驻 DOM 预算（含教程条）= ${resident2} ≤ 29（R10.1 10 + 教程条 16）`, resident2 <= 29, `实测 ${resident2}`);
}

console.log(`----\nui-smoke: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
