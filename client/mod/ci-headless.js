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

  // cc 由 main.js 才挂上 window，且引擎可能用 defineProperty 覆盖 window 属性（陷阱不可靠），
  // 故改为轮询补补丁：命中即停，最多 120s。
  var doneRect = false, doneErr = false, tries = 0;
  var timer = setInterval(function () {
    var c = window.cc;
    tries++;
    if (c) {
      if (!doneRect) {
        try {
          if (c.SpriteFrame && c.SpriteFrame.prototype && c.SpriteFrame.prototype._checkRect) {
            c.SpriteFrame.prototype._checkRect = function () {};
            doneRect = true;
          }
        } catch (e) { /* ignore */ }
      }
      if (!doneErr && typeof c.errorID === 'function' && !c.errorID.__afPatched) {
        try {
          var raw = c.errorID;
          var wrapped = function (id) { if (id === 3300 || id === 3400) return; return raw.apply(this, arguments); };
          wrapped.__afPatched = true;
          c.errorID = wrapped;
          doneErr = true;
        } catch (e) {
          try {
            var raw2 = c.errorID;
            Object.defineProperty(c, 'errorID', {
              configurable: true, writable: true,
              value: function (id) { if (id === 3300 || id === 3400) return; return raw2.apply(this, arguments); },
            });
            doneErr = true;
          } catch (e2) { /* ignore */ }
        }
      }
    }
    if ((doneRect && doneErr) || tries > 600) {
      clearInterval(timer);
      console.log('[AF] ci-headless 引擎补丁：_checkRect=' + doneRect + ' errorID=' + doneErr + '（尝试 ' + tries + ' 次）');
    }
  }, 200);

  console.log('[AF] ci-headless 生效：贴图全 stub（__AF_CI__=1）');
})();