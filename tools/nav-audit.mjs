// nav-audit.mjs —— 导航障碍数据全量审计（批1a Task3；规划书 §1.0）
// 权威源 = 已提交 data/village-collision.json + 各场景 nav-*.json（Ruling：build-collision 为历史烘焙不含 P3 覆盖件，新鲜度以“声明覆盖 ⊆ 权威 + 卫星重算 diff=0”为口径）。
// 用法：node tools/nav-audit.mjs [--check] [--write] [--json <path>] [--selftest]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVillageLayers } from './village-layers.mjs';
import { loadSceneWalls } from './scene-walls.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const { rectMisses, unattributedCells, portalsBidirectional, isolatedCell, buildingRectViolations } = await import('../server/src/navigation/audit.ts');
import { buildNavGrid } from '../server/src/navigation/navgen.ts';
import { applyRoads } from '../server/src/navigation/roads.ts';

const J = (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));
const cellIn = (x, y, r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

// ---------- 村 scene2 ----------
const col = J('village-collision.json');
const W = col.width, H = col.height;
const L = loadVillageLayers(ROOT);
if (L.W !== W || L.H !== H) console.warn(`[warn] village-layers 尺寸 ${L.W}x${L.H} != 权威 ${W}x${H}`);
const masks = [];
const mk = (name, fn) => { const m = new Array(W * H).fill(0); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fn(x, y)) m[y * W + x] = 1; masks.push({ name, mask: m }); };
mk('fanzi(原村房屋)', (x, y) => L.inOrig(x, y) && L.getT('fanzi', x, y));
mk('shuich(水面)', (x, y) => L.getT('shuich', x, y));
mk('mulan(树篱栅栏·非路)', (x, y) => !L.onRoad(x, y) && (L.getT('mulan', x, y) || L.getT('mulan2', x, y)));
const spawns = J('spawn-points.json');
mk('house-core(宅基地内芯)', (x, y) => (spawns.houses || []).some(h => cellIn(x, y, { x: h.rect.x + 1, y: h.rect.y + 1, w: h.rect.w - 2, h: h.rect.h - 2 })));
mk('boundary(地图边界环)', (x, y) => x === 0 || y === 0 || x === W - 1 || y === H - 1);
const buildings = J('buildings.json').buildings.filter(b => b.scene === 2 && b.rect && !b.pending);
mk('buildings(B覆盖件实体)', (x, y) => buildings.some(b => cellIn(x, y, b.rect)));
const attrib = unattributedCells(W, H, col.blocked, masks);

const rectChecks = [];
for (const b of buildings) {
  const doorCell = b.door ? [Math.floor(b.door.x / 100), Math.floor(b.door.y / 100)] : null;
  const v = buildingRectViolations(W, H, col.blocked, { name: `建筑:${b.name || b.id}`, x: b.rect.x, y: b.rect.y, w: b.rect.w, h: b.rect.h }, { kind: b.kind, door: doorCell });
  rectChecks.push({ name: `建筑:${b.name || b.id}`, miss: v.length, violations: v });
}
for (const h of (spawns.houses || [])) { const ms = rectMisses(W, H, col.blocked, { name: 'h' + h.id, x: h.rect.x + 1, y: h.rect.y + 1, w: h.rect.w - 2, h: h.rect.h - 2 }); rectChecks.push({ name: `宅${h.id}内芯`, miss: ms.length, sample: ms.slice(0, 8) }); }

// ---------- 各场景 nav ----------
const registry = J('nav/scenes.json');
const portalsDoc = J('nav/portals.json');
const portals = [];
for (const k of Object.keys(portalsDoc)) if (k !== 'note') for (const p of portalsDoc[k]) portals.push({ scene: +k, toScene: p.toScene ?? p.scene, x: p.x, y: p.y, passage: p.passage });
const navCache = new Map();
function navOfScene(scene) {
  if (navCache.has('s' + scene)) return navCache.get('s' + scene);
  let nav = null;
  try {
    if (scene === 2) nav = buildNavGrid(2, col.blocked, W, H); // 权威=现算（文件新鲜度另检），孤岛判定不受陈旧文件污染
    else {
      const ent = registry.scenes.find(s => s.scene === scene);
      const f = join(DATA, 'nav/nav-' + (scene === 1 ? 'zhujuejia-slots' : ent?.name) + '.json');
      nav = JSON.parse(readFileSync(f, 'utf8'));
    }
  } catch { /* missing */ }
  navCache.set('s' + scene, nav);
  return nav;
}
const portalViol = portalsBidirectional(portals, navOfScene, 8);

// 卫星 nav 新鲜度：与 scene-walls 重算 blocked 一致性（同源口径；blocked-only，kind/cost/roads 不比）
// 说明（Ruling）：build-scene-collisions 烘焙时按场景 TMX 尺寸对齐 + 语义层回退/水域豁免，
// blocked-only 与重算存在设计内差异（水格 blocked=1 但提取源 blocked=0 属同源规则），故按“漂移格比例”阈值告警；
// 阈值 0.5%（189x173 全图约 160 格）之上的漂移视为回归。
const satDrift = [];
for (const ent of registry.scenes) {
  if (ent.scene === 1 || ent.scene === 2) continue;
  const walls = loadSceneWalls(ROOT, ent.name);
  const nav = navOfScene(ent.scene);
  if (!walls || !nav || nav.width !== walls.w || nav.height !== walls.h) continue;
  let diff = 0;
  for (let i = 0; i < walls.blocked.length; i++) if (!nav.blocked[i] && walls.blocked[i]) diff++;
  if (diff / walls.blocked.length > 0.005) satDrift.push({ scene: ent.scene, name: ent.name, drift: diff, ratio: +(diff / walls.blocked.length).toFixed(4) });
}

// ---------- 锚点孤岛（门/矿点/出生点）----------
const mines = J('mine-spots.json');
const anchors = [];
for (const h of (spawns.houses || [])) anchors.push({ name: `宅门${h.id}`, scene: spawns.scene ?? 2, gx: Math.floor(h.door.x / 100), gy: Math.floor(h.door.y / 100) });
for (const m of mines) anchors.push({ name: `矿点${m.gx},${m.gy}`, scene: 2, gx: m.gx ?? Math.floor(m.x / 100), gy: m.gy ?? Math.floor(m.y / 100) });
const isolatedAnchors = [];
for (const a of anchors) {
  const nav = navOfScene(a.scene); if (!nav) continue;
  if (isolatedCell(nav, a.gx, a.gy)) isolatedAnchors.push({ name: a.name, at: [a.gx, a.gy] });
}

let villageNavFresh = false;
try {
  const f = JSON.parse(readFileSync(join(DATA, 'nav/nav-2.json'), 'utf8'));
  villageNavFresh = f.width === W && f.height === H && f.blocked.filter(Boolean).length === col.blocked.filter(Boolean).length;
} catch { villageNavFresh = false; }

// ---------- report ----------
const report = {
  village: { dims: W + 'x' + H, blocked: col.blocked.filter(Boolean).length, attribution: attrib.perSource, unattributed: attrib.unattributed.slice(0, 200), unattributedCount: attrib.unattributed.length, navFresh: villageNavFresh, rects: rectChecks },
  satellites: { driftAboveThreshold: satDrift },
  portals: { total: portals.length, violations: portalViol },
  anchors: { checked: anchors.length, isolated: isolatedAnchors },
};
mkdirSync('/tmp/af-nav-audit', { recursive: true });
writeFileSync(join('/tmp/af-nav-audit/report.json'), JSON.stringify(report, null, 1));

const violations = [];
if (report.village.unattributedCount > 0) violations.push(`村未归因阻挡格 ${report.village.unattributedCount}`);
for (const r of report.village.rects) {
  if (r.miss <= 0) continue;
  if (r.violations) for (const line of r.violations) violations.push(`建筑登记: ${line}`);
  else violations.push(`登记漏格: ${r.name} miss=${r.miss} 如(${(r.sample[0] || []).join(',')})`);
}
if (!report.village.navFresh) violations.push('村 nav-2.json 与权威 collision 尺寸不同步（陈旧）');
for (const s of report.satellites.driftAboveThreshold) violations.push(`卫星场景 ${s.scene}(${s.name}) nav blocked 漂移 ${s.drift}格/${s.ratio}`);
for (const v of report.portals.violations) violations.push(v);
for (const a of report.anchors.isolated) violations.push(`锚点孤岛: ${a.name} @(${a.at.join(',')})`);

if (process.argv.includes('--write')) {
  const farm = J('village-farm.json');
  const water = farm && farm.waterW === W && farm.waterH === H ? farm.water : undefined;
  const roadsDoc = J('roads.json');
  const nv = buildNavGrid(2, col.blocked, W, H, water);
  const rr = applyRoads(nv, (roadsDoc['2'] || { roads: [] }).roads);
  writeFileSync(join(DATA, 'nav/nav-2.json'), JSON.stringify(nv));
  console.log(`已重生成 nav/nav-2.json ${W}x${H}（路格 ${rr.roadCells}${rr.errors.length ? ' ERR ' + rr.errors.join(';') : ''}）`);
}

function summary() {
  console.log(`[nav-audit] 村 ${W}x${H} 阻挡${report.village.blocked} 未归因=${report.village.unattributedCount} rect漏登=${report.village.rects.reduce((n, r) => n + r.miss, 0)}`);
  console.log(`  归因: ${Object.entries(report.village.attribution).map(([k, v]) => k + '=' + v).join(' ')}`);
  console.log(`[nav-audit] 门户 ${report.portals.total} 违规 ${report.portals.violations.length} | 锚点 ${report.anchors.checked}/${report.anchors.isolated.length === 0 ? report.anchors.checked : '孤岛' + report.anchors.isolated.length} | 卫星漂移>0.5%: ${report.satellites.driftAboveThreshold.length} | 村nav fresh=${report.village.navFresh}`);
  for (const v of violations) console.log('  ! ' + v);
}
summary();
if (process.argv.includes('--selftest')) {
  const bx = new Array(9).fill(1); bx[4] = 0;
  const mm = rectMisses(3, 3, bx, { name: 't', x: 0, y: 0, w: 3, h: 3 });
  if (mm.length !== 1) { console.error('selftest FAIL: rectMisses=' + mm.length); process.exit(1); }
  if (isolatedCell({ width: 3, height: 3, blocked: bx, cost: bx.map(v => v ? -1 : 1) }, 1, 1)) { console.error('selftest FAIL: isolatedCell'); process.exit(1); }
  console.log('selftest PASS');
}
if (process.argv.includes('--check') && violations.length) { console.error(`[nav-audit] --check FAIL：违规 ${violations.length} 项`); process.exit(1); }
console.log(`报告：/tmp/af-nav-audit/report.json（违规 ${violations.length}）`);
