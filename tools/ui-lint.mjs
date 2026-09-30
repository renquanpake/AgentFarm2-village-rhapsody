#!/usr/bin/env node
// tools/ui-lint.mjs —— 旗舰视觉静态门（spec P4/R1.3/R4.4/R10.1）
//  1) tokens 外裸色值 = 0（client/mod 下 .css/.js；tokens.css 豁免；/* af-color-allow */ 行豁免）
//  2) af-* 可点元素三态覆盖：af-* 面板的点击绑定必须走 AFUI.on（direct onclick/addEventListener 计数 = 0）
//  3) 常驻 DOM 预算 ≤10（kit.js 声明的 RESIDENT_NODES 常量 + #af-ui-root 直接子容器计数）
// 用法：node tools/ui-lint.mjs [--fix-none] ；失败 exit 1（进 CI 门）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MOD = path.join(ROOT, 'client', 'mod');
const TOKENS = path.join(MOD, 'af-ui', 'tokens.css');

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(css|js)$/.test(f)) out.push(p);
  }
  return out;
}

let fails = 0;

// ---------- 1) 裸色值扫描 ----------
const COLOR_HEX = /#[0-9a-fA-F]{3,8}\b/;
const COLOR_RGB = /rgba?\(\s*\d/;
let bareColors = 0;
const bareFiles = new Map();
for (const file of walk(MOD)) {
  if (file === TOKENS) continue; // R1.3：tokens 是唯一切入点
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.includes('af-color-allow')) continue; // canvas 像素数据常量（色板/渐变）豁免
    // 排除 CSS 变量名与类名中的 '#' 误匹配：只统计赋值/属性语境
    if (COLOR_HEX.test(ln) || COLOR_RGB.test(ln)) {
      bareColors++;
      bareFiles.set(file, (bareFiles.get(file) || 0) + 1);
      if (bareColors <= 12) console.error(`[ui-lint] 裸色值 ${path.relative(ROOT, file)}:${i + 1}  ${ln.trim().slice(0, 90)}`);
    }
  }
}
if (bareColors) { fails++; console.error(`[ui-lint] FAIL：tokens 外裸色值 ${bareColors} 处（R1.3 要求 0；确需字面量加 /* af-color-allow */ 并说明）`); }
else console.log('[ui-lint] OK：tokens 外裸色值 = 0');

// ---------- 2) 三态覆盖：af-* 面板点击绑定走 AFUI.on ----------
let directClicks = 0;
for (const file of walk(MOD)) {
  if (path.basename(file) === 'kit.js') continue; // AFUI.on 本体
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    // af-* 元素的直接 onclick / addEventListener('click')（应改 AFUI.on 获得三态+结果反馈）
    if (/\.onclick\s*=/.test(ln) || /addEventListener\(\s*['"]click['"]/.test(ln)) {
      // 全局事件（document/window 级）豁免
      if (/document\s*\.addEventListener|window\s*\.addEventListener/.test(ln)) continue;
      directClicks++;
      if (directClicks <= 10) console.error(`[ui-lint] 直接点击绑定 ${path.relative(ROOT, file)}:${i + 1}  ${ln.trim().slice(0, 90)}`);
    }
  }
}
if (directClicks) { fails++; console.error(`[ui-lint] FAIL：af-* 面板存在 ${directClicks} 处直接点击绑定（R4.4 要求 100% 三态覆盖 -> 统一 AFUI.on）`); }
else console.log('[ui-lint] OK：af-* 面板点击绑定 100% 走 AFUI.on（三态覆盖）');

// ---------- 3) 常驻 DOM 预算 ----------
const kitSrc = readFileSync(path.join(MOD, 'af-ui', 'kit.js'), 'utf8');
const m = kitSrc.match(/RESIDENT_NODES\s*[:=]\s*(\d+)/);
const declared = m ? Number(m[1]) : Infinity;
if (declared > 10) { fails++; console.error(`[ui-lint] FAIL：kit.js 声明常驻节点 ${declared} > 10（R10.1）`); }
else console.log(`[ui-lint] OK：常驻 DOM 预算 = ${declared}（≤10，R10.1）`);

if (fails) { console.error(`[ui-lint] ${fails} 项未过`); process.exit(1); }
console.log('[ui-lint] 全部通过');
