#!/usr/bin/env node
// tools/build-scene-collisions.mjs —— B5 全场景碰撞生产（design M3.1）
// 源：server/public/client/maps/*.json（已解密的 Tiled JSON，每场景含隐藏 collide 层）
// 输出：data/nav/nav-<slug>.json（blocked/kind/cost/clearance）+ 更新 scenes.json 注册
// 用法：node tools/build-scene-collisions.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MAPS = join(ROOT, 'server', 'public', 'client', 'maps');
const NAV_DIR = join(ROOT, 'data', 'nav');

const { buildNavGrid, validateAnchors } = await import(join(ROOT, 'server', 'src', 'navigation', 'navgen.ts'));

function loadScene(name) {
  const p = join(MAPS, `${name}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function sceneGrids(scene, w, h) {
  const layers = Array.isArray(scene.layers) ? scene.layers : [];
  const getLayer = (n) => layers.find(l => l.name === n);
  const n = w * h;
  // collide 层（隐藏碰撞层）；缺省回退：任一不可见且含非零数据的 tilelayer
  let collide = getLayer('collide');
  if (!collide) collide = layers.find(l => l.type === 'tilelayer' && l.visible === false && l.data && l.data.some(v => v));
  const blocked = new Array(n).fill(0);
  if (collide?.data) for (let i = 0; i < n; i++) if (collide.data[i]) blocked[i] = 1;
  // 退化防护（D6）：collide 层全满（100% 非零，如 migon 迷宫）视为渲染遮罩而非碰撞 -> 空网格
  const ones = blocked.filter(v => v === 1).length;
  if (ones === n) {
    for (let i = 0; i < n; i++) blocked[i] = 0;
    console.log(`[build-scene-collisions] collide 层全满（${n} 格），判定为遮罩 -> 开放网格`);
  }
  // never 层（绝对不可走，如危险区）并入 blocked
  const never = layers.find(l => /never/i.test(l.name || '') && l.data);
  if (never) for (let i = 0; i < n; i++) if (never.data[i]) blocked[i] = 1;
  // 水层：名字含 "shui"（shuic/shuijingssss/shuitian...）
  const water = new Array(n).fill(0);
  for (const l of layers) {
    if (l.type !== 'tilelayer' || !l.data) continue;
    if (!/shui/.test(l.name || '')) continue;
    for (let i = 0; i < n; i++) if (l.data[i]) water[i] = 1;
  }
  return { blocked, water };
}

function check() {
  const meta = JSON.parse(readFileSync(join(MAPS, 'map-meta.json'), 'utf8'));
  const names = Object.keys(meta);
  let ok = true;
  for (const slug of names) {
    const p = join(NAV_DIR, `nav-${slug}.json`);
    if (!existsSync(p)) { console.log(`[check] MISSING nav-${slug}.json`); ok = false; continue; }
    const nav = JSON.parse(readFileSync(p, 'utf8'));
    if (!Array.isArray(nav.blocked) || nav.blocked.length !== nav.width * nav.height) {
      console.log(`[check] ${slug} 网格不一致`); ok = false;
    }
    if (!Array.isArray(nav.clearance)) { console.log(`[check] ${slug} 缺 clearance`); ok = false; }
  }
  console.log(`[check] ${names.length} 场景 nav 文件${ok ? ' 校验通过' : ' 存在问题'}`);
  if (!ok) process.exit(1);
}

function main() {
  if (process.argv.includes('--check')) return check();
  const meta = JSON.parse(readFileSync(join(MAPS, 'map-meta.json'), 'utf8'));
  const names = Object.keys(meta).filter(n => loadScene(n));
  // 兼容：meta 外的场景 json（如 shugenjia）也纳入
  for (const f of readdirSafe(MAPS)) {
    if (!f.endsWith('.json') || f === 'map-meta.json') continue;
    const slug = f.replace(/\.json$/, '');
    if (!names.includes(slug) && loadScene(slug)) names.push(slug);
  }

  mkdirSync(NAV_DIR, { recursive: true });
  const registry = existsSync(join(NAV_DIR, 'scenes.json'))
    ? JSON.parse(readFileSync(join(NAV_DIR, 'scenes.json'), 'utf8'))
    : { scenes: [] };
  const summary = [];
  for (const slug of names) {
    const scene = loadScene(slug);
    const metaDims = meta[slug] || {};
    const w = Number(metaDims.width || scene.width);
    const h = Number(metaDims.height || scene.height);
    if (!w || !h) { console.log(`[build-scene] ${slug}: 缺维度，跳过`); continue; }
    const { blocked, water } = sceneGrids(scene, w, h);
    const nav = buildNavGrid(slug, blocked, w, h, water);
    const navPath = join(NAV_DIR, `nav-${slug}.json`);
    writeFileSync(navPath, JSON.stringify({ ...nav, scene: slug }));
    // 锚点校验：场景中心必须可走（吸附 8 格内）
    const center = { x: Math.floor(w / 2) * 100 + 50, y: Math.floor(h / 2) * 100 + 50 };
    const rep = validateAnchors(nav, [{ name: 'center', ...center }]);
    const blockedRatio = blocked.filter(x => x).length / (w * h);
    let status;
    if (blocked.filter(x => x).length === 0) status = 'ready-empty-collide'; // collide 层空：无阻挡数据，需人工核验
    else if (blockedRatio > 0.95) status = 'ready-with-warnings'; // 几乎全阻（矿洞类：需指定入口锚点）
    else status = rep.ok ? 'ready' : 'ready-with-warnings';
    summary.push({ slug, w, h, blocked: blocked.filter(x => x).length, water: water.filter(x => x).length, centerOk: rep.ok, status });
    // 注册
    const reg = registry.scenes.find(s => s.name === slug || s.scene === slug);
    if (reg) Object.assign(reg, { status, source: `maps/${slug}.json(collide 层)`, w, h });
    else registry.scenes.push({ scene: slug, name: slug, status, source: `maps/${slug}.json(collide 层)`, w, h });
  }
  registry.note = '27 场景注册：' + registry.scenes.length + ' 场景由 maps/*.json collide 层生成（sceneType 数字待客户端枚举确认）；跨场景 passage 门位待客户端 PassageCollider 源数据。';
  writeFileSync(join(NAV_DIR, 'scenes.json'), JSON.stringify(registry, null, 2));
    for (const s of summary) console.log(`[build-scene] ${s.slug}: ${s.w}x${s.h} blocked=${s.blocked} water=${s.water} ${s.status}`);
  console.log(`[build-scene] 完成 ${summary.length} 场景；empty-collide=${summary.filter(s=>s.status==='ready-empty-collide').length}（需人工核验）`);
}

function readdirSafe(d) { try { return readdirSync(d); } catch { return []; } }

main();
