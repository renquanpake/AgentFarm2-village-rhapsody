#!/usr/bin/env node
// tools/check-roads.mjs —— 市政路网校验（roads-landmarks 规划书 §6 验收门）
// 三档：
//   1) 连通档（全图）：路端点必接 路口/地标/门户/地图边界，悬空路 = 0
//   2) 相交档（随真实碰撞逐场景）：路穿水(非桥)/穿阻挡 = 0；空碰撞场景(ready-empty-collide)跳过
//   3) 双源一致性档（村景）：老区路格集合 == shilu 提取掩码（diff 0）
// 用法：
//   node tools/check-roads.mjs            全量
//   node tools/check-roads.mjs --village  仅村景
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ONLY_VILLAGE = process.argv.includes('--village');
const { connectivityCheck, crossingCheck, dualSourceDiff } = await import(join(ROOT, 'server', 'src', 'navigation', 'roads.ts'));

const load = (p, fb) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
const { loadSceneWalls, VILLAGE_OLD_RECT } = await import(join(ROOT, 'tools', 'scene-walls.mjs'));
const roadsDoc = load(join(ROOT, 'data', 'roads.json'), {});
const landmarksDoc = load(join(ROOT, 'data', 'landmarks.json'), {});
const portalsDoc = load(join(ROOT, 'data', 'nav', 'portals.json'), {});
const scenesDoc = load(join(ROOT, 'data', 'nav', 'scenes.json'), { scenes: [] });

// 场景 id -> 状态（空碰撞判定）
const statusOf = new Map(scenesDoc.scenes.map(s => [String(s.scene ?? s.name), s.status]));
// 场景 id -> { blocked, water, w, h }（村景走 data/village-*，其余走共享提取 scene-walls.mjs）
function sceneWalls(sceneKey) {
  if (sceneKey === '2') {
    const col = load(join(ROOT, 'data', 'village-collision.json'), null);
    const farm = load(join(ROOT, 'data', 'village-farm.json'), null);
    if (!col) return null;
    const water = farm && farm.waterW === col.width && farm.waterH === col.height ? farm.water : new Array(col.width * col.height).fill(0);
    return { w: col.width, h: col.height, blocked: col.blocked, water };
  }
  const reg = scenesDoc.scenes.find(s => String(s.scene ?? s.name) === String(sceneKey));
  const slug = reg ? reg.name : sceneKey;
  return loadSceneWalls(ROOT, slug);
}

let totalConn = 0, totalCross = 0, totalDual = 0;
for (const [sceneKey, entry] of Object.entries(roadsDoc)) {
  if (sceneKey === 'note' || !entry || !Array.isArray(entry.roads)) continue;
  if (ONLY_VILLAGE && sceneKey !== '2') continue;
  const roads = entry.roads;
  const walls = sceneWalls(sceneKey);
  if (!walls) { console.log(`[check-roads] 场景${sceneKey} 无碰撞源，跳过相交/双源`); continue; }
  const landmarks = (landmarksDoc[sceneKey] || []).map(lm => ({ x: lm.x, y: lm.y }));
  const portals = (portalsDoc[sceneKey] || []);

  // 村景门位（扩展区 7 户门垫端点须接门）
  const extraAnchors = sceneKey === '2'
    ? (load(join(ROOT, 'data', 'spawn-points.json'), { houses: [] }).houses || [])
        .filter(h => h.door).map(h => ({ x: h.door.x / 100, y: h.door.y / 100 }))
    : [];
  // 1) 连通档（全图立即可跑）
  const conn = connectivityCheck(walls.w, walls.h, roads, landmarks, portals.map(p => ({ x: p.x, y: p.y })), 2, extraAnchors);
  totalConn += conn.length;

  // 2) 相交档（真实碰撞场景才启用；空碰撞跳过；村景房叠石板豁免）
  const status = statusOf.get(sceneKey) || '';
  const realCollide = walls.blocked.some(v => v === 1);
  let cross = [];
  if (realCollide && !String(status).includes('empty-collide')) {
    const shiluExempt = sceneKey === '2' ? load(join(ROOT, 'data', 'village-shilu.json'), { shilu: [] }).shilu : undefined;
    cross = crossingCheck(walls.w, walls.h, walls.blocked, walls.water, roads, shiluExempt);
  }

  // 3) 双源一致性档（村景）
  let dual = [];
  if (sceneKey === '2') {
    const shiluFile = join(ROOT, 'data', 'village-shilu.json');
    if (!existsSync(shiluFile)) {
      console.error('[check-roads] village-shilu.json 缺失，先跑 node tools/build-shilu.mjs');
      process.exit(1);
    }
    const shilu = load(shiluFile, { shilu: [] }).shilu;
    dual = dualSourceDiff(walls.w, walls.h, roads, shilu, walls.blocked, VILLAGE_OLD_RECT);
    totalDual += dual.length;
  }

  // 判定：村景三档全判死；卫星场景相交档为 P1c 随碰撞提取启用（P1a 仅告警不判死），连通/双源判死
  const isVillage = sceneKey === '2';
  const crossFatal = isVillage;
  const fatal = (conn.length > 0) || (crossFatal ? cross.length > 0 : false) || dual.length > 0;
  totalCross += cross.length;
  const ok = conn.length === 0 && (crossFatal ? cross.length === 0 : true) && dual.length === 0;
  const crossTag = crossFatal ? `相交 ${cross.length}` : `相交 ${cross.length}(P1c 启用，暂告警)`;
  console.log(`[check-roads] 场景${sceneKey}（${walls.w}x${walls.h}，${roads.length} 路，${realCollide ? '真实碰撞' : '空碰撞'}）：连通悬空 ${conn.length} / ${crossTag} / 双源 diff ${dual.length} ${ok ? '✓' : '✗'}`);
  for (const e of conn) console.log('   悬空: ' + e);
  for (const e of cross) console.log(`   相交${crossFatal ? '' : '(告警)'}: ` + e);
  for (const i of dual.slice(0, 20)) console.log(`   双源: (${i % walls.w},${(i / walls.w) | 0})`);
  if (dual.length > 20) console.log(`   双源: ...共 ${dual.length} 格`);
  if (fatal) process.exitCode = 1;
}
console.log(`[check-roads] 汇总：悬空 ${totalConn} / 相交 ${totalCross}（卫星为 P1c 告警）/ 双源 ${totalDual}${process.exitCode ? '（有违规，exit 1）' : '（全过）'}`);
