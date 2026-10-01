#!/usr/bin/env node
// tools/art-gen.mjs —— C8 批量生图管线（用户自备 USER_IMG_* 凭据，.env 提供，不入库）
// 流程：manifest pending 队列 -> POST {base}/images/generations -> 下载 raw ->
//       art-postprocess.py（--w/--h 精确缩放 + 16 色量化 + 抠图 + 网格校验）->
//       assets/generated/{id}-{name}.png；逐件回写 manifest（可断点续跑）
// 用法：node tools/art-gen.mjs [--limit N] [--concurrency 4] [--model agnes-image-2.5-flash] [--retry 3]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------- .env 加载（仅 USER_IMG_*；已存在的进程环境变量优先） ----------
function loadDotEnv(file) {
  let txt;
  try { txt = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const k = m[1];
    if (!process.env[k]) process.env[k] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv(join(ROOT, '.env'));

const base = (process.env.USER_IMG_BASE_URL || '').replace(/\/+$/, '');
const key = process.env.USER_IMG_API_KEY || '';
if (!base || !key) {
  console.error('[art-gen] 缺 USER_IMG_BASE_URL / USER_IMG_API_KEY（放 .env，模板见 .env.example）');
  process.exit(1);
}
const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : undefined; };
const model = arg('--model') || process.env.USER_IMG_MODEL || 'agnes-image-2.5-flash';
const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;
const concurrency = arg('--concurrency') ? Number(arg('--concurrency')) : 4;
const retries = arg('--retry') ? Number(arg('--retry')) : 3;
const gap = arg('--gap') ? Number(arg('--gap')) : 0; // 每件完成后间隔秒数（免费档限速时用 30-60）
const ids = arg('--ids') ? arg('--ids').split(',').map(Number) : null; // 定向重生成（无视 status）
const useWhiteBg = process.argv.includes('--white-bg');
const useNoWhiteBg = process.argv.includes('--no-white-bg');

// v2 生图策略：绝对纯白底 + 只画指定单体（生图模型做不出透明，只认纯白底最稳；后处理 --white-bg 白->透明）
function buildPrompt(q) {
  const p = q.prompt
    .replace(/transparent background/gi, 'absolute flat solid PURE WHITE background #FFFFFF')
    .replace(/no text, no border/gi, 'the single object is centered and occupies most of the frame, nothing else anywhere in the image');
  const neg = useWhiteBg ? '' : ''; // v2 负面项
  const v2 = useWhiteBg
    ? ` Render EXACTLY ONE isolated pixel-art game asset: ${q.name}. Absolute requirement: solid uniform pure white (#FFFFFF) background filling the entire image edge-to-edge, no gradient, no shadow, no ground, no scene, no other objects. Negative: scene, village, building, road, multiple objects, second object, drop shadow, gradient, beige, gray, colored background, border, frame, text, watermark.`
    : '';
  return p + neg + v2;
}

// 429 限速识别：返回建议等待秒数（Retry-After 优先，缺省 60s）
function isRateLimited(msg) { return /429|rate.?limit/i.test(msg || ''); }

const genDir = join(ROOT, 'assets', 'generated');
const rawDir = join(ROOT, 'data', 'art', 'raw');
mkdirSync(genDir, { recursive: true });
mkdirSync(rawDir, { recursive: true });

// ---------- manifest 读取 ----------
const manifestPath = join(ROOT, 'data', 'art', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const items = ids
  ? manifest.queue.filter(q => ids.includes(q.id))
  : manifest.queue.filter(q => q.status === 'pending').slice(0, limit);
console.log(`[art-gen] model=${model} base=${base} 目标 ${items.length} 件（concurrency=${concurrency}, retry=${retries}${useWhiteBg ? ', v2纯白底' : ''}）`);
if (!items.length) { console.log('[art-gen] 目标为空，退出'); process.exit(0); }

// ---------- 单件生成 ----------
function apiSize(q) { return q.size === '32x48' ? '512x768' : q.size === '288x384' ? '512x768' : q.size === '384x288' ? '512x512' : '512x512'; }

async function generateOne(q) {
  const resp = await fetch(base + '/images/generations', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: buildPrompt(q), n: 1, size: apiSize(q) }),
    signal: AbortSignal.timeout(180000),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + (await resp.text()).slice(0, 200));
  const j = await resp.json();
  const url = j?.data?.[0]?.url;
  if (!url) throw new Error('响应无 url: ' + JSON.stringify(j).slice(0, 200));
  const im = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!im.ok) throw new Error('下载 HTTP ' + im.status);
  const rawPath = join(rawDir, q.id + '.png');
  writeFileSync(rawPath, Buffer.from(await im.arrayBuffer()));

  const [w, h] = q.size.split('x').map(Number);
  const out = join(genDir, `${q.id}-${q.name}.png`);
  const ppArgs = ['tools/art-postprocess.py', rawPath, out, '--w', String(w), '--h', String(h),
    '--palette', 'tools/art-prompts/palette-v1.json'];
  if (useWhiteBg) ppArgs.push('--white-bg');
  const pp = spawnSync('python3', ppArgs, { cwd: ROOT });
  if (pp.status !== 0) throw new Error('后处理失败: ' + pp.stderr.toString().slice(-300));
  const report = JSON.parse(pp.stdout.toString().trim().split('\n').pop() || '{}');
  if (!report.ok) throw new Error('色数超调色板: ' + JSON.stringify(report));
  return { out: 'assets/generated/' + out.split('/').pop(), colors: report.result_colors, task: j.task_id };
}

// ---------- 并发池（失败重试 + 断点续跑） ----------
async function pool(its) {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, its.length) }, async () => {
    while (i < its.length) {
      const q = its[i++];
      for (let a = 1; a <= retries; a++) {
        try {
          const r = await generateOne(q);
          q.status = 'done';
          q.source = { model, task: r.task, colors: r.colors, out: r.out, at: new Date().toISOString() };
          delete q.lastError;
          writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
          console.log(`[art-gen] ✓ ${q.name} (${q.size}) -> ${r.out} [${r.colors}色]`);
          break;
        } catch (e) {
          q.lastError = `${new Date().toISOString()} 第${a}次: ${e.message}`.slice(0, 300);
          if (a === retries) {
            console.warn(`[art-gen] ✗ ${q.name} 重试 ${retries} 次失败，留 pending 待续：${e.message}`);
            writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
          } else {
            // 429 限速：等待更久（免费档配额/速率恢复）；普通错误短退避
            const waitMs = isRateLimited(e.message) ? 30_000 * a : 2000 * a;
            if (isRateLimited(e.message)) console.log(`[art-gen] … ${q.name} 429 限速，等 ${waitMs / 1000}s 再试（第${a}/${retries}次）`);
            await new Promise(r2 => setTimeout(r2, waitMs));
          }
        }
        if (gap > 0) await new Promise(r2 => setTimeout(r2, gap * 1000)); // 免费档限速节奏
      }
    }
  });
  await Promise.all(workers);
}

await pool(items);
const left = manifest.queue.filter(q => q.status === 'pending').length;
const done = manifest.queue.filter(q => q.status === 'done').length;
console.log(`[art-gen] 本轮完成；队列剩余 pending=${left}，done=${done}/${manifest.queue.length}`);
