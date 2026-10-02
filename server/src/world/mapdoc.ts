// world/mapdoc.ts —— 全村文本地图（H 包/R9 T2 设计铁律）
// 由数据文件自动生成全村坐标文档，供纯文本 LLM 自规划路线；
// 服务端 A* 只兜底合法性，视觉永不进 Agent 决策回路。
// 内容结构：坐标约定 -> 不可通行区（阻挡/水/栅栏簇 bbox）-> 建筑与门位 ->
//            地标 -> 矿点 -> 主干路网 -> 跨场景门户 -> 自规划示例。
// 纯函数：读 nav-2.json / buildings / landmarks / mine-spots / portals / spawn-points。
import fs from 'node:fs';
import path from 'node:path';

export interface MapDocOpts {
  dataDir: string;            // 数据根目录（含 nav/、*.json）
  sceneWidth: number;         // 网格宽（格）
  sceneHeight: number;        // 网格高（格）
  cellPx: number;             // 像素/格
}

export interface MapDoc {
  text: string;
  blockedClusters: Array<{ x0: number; y0: number; x1: number; y1: number; n: number }>;
  waterClusters: Array<{ x0: number; y0: number; x1: number; y1: number; n: number }>;
  roadCount: number;
}

function loadJson<T>(dataDir: string, rel: string): T {
  const p = path.join(dataDir, rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// 连通分量 BFS：把同类散格聚成簇，输出 bbox（3.3 万格绝不逐格罗列）
function clusterOf(kind: number, grid: number[], W: number, H: number) {
  const seen = new Set<number>();
  const out: Array<{ x0: number; y0: number; x1: number; y1: number; n: number }> = [];
  const idx = (x: number, y: number) => y * W + x;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (seen.has(i) || grid[i] !== kind) continue;
      // BFS 8 邻
      const q: Array<[number, number]> = [[x, y]];
      seen.add(i);
      let x0 = x, x1 = x, y0 = y, y1 = y, n = 0;
      while (q.length) {
        const [cx, cy] = q.pop()!;
        n++;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx);
        y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = idx(nx, ny);
          if (!seen.has(ni) && grid[ni] === kind) { seen.add(ni); q.push([nx, ny]); }
        }
      }
      out.push({ x0, y0, x1, y1, n });
    }
  }
  // 只保留较大簇（< 4 格的散点忽略，避免噪声）
  return out.filter(c => c.n >= 4);
}

export function buildMapDoc(opts: MapDocOpts): MapDoc {
  const { dataDir, sceneWidth: W, sceneHeight: H, cellPx } = opts;
  const nav = loadJson<{ kind: number[]; roadIdx?: (number | null)[]; roadNames?: Record<number, string> }>(dataDir, 'nav/nav-2.json');
  const buildingsRaw = loadJson<unknown>(dataDir, 'buildings.json');
  const landmarksRaw = loadJson<unknown>(dataDir, 'landmarks.json');
  const minesRaw = loadJson<unknown>(dataDir, 'mine-spots.json');
  const portalsRaw = loadJson<unknown>(dataDir, 'nav/portals.json');
  const spawnsRaw = loadJson<unknown>(dataDir, 'spawn-points.json');

  // 兼容数组 / 对象分场景两种形态：拍平取全部条目
  const flatten = (raw: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
    if (raw && typeof raw === 'object') {
      const out: Array<Record<string, unknown>> = [];
      for (const v of Object.values(raw as Record<string, unknown>)) {
        if (Array.isArray(v)) out.push(...(v as Array<Record<string, unknown>>));
        else if (v && typeof v === 'object') out.push(v as Record<string, unknown>);
      }
      return out;
    }
    return [];
  };
  const bldArr = flatten(buildingsRaw) as Array<{ name?: string; door?: { x: number; y: number }; scene?: number }>;
  const portals = flatten(portalsRaw) as Array<{ scene: number; toScene: number; x?: number; y?: number; name?: string; gridX?: number; gridY?: number }>;
  const landmarks = flatten(landmarksRaw) as Array<{ id: string; name: string; x: number; y: number; type?: string }>;
  const mines = flatten(minesRaw) as Array<{ gx: number; gy: number }>;
  const spawns = (spawnsRaw && typeof spawnsRaw === 'object' && !Array.isArray(spawnsRaw)
    ? spawnsRaw
    : { houses: [] }) as { scene?: number; houses: Array<{ id: number; type?: string; door: { x: number; y: number } }> };
  if (!spawns.houses) spawns.houses = [];

  const grid = nav.kind || [];
  const blocked = clusterOf(1, grid, W, H);
  const water = clusterOf(2, grid, W, H);
  const roadNames = nav.roadNames || {};

  const px = (g: number) => g * cellPx;

  const L: string[] = [];
  L.push('# 全村文本地图（自动生成，数据驱动）');
  L.push('');
  L.push('## 坐标约定');
  L.push(`- 网格 ${W} x ${H}，每格 = ${cellPx} 像素；世界坐标（像素）= 格 x ${cellPx}`);
  L.push(`- 坐标原点左上；x 向右、y 向下`);
  L.push('');
  L.push('## 不可通行区（簇 bbox，格坐标）');
  L.push(`- 阻挡簇 ${blocked.length} 个（n>=4）：`);
  for (const c of blocked.slice(0, 20)) L.push(`  - [${c.x0},${c.y0}]-[${c.x1},${c.y1}] (${c.n}格)`);
  L.push(`- 水域簇 ${water.length} 个：`);
  for (const c of water.slice(0, 10)) L.push(`  - [${c.x0},${c.y0}]-[${c.x1},${c.y1}] (${c.n}格)`);
  L.push(`- 主干路 ${roadNames ? Object.keys(roadNames).length : 0} 段（kind=4，带路名）`);
  L.push('');
  L.push('## 建筑与门位');
  for (const b of bldArr) {
    if (!b?.name) continue;
    const door = b.door ? `门像素(${b.door.x},${b.door.y})` : '门未知';
    L.push(`- ${b.name}：${door}`);
  }
  L.push('');
  L.push('## 地标');
  for (const l of landmarks) L.push(`- ${l.name}（${l.id}，type=${l.type || '-'}，格 ${l.x},${l.y}）`);
  L.push('');
  L.push('## 矿点');
  for (const m of mines) L.push(`- 矿（格 ${m.gx},${m.gy}，像素 ${px(m.gx)},${px(m.gy)}）`);
  L.push('');
  L.push('## 跨场景门户');
  for (const p of portals) {
    const nm = p.name || `场景${p.scene} -> 场景${p.toScene}`;
    const gx2 = p.x !== undefined ? Math.round(p.x / 100) : '?';
    const gy2 = p.y !== undefined ? Math.round(p.y / 100) : '?';
    L.push(`- ${nm}（像素 ${p.x ?? '?'},${p.y ?? '?'}，格 ${gx2},${gy2}）`);
  }
  L.push('');
  L.push('## 出生槽位（门户吸附环）');
  for (const h of spawns.houses || []) {
    L.push(`- 宅 ${h.id}（${h.type || ''}）门口 像素(${h.door.x},${h.door.y})`);
  }
  L.push('');
  L.push('## 自规划示例（LLM 读此图 + observe 当下坐标自推路线）');
  L.push('- 例：从 主角家门楼(格 15,16) 到 交易大厅(格 81,80)：沿主干道 kind=4 南下再东，move_to 服务端 A* 兜底');
  L.push('- 例：从 果园(格 4,100) 到 河湾钓点：东行过南环路，近水域簇边缘下钓');
  L.push('');
  L.push('## 设计哲学注记');
  L.push('- 本图 + observe.pos 当下坐标 = LLM 自规划全部依据；视觉（截图）仅开发验收用，永不进 Agent 决策回路');
  L.push('- 新增玩家可见信息必须同步文本通道（CI 表面审计）');

  return {
    text: L.join('\n'),
    blockedClusters: blocked,
    waterClusters: water,
    roadCount: roadNames ? Object.keys(roadNames).length : 0,
  };
}
