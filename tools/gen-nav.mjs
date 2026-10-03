#!/usr/bin/env node
// tools/gen-nav.mjs —— B5 导航数据生产 CLI（design M3.1）
// 用法：
//   node tools/gen-nav.mjs            生成 data/nav/*.json（含村景 nav-2 + 门户图 + 校验）
//   node tools/gen-nav.mjs --check     仅校验（CI 门；anchor 不可达则 exit 1）
//   node tools/gen-nav.mjs --render    生成 data/nav/render/*.png（D7：kind 着色 + 锚点/门户标记，供人工核对河流/建筑/树丛）
// 数据源：data/village-collision.json（村景 blocked）+ data/village-farm.json（水层 D2）+ data/spawn-points.json（房屋门）+ data/mine-spots.json（矿点）
// 27 场景注册骨架：data/nav/scenes.json（village=ready；home/hospital-house=pending-source，sceneType 待客户端枚举确认）
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = `${__dirname}/..`;
const NAV_DIR = `${ROOT}/data/nav`;
const CHECK = process.argv.includes('--check');
const RENDER = process.argv.includes('--render');

const navgen = await import(`${ROOT}/server/src/navigation/navgen.ts`);
const roadsMod = await import(`${ROOT}/server/src/navigation/roads.ts`);
const { encodePng } = await import(`${ROOT}/tools/render-png.mjs`);

function loadJson(p, fb) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJson(p, v) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2)); }

// ---------- 场景注册（27 场景骨架；已知源数据齐备者 ready，其余 pending-source） ----------
const SCENES = loadJson(`${NAV_DIR}/scenes.json`, null) || {
  scenes: [
    { scene: 2, name: 'village(村庄)', status: 'ready', source: 'village-collision.json' },
    { scene: null, name: 'home-map(家门口)', status: 'pending-source' },
    { scene: null, name: 'hospital-house(诊所)', status: 'pending-source' },
  ],
  note: '27 场景全量待客户端 SceneType 枚举与各场景碰撞源数据（加密资源）提取后逐场景填齐；village 为当前权威场景。',
};

// ---------- 村景（scene 2）导航生成 ----------
async function genVillage() {
  const col = loadJson(`${ROOT}/data/village-collision.json`, null);
  if (!col) throw new Error('village-collision.json 缺失');
  // D2：接入 village-farm.json 水层（尺寸匹配时；阻挡水保留 kind=2 不可走语义，free 水 cost 2）
  const farm = loadJson(`${ROOT}/data/village-farm.json`, null);
  const water = farm && farm.waterW === col.width && farm.waterH === col.height ? farm.water : undefined;
  const nav = navgen.buildNavGrid(2, col.blocked, col.width, col.height, water);
  // 市政路网（roads-landmarks v2）：kind=4 路格 + clearance 特判 + roadOf 反查索引
  const roadsDoc = loadJson(`${ROOT}/data/roads.json`, {});
  const villageRoads = (roadsDoc['2'] || { roads: [] }).roads;
  if (villageRoads.length) {
    const res = roadsMod.applyRoads(nav, villageRoads);
    console.log(`[gen-nav] village roads: ${res.roadCells} 路格（桥 ${res.bridgeCells}）${res.errors.length ? ' ERRORS: ' + res.errors.join('; ') : ''}`);
  }

  // anchors：房屋门（spawn-points）+ 矿点（mine-spots）—— 像素坐标
  const spawns = loadJson(`${ROOT}/data/spawn-points.json`, { houses: [] });
  const mines = loadJson(`${ROOT}/data/mine-spots.json`, []);
  const anchors = [];
  for (const h of spawns.houses || []) if (h.door) anchors.push({ name: `house-${h.id}`, x: h.door.x, y: h.door.y });
  for (const m of Array.isArray(mines) ? mines : mines.spots || []) {
    if (typeof m === 'number') continue;
    if (m.x !== undefined && m.y !== undefined) anchors.push({ name: `mine-${m.id ?? m.x}-${m.y}`, x: m.x, y: m.y });
  }
  const rep = navgen.validateAnchors(nav, anchors);

  if (!CHECK) {
    writeJson(`${NAV_DIR}/nav-2.json`, nav);
    // 全量门户图 data/nav/portals.json 由 build-scene-portals 权威生成（1..14/101..113），gen-nav 不再覆盖
    SCENES.scenes[0].status = rep.ok ? 'ready' : 'ready-with-warnings';
    SCENES.scenes[0].anchors = anchors.length;
    SCENES.scenes[0].unreachable = rep.unreachable;
    writeJson(`${NAV_DIR}/scenes.json`, SCENES);
  }
  console.log(`[gen-nav] village: ${nav.width}x${nav.height} anchors=${anchors.length} unreachable=${rep.unreachable.length ? rep.unreachable.join(',') : '无'}`);
  return rep;
}

const rep = await genVillage();
if (CHECK) {
  if (!rep.ok) { console.error(`[gen-nav --check] 校验失败：${rep.unreachable.join(', ')} 不可达`); process.exit(1); }
  // D6 门：全量门户图（data/nav/portals.json）逐条落格吸附校验（各场景 nav 网格）
  const sceneMap = loadJson(`${NAV_DIR}/scenes.json`, { scenes: [] });
  const portalDoc = loadJson(`${NAV_DIR}/portals.json`, {});
  const navFileOf = (sc) => {
    // 场景 1 优先用槽位化导航（B4：8 槽 29x240）—— 必须与运行时 navOf(app, 1) 同源，
    // 否则门户校验会拿旧的 29x29 单槽来吸附，槽 2~8 的门全判「吸附失败」
    if (Number(sc) === 1 && existsSync(`${NAV_DIR}/nav-zhujuejia-slots.json`)) return `${NAV_DIR}/nav-zhujuejia-slots.json`;
    if (Number(sc) === 2) return `${NAV_DIR}/nav-2.json`;
    const e = sceneMap.scenes.find(s => String(s.scene) === String(sc));
    return e ? `${NAV_DIR}/nav-${e.name}.json` : null;
  };
  let pBad = 0, pTotal = 0;
  for (const [sc, list] of Object.entries(portalDoc)) {
    if (sc === 'note' || !Array.isArray(list)) continue;
    const f = navFileOf(sc);
    const nav = f ? loadJson(f, null) : null;
    if (!nav) { pBad += list.length; console.error(`[gen-nav --check] 场景${sc} 无 nav 数据（${f || '?'}），门户 ${list.length} 条无法校验`); continue; }
    for (const p of list) {
      pTotal++;
      if (!navgen.snapToWalkable(nav, p.x, p.y, 8)) { pBad++; console.error(`[gen-nav --check] 门户 ${sc}->${p.toScene} (${p.x},${p.y}) [${p.passage || 'poi'}] 吸附失败`); }
    }
  }
  if (pBad) { console.error(`[gen-nav --check] 门户校验失败 ${pBad}/${pTotal}`); process.exit(1); }
  console.log(`[gen-nav --check] OK（含门户 ${pTotal} 条吸附校验）`);
}

// ---------- D7 可视化：kind 着色 PNG（0 空地=绿 / 1 阻挡=暗红 / 2 水=蓝 / 3 树丛=棕；锚点=白点 矿点=黄点 门户=橙点） ----------
if (RENDER && !CHECK) {
  const SCALE = 4;
  const KIND_COLORS = [ [46, 92, 46], [110, 40, 40], [52, 96, 180], [120, 84, 40], [46, 92, 46] ];
  const outDir = `${NAV_DIR}/render`;
  mkdirSync(outDir, { recursive: true });
  const dot = (buf, wline, rw, rh, px, py, color) => {
    const gx = Math.floor(px / 100) * SCALE, gy = Math.floor(py / 100) * SCALE;
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
      const x = gx + dx, y = gy + dy;
      if (x >= rw || y >= rh) continue;
      const o = y * wline + x * 3;
      buf[o] = color[0]; buf[o + 1] = color[1]; buf[o + 2] = color[2];
    }
  };
  const names = [ 'nav-2.json' ];
  for (const n of readdirSync(NAV_DIR)) if (/^nav-.*\.json$/.test(n) && n !== 'nav-2.json') names.push(n);
  for (const name of names) {
    if (!existsSync(`${NAV_DIR}/${name}`)) continue;
    const nav = JSON.parse(readFileSync(`${NAV_DIR}/${name}`, 'utf8'));
    const rw = nav.width * SCALE, rh = nav.height * SCALE;
    const wline = rw * 3;
    const buf = Buffer.alloc(wline * rh);
    for (let y = 0; y < nav.height; y++) for (let x = 0; x < nav.width; x++) {
      const k = nav.kind[y * nav.width + x] ?? 0;
      const c = KIND_COLORS[k] || KIND_COLORS[0];
      for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
        const o = (y * SCALE + sy) * wline + (x * SCALE + sx) * 3;
        buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
      }
    }
    if (name === 'nav-2.json') {
      for (const h of (loadJson(`${ROOT}/data/spawn-points.json`, { houses: [] }).houses || [])) if (h.door) dot(buf, wline, rw, rh, h.door.x, h.door.y, [255, 255, 255]);
      const mines = loadJson(`${ROOT}/data/mine-spots.json`, []);
      for (const m of Array.isArray(mines) ? mines : mines.spots || []) {
        if (typeof m === 'number' || m.x === undefined) continue;
        dot(buf, wline, rw, rh, m.x, m.y, [255, 255, 0]);
      }
      const portals = loadJson(`${NAV_DIR}/portals.json`, { village: [] });
      for (const p of portals.village || []) dot(buf, wline, rw, rh, p.x, p.y, [255, 180, 0]);
    }
    const out = `${outDir}/${basename(name, '.json')}.png`;
    writeFileSync(out, encodePng(buf, rw, rh));
    console.log(`[gen-nav --render] ${out}（${rw}x${rh}px；图例 绿=空地 暗红=阻挡 蓝=水 棕=树丛 白=房屋门 黄=矿点 橙=门户）`);
  }
}
