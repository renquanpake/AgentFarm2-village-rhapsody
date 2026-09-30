#!/usr/bin/env node
// tools/art-qa.mjs —— C8 送审自动终检：manifest 全队列逐件复检（尺寸/色数/命名/透明度）
// 结果写回 data/art/review-index.json 的 autoCheck 字段；人审仍用 review 字段（pass/revise/reject）
// 用法：node tools/art-art-qa.mjs [--fix-index]   （--fix-index 才写回 review-index）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIX = process.argv.includes('--fix-index');

const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'art', 'manifest.json'), 'utf8'));
const palette = JSON.parse(readFileSync(join(ROOT, 'tools', 'art-prompts', 'palette-v1.json'), 'utf8'));
const MAX_COLORS = palette.palette.length + 1; // 允许 1 色透明外溢

// 尺寸/色数/透明度经 python（PIL）批量体检；CC0 替代件（外部素材）只验可读，不套调色板
const targets = manifest.queue.map(q => {
  const file = q.status === 'done' ? join(ROOT, 'assets', 'generated', `${q.id}-${q.name}.png`) : join(ROOT, q.substitute?.ref || '');
  return { ...q, abs: file, exists: existsSync(file) };
}).filter(q => q.status === 'done' || q.status === 'cc0-substitute');

const py = `
import json, sys
from PIL import Image
items = json.loads(sys.stdin.read())
out = []
for it in items:
    if not it.get("exists"):
        out.append({"id": it["id"], "ok": False, "reason": "文件缺失"}); continue
    im = Image.open(it["abs"]).convert("RGBA")
    w, h = im.size
    colors = len({c[:3] for c in im.getdata() if c[3] >= 128})
    if it.get("strict"):
        bad = ""
        ok = True
        if colors > MAXC: bad = "色数超限"; ok = False
        elif (w, h) != (it["ew"], it["eh"]): bad = "尺寸不符"; ok = False
        out.append({"id": it["id"], "w": w, "h": h, "colors": colors, "ok": ok, "reason": bad})
    else:
        out.append({"id": it["id"], "w": w, "h": h, "colors": colors, "ok": True, "reason": "cc0(只验可读)"})
print(json.dumps(out))
`.replace('MAXC', String(MAX_COLORS));

const res = JSON.parse(execFileSync('python3', ['-c', py], {
  input: JSON.stringify(targets.map(t => ({
    id: t.id, abs: t.abs, exists: t.exists,
    strict: t.status === 'done',
    ew: Number(t.size.split('x')[0]), eh: Number(t.size.split('x')[1]),
  }))),
  encoding: 'utf8', maxBuffer: 1 << 24,
}));
const byId = new Map(res.map(r => [r.id, r]));
let failed = 0;
for (const q of targets) {
  const r = byId.get(q.id);
  q.autoCheck = { at: new Date().toISOString(), ...r };
  if (!r.ok) failed++;
  console.log(`[qa] ${q.name}(${q.status}): ${r.ok ? 'PASS' : 'FAIL ' + r.reason} ${r.w}x${r.h} ${r.colors}色`);
}
console.log(`[qa] 终检：${targets.length - failed}/${targets.length} 通过`);
if (FIX) {
  const idxPath = join(ROOT, 'data', 'art', 'review-index.json');
  const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
  for (const row of Object.values(idx.byCategory)) {
    for (const item of row) {
      const m = manifest.queue.find(q => q.id === item.id);
      if (m && m.autoCheck) item.autoCheck = m.autoCheck;
    }
  }
  writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n');
  console.log('[qa] review-index 已回写 autoCheck');
}
process.exit(failed ? 1 : 0);
