#!/usr/bin/env node
// tools/hash-manifest.mjs —— 原版外壳哈希校验（CI 门禁 5）
// 原版 Cocos 外壳（引擎/主包/样式/既有 assets）只读；mod 注入层（client/mod）与新增 assets 文件可演进。
// 用法：
//   node tools/hash-manifest.mjs            生成/刷新清单 -> client/original-hash.json
//   node tools/hash-manifest.mjs --check    校验：清单内文件被修改/删除即退出码 1
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MANIFEST = path.join(ROOT, 'client', 'original-hash.json');

// 原版外壳（不可变）范围；mod/ 与 _shots* 明确排除（mod 是注入层，随 M1/M5 演进）
function collectFiles(base) {
  const out = [];
  for (const f of readdirSync(base)) {
    const full = path.join(base, f);
    const rel = path.relative(ROOT, full);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (f === 'mod' || f.startsWith('_shots')) continue; // 排除 mod 注入层与开发截图
      out.push(...collectFiles(full));
    } else {
      // index.html 已为 mod 注入服务（引用 mod/agentfarm.js），属可演进部分，不纳入
      if (rel === path.join('client', 'index.html')) continue;
      // 清单自身不入清单（自包含会致 --check 恒报"清单被改动"）
      if (rel === path.join('client', 'original-hash.json')) continue;
      out.push(rel);
    }
  }
  return out;
}

function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

const files = collectFiles(path.join(ROOT, 'client'));
const check = process.argv.includes('--check');

if (!check) {
  const manifest = { note: '原版外壳哈希基线（client/ 内引擎/主包/样式/既有资源；mod 注入层与新增资源除外）。刷新：node tools/hash-manifest.mjs', updatedAt: new Date().toISOString(), files: {} };
  for (const rel of files) manifest.files[rel] = sha256File(path.join(ROOT, rel));
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  console.log(`已生成清单：${files.length} 个文件 -> ${path.relative(ROOT, MANIFEST)}`);
  process.exit(0);
}

// --check
if (!existsSync(MANIFEST)) { console.error('清单缺失：先运行 node tools/hash-manifest.mjs'); process.exit(1); }
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
let bad = 0;
for (const [rel, hash] of Object.entries(manifest.files)) {
  const full = path.join(ROOT, rel);
  if (!existsSync(full)) { console.error(`MISSING  ${rel}`); bad++; continue; }
  const now = sha256File(full);
  if (now !== hash) { console.error(`MODIFIED ${rel}`); bad++; }
}
if (bad > 0) {
  console.error(`原版外壳哈希校验失败：${bad} 个文件被改动/缺失（如需变更请评审后运行 node tools/hash-manifest.mjs 刷新清单）`);
  process.exit(1);
}
console.log(`原版外壳哈希校验通过（${Object.keys(manifest.files).length} 个文件）`);
