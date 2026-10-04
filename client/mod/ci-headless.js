// mod/ci-headless.js —— CI 无渲染模式（画面可视化活体验收专用，mod 注入层）
// 沙箱 headless（swiftshader 软渲染）解 1300+ 张贴图会打爆内存，约 80s 崩在场景加载；
// 这里在注入层把贴图统一 stub 成 64x64 空白图，并消掉随之而来的 SpriteFrame rect 报错。
// 仅在 ?ci=1 或 localStorage af.ci=1 时生效；正常玩家路径不注册任何补丁，零副作用。
(function () {
  'use strict';

  var on = false;
  try {
    on = /(?:^|[?&])ci=1(?:&|$)/.test(location.search) || localStorage.getItem('af.ci') === '1';
  } catch (e) { on = false; }
  if (!on) return;
  window.__AF_CI__ = true;

  // 64x64 空白图（每张约 16KB，1300 张共约 22MB；1024 见方会照旧爆内存）
  var BLANK = (function () {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    c.getContext('2d').clearRect(0, 0, 64, 64);
    return c.toDataURL('image/png');
  })();

  function isAsset(v) {
    if (typeof v !== 'string' || !v) return false;
    if (v.slice(0, 5) === 'data:') return false;
    return /\.(png|jpe?g|webp)(?:[?#]|$)/i.test(v) || v.indexOf('/assets/') >= 0;
  }

  // Cocos 2.4 web 端贴图走 Image 元素加载，这里包 src setter 即引擎无关拦截
  var IMG = window.HTMLImageElement;
  if (IMG && IMG.prototype) {
    var desc = Object.getOwnPropertyDescriptor(IMG.prototype, 'src');
    if (desc && desc.set && desc.get) {
      Object.defineProperty(IMG.prototype, 'src', {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () { return desc.get.call(this); },
        set: function (v) { desc.set.call(this, isAsset(v) ? BLANK : v); },
      });
    }
  }

  var patched = false;
  function patchCc(cc) {
    if (patched || !cc) return;
    // 空白图必然小于原图 rect，_checkRect 置空以消 3300/3400 报错刷屏
    try {
      if (cc.SpriteFrame && cc.SpriteFrame.prototype && cc.SpriteFrame.prototype._checkRect) {
        cc.SpriteFrame.prototype._checkRect = function () {};
        patched = true;
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof cc.errorID === 'function') {
        var raw = cc.errorID;
        cc.errorID = function (id) {
          if (id === 3300 || id === 3400) return;
          return raw.apply(this, arguments);
        };
      }
    } catch (e) { /* ignore */ }
  }

  var heldCc = window.cc;
  if (heldCc) {
    patchCc(heldCc);
  } else {
    // cc 定义瞬间补上（引擎在 main.js 里才挂 window.cc）
    try {
      Object.defineProperty(window, 'cc', {
        configurable: true,
        get: function () { return heldCc; },
        set: function (v) { heldCc = v; patchCc(v); },
      });
    } catch (e) { /* ignore */ }
  }

  console.log('[AF] ci-headless 生效：贴图全 stub（__AF_CI__=1）');
})();