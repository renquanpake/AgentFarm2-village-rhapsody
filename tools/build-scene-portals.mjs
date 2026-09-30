#!/usr/bin/env node
// tools/build-scene-portals.mjs —— D6：从原版主包枚举 + 场景配置提取 27 场景注册与全量跨场景门户图
// 数据源（静态提取，已人工核对）：
//   - Gscene_config（27 场景：sceneType -> notes/path_json_name）
//   - 各场景类 getPlayerBornPosition 覆盖表（每场景自侧门位坐标）
//   - 村景扩展偏移：原版村景 77x61 嵌入扩展村景 133x117（+28 格偏移，mod 入口对齐同值）
// 输出：data/nav/scenes.json（scene 编号填齐）+ data/nav/portals.json（全量门户图）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = `${__dirname}/..`;
const NAV_DIR = `${ROOT}/data/nav`;

// 27 场景注册（Gscene_config 提取：sceneType -> {notes, mapFile}）
// mapFile 由 path_json_name 前缀与 data/nav/nav-*.json 对应（village=daditu）
const SCENE_MAP = {
  1: { notes: '家门口', map: 'zhujuejia' },
  2: { notes: '村', map: 'daditu' },
  3: { notes: '河边', map: 'hebian' },
  4: { notes: '稻田', map: 'jitishuitian' },
  5: { notes: '尼姑庵', map: 'chunshuian' },
  6: { notes: '温泉', map: 'wenquan' },
  7: { notes: '暴龙', map: 'baolongjia' },
  8: { notes: '矿井通道', map: 'feiqikuangdong' },
  9: { notes: '墓园', map: 'kuannanzhemuyuan' },
  10: { notes: '后山通道', map: 'hoshantondao' },
  11: { notes: '吊桥', map: 'diaoqiao' },
  12: { notes: '山顶', map: 'shanding' },
  13: { notes: '密林', map: 'milin' },
  14: { notes: '索道', map: 'suodao' },
  101: { notes: '家(内)', map: 'zjuejnei' },
  102: { notes: '寡妇家', map: 'gfujia' },
  103: { notes: '家石伯家', map: 'jiashiboo' },
  104: { notes: '树根家', map: 'shugenjia' },
  105: { notes: '杂货店家', map: 'zhahuodianzz' },
  106: { notes: '村长一楼', map: 'chunzhangjia1' },
  107: { notes: '村长二楼', map: 'chunzhangjias2' },
  108: { notes: '木匠家', map: 'mujiagjia' },
  109: { notes: '老太太家', map: 'laott' },
  110: { notes: '屠夫家', map: 'tfujia' },
  111: { notes: '迷宫', map: 'migon' },
  112: { notes: '菲菲家', map: 'feifeijia' },
  113: { notes: '医院', map: 'yiyuanshinei' },
};

// 各场景自侧门位（原版主包场景类 getPlayerBornPosition 覆盖表提取；坐标=该场景 TMX 像素系）
// 村景为原版 77x61 坐标（扩展村景 nav 网格需 +28 格偏移）
const SIDE = {
  2: { // village
    VILLAGE_AND_HOME: [1830, 5830], VILLAGE_AND_RIVER_1: [7580, 4930], VILLAGE_AND_RIVER_2: [7580, 2730],
    VILLAGE_AND_BAOLONG: [80, 4030], VILLAGE_AND_HOTSPRING: [100, 850], VILLAGE_AND_PADDY: [4060, 70],
    VILLAGE_AND_WIDOW_HOUSE: [705, 4850], VILLAGE_AND_JIASHIBO_HOUSE: [6700, 5215],
    VILLAGE_AND_SHUGEN_HOUSE: [2340, 3675], VILLAGE_AND_GROCERY_HOUSE: [5044, 3115],
    VILLAGE_AND_LEADER_ONE: [6900, 3310], VILLAGE_AND_CARPENTER: [275, 1620],
    VILLAGE_AND_OLDLADY_HOUSE: [2162, 1600], VILLAGE_AND_BUTCHER_HOUSE: [6750, 1275],
  },
  1: { VILLAGE_AND_HOME: [1545, 65], CABLEWAY_AND_HOME: [2591, 1206], HOME_AND_PLAYER_HOUSE: [1522, 1663] },
  3: { VILLAGE_AND_RIVER_1: [98, 2593], VILLAGE_AND_RIVER_2: [98, 491] },
  4: { PADDY_AND_NUNNERY: [2658, 54], VILLAGE_AND_PADDY: [2658, 1943] },
  5: { PADDY_AND_NUNNERY: [1948, 2731] },
  6: { VILLAGE_AND_HOTSPRING: [3922, 1437] },
  7: { VILLAGE_AND_BAOLONG: [3400, 1427], BAOLONG_AND_TRAIL: [95, 1427] },
  8: { TRAIL_AND_MINEGATE: [1553, 55], MINEGATE_AND_CEMETERY: [2816, 732], MINEGATE_AND_MAZE: [1041, 1082] },
  9: { MINEGATE_AND_CEMETERY: [88, 833], CEMETERY_AND_HILLTOP: [1750, 6543] },
  10: { BAOLONG_AND_TRAIL: [2823, 1337], TRAIL_AND_MINEGATE: [1641, 3811], TRAIL_AND_FEIFEI_HOUSE: [1067, 2846], TRAIL_AND_HOSPITAL_HOUSE: [2500, 2658] },
  11: { HILLTOP_AND_BRIDGE: [95, 966], BRIDGE_AND_FOREST: [3800, 966] },
  12: { CEMETERY_AND_HILLTOP: [1954, 71], HILLTOP_AND_BRIDGE: [3797, 1015] },
  13: { BRIDGE_AND_FOREST: [62, 3237], FOREST_AND_CABLEWAY: [3067, 54] },
  14: { FOREST_AND_CABLEWAY: [3056, 3263], CABLEWAY_AND_HOME: [3056, 3263] },
  101: { HOME_AND_PLAYER_HOUSE: [880, 55] },
  102: { VILLAGE_AND_WIDOW_HOUSE: [650, 100] },
  103: { VILLAGE_AND_JIASHIBO_HOUSE: [553, 95] },
  104: { VILLAGE_AND_SHUGEN_HOUSE: [465, 145] },
  105: { VILLAGE_AND_GROCERY_HOUSE: [340, 125] },
  106: { VILLAGE_AND_LEADER_ONE: [590, 122], LEADER_ONE_AND_LEADER_TWO: [855, 148] },
  107: { LEADER_ONE_AND_LEADER_TWO: [277, 150] },
  108: { VILLAGE_AND_CARPENTER: [410, 210] },
  109: { VILLAGE_AND_OLDLADY_HOUSE: [275, 135] },
  110: { VILLAGE_AND_BUTCHER_HOUSE: [505, 80] },
  111: { MINEGATE_AND_MAZE: [3559, 43] },
  112: { TRAIL_AND_FEIFEI_HOUSE: [373, 90] },
  113: { TRAIL_AND_HOSPITAL_HOUSE: [580, 181] },
};

// 全量跨场景通路（ScenePassageType 空间通路口径；DAY_AND_PLAYER_HOUSE=时间传送非空间门，排除）
const PASSAGES = [
  ['VILLAGE_AND_HOME', 2, 1], ['VILLAGE_AND_RIVER_1', 2, 3], ['VILLAGE_AND_RIVER_2', 2, 3],
  ['VILLAGE_AND_BAOLONG', 2, 7], ['VILLAGE_AND_HOTSPRING', 2, 6], ['VILLAGE_AND_PADDY', 2, 4],
  ['PADDY_AND_NUNNERY', 4, 5], ['BAOLONG_AND_TRAIL', 7, 10], ['TRAIL_AND_MINEGATE', 10, 8],
  ['MINEGATE_AND_CEMETERY', 8, 9], ['CEMETERY_AND_HILLTOP', 9, 12], ['HILLTOP_AND_BRIDGE', 12, 11],
  ['BRIDGE_AND_FOREST', 11, 13], ['FOREST_AND_CABLEWAY', 13, 14], ['CABLEWAY_AND_HOME', 14, 1],
  ['HOME_AND_PLAYER_HOUSE', 1, 101], ['VILLAGE_AND_WIDOW_HOUSE', 2, 102], ['VILLAGE_AND_JIASHIBO_HOUSE', 2, 103],
  ['VILLAGE_AND_SHUGEN_HOUSE', 2, 104], ['VILLAGE_AND_GROCERY_HOUSE', 2, 105], ['VILLAGE_AND_LEADER_ONE', 2, 106],
  ['LEADER_ONE_AND_LEADER_TWO', 106, 107], ['VILLAGE_AND_CARPENTER', 2, 108], ['VILLAGE_AND_OLDLADY_HOUSE', 2, 109],
  ['VILLAGE_AND_BUTCHER_HOUSE', 2, 110], ['MINEGATE_AND_MAZE', 8, 111], ['TRAIL_AND_FEIFEI_HOUSE', 10, 112],
  ['TRAIL_AND_HOSPITAL_HOUSE', 10, 113],
];
const VILLAGE_EXPAND_OFFSET = 28; // 原版村景 77x61 嵌入扩展村景 133x117 的格偏移（mod 入口对齐同值）
const toNavPos = (scene, px, py) => scene === 2 ? [px / 100 + VILLAGE_EXPAND_OFFSET, py / 100 + VILLAGE_EXPAND_OFFSET] : [px / 100, py / 100];

// 校验：每通路两侧门位均存在
const missing = [];
for (const [p, a, b] of PASSAGES) {
  if (!SIDE[a]?.[p]) missing.push(`${p}@${a}`);
  if (!SIDE[b]?.[p]) missing.push(`${p}@${b}`);
}
if (missing.length) {
  // 缺侧回落默认 (175,280)（原版 MapSceneBase/HouseSceneBase 默认出生位）
  for (const m of missing) {
    const [p, sc] = m.split('@');
    SIDE[sc] = SIDE[sc] || {};
    SIDE[sc][p] = [175, 280];
  }
  console.log('[build-scene-portals] 缺侧回落默认出生位:', missing.join(', '));
}

// ---------- 输出 scenes.json（填齐 scene 编号；27 场景全量后移除旧 pending 占位条目） ----------
const SCENE_MAP_BY_MAP = Object.fromEntries(Object.entries(SCENE_MAP).map(([n, v]) => [v.map, Number(n)]));
const scenes = JSON.parse(readFileSync(`${NAV_DIR}/scenes.json`, 'utf8'));
for (const e of scenes.scenes) {
  const byMap = SCENE_MAP_BY_MAP[String(e.scene || e.name).replace('village(村庄)', 'daditu')];
  if (byMap) {
    e.scene = byMap;
    e.notes = SCENE_MAP[byMap].notes;
    e.status = 'ready';
    e.source = e.source || `maps/${String(e.scene) === String(byMap) ? e.name : SCENE_MAP[byMap].map}.json + 主包 Gscene_config`;
  }
  if (e.name === 'village(村庄)') { e.scene = 2; e.notes = '村'; e.status = 'ready'; }
}
// 27 场景编号齐备：移除早期骨架遗留的 pending 占位条目（home-map/hospital-house 已被 1/113 覆盖）
scenes.scenes = scenes.scenes.filter(e => typeof e.scene === 'number');
// 同 sceneType 去重（保留携带 anchors/source 的更完整条目）
const dedup = new Map();
for (const e of scenes.scenes) {
  const cur = dedup.get(e.scene);
  if (!cur || e.anchors !== undefined && cur.anchors === undefined) dedup.set(e.scene, e);
}
scenes.scenes = [...dedup.values()].sort((a, b) => a.scene - b.scene);
scenes.note = '27 场景全量编号（主包 Gscene_config 提取）；village 为扩展村景（133x117），其余为原生 TMX 尺寸。';
writeFileSync(`${NAV_DIR}/scenes.json`, JSON.stringify(scenes, null, 1));

// ---------- 输出 portals.json（全量门户图：nav 坐标系 = 各场景 nav 网格） ----------
const portalLists = {};
for (const [p, a, b] of PASSAGES) {
  const pa = SIDE[a][p], pb = SIDE[b][p];
  for (const [sc, pos] of [[a, pa], [b, pb]]) {
    const [cx, cy] = toNavPos(sc, pos[0], pos[1]);
    const to = sc === a ? b : a;
    (portalLists[sc] = portalLists[sc] || []).push({ scene: sc, toScene: to, x: Math.round(cx * 100), y: Math.round(cy * 100), passage: p });
  }
}
// 同场景 POI 门户（村景内房屋门，原 portals.json 保留项）
const prevPortals = JSON.parse(readFileSync(`${NAV_DIR}/portals.json`, 'utf8'));
if (Array.isArray(prevPortals.village)) {
  for (const v of prevPortals.village) portalLists[2] = portalLists[2] || [];
  // 去重后合并（只保留跨场景条目 + 村景内 POI 中非跨场景重复项）
  const existing = portalLists[2];
  for (const v of prevPortals.village) {
    if (!existing.some(e => e.passage === v.passage && e.x === v.x && e.y === v.y)) existing.push(v);
  }
}
const note = `全量门户图（${PASSAGES.length} 条跨场景通路 x2 侧）：主包 ScenePassageType + 各场景类 getPlayerBornPosition 提取；村景坐标为扩展网格系（原版+28 格偏移）；同日时间传送 DAY_AND_PLAYER_HOUSE 非空间门，不入图。门位落格前经 snapToWalkable 吸附（gen-nav --check 门）。`;
writeFileSync(`${NAV_DIR}/portals.json`, JSON.stringify({ ...portalLists, note }, null, 1));
console.log(`[build-scene-portals] scenes 填齐 ${Object.keys(SCENE_MAP).length} 场景；portals ${Object.values(portalLists).reduce((n, l) => n + l.length, 0)} 条`);
