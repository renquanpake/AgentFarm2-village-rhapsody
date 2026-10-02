// cognition/observe.ts —— 托管 Agent 可观察世界状态（LLM 上下文；字段与 tools/game-agent.mjs 约定一致）
import type { App } from '../app.ts';
import type { WorldState } from '../persistence/state.ts';
import {
  worldPlants, worldPlots, worldSprinklers, growPlants, plantAtWorld, cropAtWorld, treeOf,
  soilAt, waterAt, plotAt,
} from '../world/farm.ts';
import { PLANT_CROPS, SPRINKLER_RANGE } from '../world/tables.ts';
import { favBetween, dmUnlockedList } from '../world/social.ts';
import { fitnessOf } from '../world/fitness.ts';
import { activeFestival } from '../world/festival.ts';
import { municipalOf, municipalContext, villageNavOf, buildingTargetOf, type Building } from '../navigation/municipal.ts';

/** D2 区域级障碍：12 格窗口内连续水域/树丛 -> 区域名 + 格子范围 + 绕行原则（§4.2：不喂单树坐标清单给导航） */
export function obstacleRegions(app: App, state: WorldState, gx: number, gy: number, radius = 12): Array<Record<string, unknown>> {
  const W = app.tables.farm?.waterW ?? 200;
  const H = app.tables.farm?.waterH ?? 200;
  const x1 = Math.max(0, gx - radius), y1 = Math.max(0, gy - radius);
  const x2 = Math.min(W - 1, gx + radius), y2 = Math.min(H - 1, gy + radius);
  const inWin = (x: number, y: number) => x >= x1 && y >= y1 && x <= x2 && y <= y2;
  const out: Array<Record<string, unknown>> = [];
  const cluster = (isCell: (x: number, y: number) => boolean): void => {
    const seen = new Set<string>();
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
      if (!isCell(x, y) || seen.has(`${x},${y}`)) continue;
      const comp: Array<[number, number]> = [[x, y]];
      seen.add(`${x},${y}`);
      let head = 0;
      while (head < comp.length) {
        const [cx, cy] = comp[head++];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx, ny = cy + dy;
          const k = `${nx},${ny}`;
          if (inWin(nx, ny) && isCell(nx, ny) && !seen.has(k)) { seen.add(k); comp.push([nx, ny]); }
        }
      }
      const xs = comp.map(c => c[0]), ys = comp.map(c => c[1]);
      out.push({
        name: isWaterCell ? '水域' : '树丛',
        x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys),
        cells: comp.length,
        hint: isWaterCell ? '水域不可直穿：绕行该区域；要钓鱼/取水 move_to 到水边（near="water"）'
          : '树丛不可直穿：绕行该区域；砍树先 move_to 到树丛边缘再 chop 目标树',
      });
    }
  };
  let isWaterCell = true;
  cluster((x, y) => waterAt(app.tables, x, y));
  isWaterCell = false;
  const treeCells = new Set(growPlants(state).filter(p => treeOf(p)).map(p => `${p.x},${p.y}`));
  cluster((x, y) => treeCells.has(`${x},${y}`));
  return out;
}



export function observeState(app: App, uid: string, username: string, nick: string): Record<string, unknown> {
  const { state, tables, notes } = app;
  const pm = state.playersDb.get(uid) || new Map();
  const pd = (pm.get('playerData') || {}) as Record<string, unknown>;
  const kn = (pm.get('knapData') || {}) as { props?: Array<{ id: number; num?: number }> };
  const npc = (pm.get('npcData') || {}) as { npcDatas?: Array<{ npcId: number; starNum?: number; stayScene?: number }> };
  const shop = (pm.get('shopData') || {}) as { openShopItems?: unknown[] };

  const props = (kn.props || []).map(p => {
    const it = tables.items.find(x => x.id === p.id);
    return { id: p.id, name: it ? (it.name ?? '道具' + p.id) : ('道具' + p.id), num: p.num };
  });
  const coins = (kn.props || []).find(p => p.id === 1)?.num || 0;
  const npcList = (npc.npcDatas || []).map(n => ({ npcId: n.npcId, star: n.starNum, scene: n.stayScene }));

  // Agent 位置（独立于玩家存档）
  const apos = state.agentPos.get(uid) || {
    x: (pd.playerPos as { x?: number } | undefined)?.x ?? 0,
    y: (pd.playerPos as { y?: number } | undefined)?.y ?? 0,
    scene: (pd.sceneType as number | undefined) ?? 2,
  };

  const gx = Math.floor((apos.x ?? 0) / 100), gy = Math.floor((apos.y ?? 0) / 100);

  // 周围植物（3 格内）：玩家/Agent 种的作物 + 可砍的树
  const plantsNear = growPlants(state)
    .filter(p => (p.farmType === 1 || treeOf(p)) && Math.abs(p.x - gx) <= 3 && Math.abs(p.y - gy) <= 3)
    .map(p => {
      const crop = tables.cropOf(p.plantId);
      return {
        gx: p.x, gy: p.y, px: p.x * 100 + 50, py: p.y * 100 + 50, plantId: p.plantId,
        kind: treeOf(p) ? `树(${p.hp}HP)` : (crop ? `${crop.name}${(p.growDay ?? 0) >= crop.days ? '(成熟可收)' : `(${p.growDay ?? 0}/${crop.days}天)`}` : '植物'),
        hp: p.hp,
      };
    });
  const mineSpots = tables.mineSpots.map(s => ({ gx: s.gx, gy: s.gy, px: s.gx * 100 + 50, py: s.gy * 100 + 50 }));

  // 附近可砍的树（默认 3 格内供 chop 定位；10 格清单仅在 AF_NAV_DEBUG_TREES=1 调试时输出——§4.2 不喂导航级树坐标清单）
  const treeRadius = process.env.AF_NAV_DEBUG_TREES === '1' ? 10 : 3;
  const treesNear = growPlants(state)
    .filter(p => treeOf(p) && Math.abs(p.x - gx) <= treeRadius && Math.abs(p.y - gy) <= treeRadius)
    .map(p => ({ gx: p.x, gy: p.y, px: p.x * 100 + 50, py: p.y * 100 + 50, plantId: p.plantId, hp: p.hp }));
  // D2 区域级障碍（水域/树丛：区域名 + 格子范围 + 绕行原则）
  const obstacles = obstacleRegions(app, state, gx, gy);

  // L3 市政指引（roads-landmarks §4）：当前路名 + 最近地标方位（场景级地标；村景带路名反查）
  const sceneId = apos.scene ?? (pd.sceneType as number | undefined) ?? 2;
  const mu = municipalOf(app);
  const landmarksHere = mu.landmarks.get(sceneId) || []; // 场景坐标空间各自独立，不回退村景
  const munNav = sceneId === 2 ? villageNavOf(app) : null;
  const mun = municipalContext(munNav, gx, gy, landmarksHere);
  const municipal = (mun.onRoad || mun.nearest.length)
    ? { onRoad: mun.onRoad, landmarks: mun.nearest, hint: mun.onRoad ? `你正沿「${mun.onRoad}」行走` : '按地标方位 move_to；路名会随路线摘要回报' }
    : null;

  // P2 建筑功能层（buildings.json）：同场景已落成建筑（门位 + kind + move_to near 名），供 Agent 定位/写信/进出
  const buildingsHere = (mu.buildings.get(sceneId) || [])
    .filter((b): b is Building & { door: { x: number; y: number } } => !b.pending && b.door !== null)
    .map(b => ({
      id: b.id, name: b.name, kind: b.kind, mode: b.mode,
      doorPx: b.door.x, doorPy: b.door.y,
      dist: Math.max(Math.abs(Math.floor(b.door.x / 100) - gx), Math.abs(Math.floor(b.door.y / 100) - gy)),
    }))
    .sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id))
    .slice(0, 6);

  // 附近可犁地 / 已犁地块（3 格内）
  const tillableNear: Array<Record<string, unknown>> = [];
  const plotsNear: Array<Record<string, unknown>> = [];
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= (tables.farm ? tables.farm.soilW : 999) || ny >= (tables.farm ? tables.farm.soilH : 999)) continue;
      if (soilAt(tables, nx, ny) && !plotAt(state, nx, ny) && !plantAtWorld(state, nx, ny) && !waterAt(tables, nx, ny)) {
        tillableNear.push({ gx: nx, gy: ny, px: nx * 100 + 50, py: ny * 100 + 50 });
      }
      if (plotAt(state, nx, ny)) {
        const pl = worldPlots(state).find(q => q.x === nx && q.y === ny);
        const pp = pl && pl.plantUID ? cropAtWorld(state, nx, ny) : null;
        const crop = pp ? tables.cropOf(pp.plantId) : null;
        plotsNear.push({
          gx: nx, gy: ny, px: nx * 100 + 50, py: ny * 100 + 50,
          planted: !!pp,
          crop: crop ? crop.name : null,
          status: !pp ? '已犁·可播种' : (crop && (pp.growDay ?? 0) >= crop.days ? '成熟可收' : (crop ? `${pp.growDay ?? 0}/${crop.days}天·未成熟` : '植物')),
        });
      }
    }
  }

  // 附近玩家（同场景 8 格内）
  const playersNear = Array.from(state.online.values())
    .filter(o => o.uid !== uid && o.scene === (apos.scene ?? (pd.sceneType as number | undefined) ?? 0) && Math.abs(o.x - (apos.x ?? 0)) + Math.abs(o.y - (apos.y ?? 0)) <= 800)
    .map(o => ({ nick: o.nick, dist: Math.round((Math.abs(o.x - (apos.x ?? 0)) + Math.abs(o.y - (apos.y ?? 0))) / 100) }));

  // 与所有在线玩家的好友度/关系
  const social = Array.from(state.online.values())
    .filter(o => o.uid !== uid)
    .map(o => {
      const f = favBetween(state, uid, o.uid);
      return { nick: o.nick, favToOther: f.aToB, favFromOther: f.bToA, relation: f.relation };
    });

  const inboxArr = notes.inboxOf(app.usernameOf(uid)).arr;
  const ops = (state.playerOps.get(uid) || []).map(o => ({ kind: o.kind, text: o.text, at: o.at }));

  return {
    nick: app.accountNick(uid),
    uid,
    scene: apos.scene ?? (pd.sceneType as number | undefined) ?? 0,
    pos: { x: apos.x ?? 0, y: apos.y ?? 0 },
    day: (pd.day as number | undefined) ?? 0, time: (pd.time as number | undefined) ?? 0, weather: (pd.weatherType as number | undefined) ?? 1,
    coins,
    backpack: props,
    npcs: npcList,
    shopItems: (shop.openShopItems || []).slice(0, 20),
    online: Array.from(state.online.values()).map(p => ({ nick: p.nick, scene: p.scene })),
    plantsNear,
    treesNear,
    tillableNear,
    plotsNear,
    playersNear,
    social,
    dmUnlocked: dmUnlockedList(state, uid),
    farm: {
      plots: worldPlots(state).map(p => ({ gx: p.x, gy: p.y, px: p.x * 100 + 50, py: p.y * 100 + 50, plantUID: p.plantUID })).slice(0, 12),
      mineSpots,
    },
    sprinklers: worldSprinklers(state).map(s => ({ gx: s.x, gy: s.y, level: s.level, range: SPRINKLER_RANGE[s.level ?? 1] })),
    waterNear: (() => { let n = false; for (let dy = -1; dy <= 1 && !n; dy++) for (let dx = -1; dx <= 1; dx++) if (waterAt(tables, gx + dx, gy + dy)) { n = true; break; } return n; })(),
    obstacles: obstacles.length ? { regions: obstacles, note: '障碍按区域提供，move_to 服务端自动绕行；无需逐格探路' } : null,
    municipal,
    buildings: buildingsHere.length ? { here: buildingsHere, hint: '同场景建筑（dist=门位切比雪夫格数）；move_to {near:"建筑名"} 直接到门位（自动跨场景）' } : null,
    fitness: (() => {
      const r = fitnessOf(state, uid);
      const attrs = Object.entries(r.attrs).filter(([, v]) => (v ?? 0) > 0);
      if (!attrs.length) return null;
      return { attrs: Object.fromEntries(attrs), hint: '训练（力量/敏捷/亲和）在村景健身房，act train {attr}；每次 +1，5 分钟冷却' };
    })(),
    festival: (() => {
      const fest = activeFestival(app);
      if (!fest) return null;
      const hall = buildingTargetOf(municipalOf(app), 'banquet-hall');
      return { name: fest, venue: hall ? { scene: hall.scene, name: hall.name, doorPx: hall.x, doorPy: hall.y } : null, hint: '今日节日，赛事分随 act fish/harvest 自动累计；act forecast 可看明日节日预告' };
    })(),
    inbox: inboxArr.length
      ? { unread: inboxArr.length, last: { from: inboxArr[inboxArr.length - 1].from, text: inboxArr[inboxArr.length - 1].text } }
      : { unread: 0, last: null },
    playerOps: ops,
    chatRecent: app.chatLog.slice(-3),
    seeds: Object.keys(PLANT_CROPS).map(id => ({ id: Number(id), name: PLANT_CROPS[Number(id)].name + '种子' })),
  };
}

export { worldPlants };
