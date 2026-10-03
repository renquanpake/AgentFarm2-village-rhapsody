// tools/gen-home-slots.mjs —— 阶段一 B4：场景 1（家门口）槽位化导航
//
// 事故背景：联机村 R1 要求「多个玩家各有家」，但场景 1 只有原版单人的 29x29 网格
// （data/nav/nav-zhujuejia.json 单槽），第 2+ 名玩家与第 1 名玩家共用同一片家门口，
// 房子没有「私有」可言；design.md §B4 要求的 N 槽纵向拼接从未落地。
//
// 做法（纯数据合成，确定性）：
//   1. 读原版场景 1 碰撞层 -> 单槽 29x29 blocked
//   2. 纵向拼 N 个槽（每槽 29 宽 + 1 列隔断），槽间整列阻挡 = 跨槽不可走
//   3. 每槽把出生点（原版家门口锚点）登记进 data/home-slots.json
//   4. 产出 data/nav/nav-zhujuejia-slots.json + data/home-collision.json（单槽源，供审计）
//
// 用法：node tools/gen-home-slots.mjs [--slots 8] [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildNavGrid } = await import(`${repo}/server/src/navigation/navgen.ts`);

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const SLOTS = Math.max(1, Math.min(32, arg('--slots', 8)));
const CHECK = process.argv.includes('--check');

const src = JSON.parse(fs.readFileSync(`${repo}/server/public/client/maps/zhujuejia.json`, 'utf8'));
const collide = (src.layers || []).find(l => l.name === 'collide');
if (!collide) { console.error('[gen-home-slots] 源数据缺 collide 层'); process.exit(1); }
const W = src.width, H = src.height;
const blocked = new Uint8Array(W * H);
for (let i = 0; i < collide.data.length; i++) if (collide.data[i]) blocked[i] = 1;

// 单槽导航（29x29）——作为源基准与审计对照
const single = buildNavGrid(1, Array.from(blocked), W, H);
const homeCollision = { width: W, height: H, blocked: Array.from(blocked), source: 'server/public/client/maps/zhujuejia.json(collide 层)' };

// 出生锚点：取单槽里离中心最近的可走格（原版家门口附近），逐槽复制
function nearestWalkable(nav, gx, gy) {
  for (let r = 0; r < Math.max(nav.width, nav.height); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = gx + dx, y = gy + dy;
      if (x < 0 || y < 0 || x >= nav.width || y >= nav.height) continue;
      if (nav.blocked[y * nav.width + x]) continue;
      return { x, y };
    }
  }
  return { x: 1, y: 1 };
}
const anchor = nearestWalkable(single, Math.floor(W / 2), Math.floor(H / 2));

// N 槽纵向拼接：槽 i 占 y ∈ [i*(H+1), i*(H+1)+H-1]，槽间第 H 列整列阻挡
const totalH = SLOTS * (H + 1);
const mergedBlocked = new Uint8Array(W * totalH);
for (let i = 1; i < SLOTS; i++) { const gapRow = i * (H + 1) - 1; for (let x = 0; x < W; x++) mergedBlocked[gapRow * W + x] = 1; } // 槽间隔断：整行阻挡 = 跨槽不可走
const slots = [];
for (let i = 0; i < SLOTS; i++) {
  const yOff = i * (H + 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mergedBlocked[(yOff + y) * W + x] = blocked[y * W + x];
  // 槽内出生点（可走校验：若锚点在本槽被挡，取本槽最近可走格）
  const inSlot = buildNavGrid(1, Array.from(mergedBlocked.subarray(yOff * W, (yOff + H) * W)), W, H);
  const a = nearestWalkable(inSlot, anchor.x, anchor.y);
  slots.push({
    slot: i,
    rect: { x: 0, y: yOff, w: W, h: H },
    spawnCell: { x: a.x, y: a.y },
    spawnPx: { x: a.x * 100 + 50, y: (yOff + a.y) * 100 + 50 },
    doorHint: `槽 ${i + 1}：世界格 (${a.x},${yOff + a.y})，像素 (${a.x * 100 + 50},${(yOff + a.y) * 100 + 50})`,
  });
}

const nav = buildNavGrid(1, Array.from(mergedBlocked), W, totalH);
const out = {
  scene: 1,
  slots: SLOTS,
  width: W,
  height: totalH,
  slotHeight: H,
  note: `场景 1 槽位化导航：原版单槽 ${W}x${H} 纵向拼 ${SLOTS} 槽，槽间整列阻挡（跨槽不可走 = 房子私有）。服务端按 spawn-slots 给第 n 名玩家第 n 槽；客户端渲染待实机。`,
  blocked: nav.blocked,
  kind: nav.kind,
  cost: nav.cost,
  clearance: nav.clearance,
};

const doc = {
  version: 1,
  updated: '2026-10-03',
  note: 'B4 槽位表：第 n 名玩家（1-based）住第 n 槽；坐标为世界格/像素。跨槽路径在 nav 里被整列阻挡，服务端再按 uid 做归属校验（world/spawn-slots.ts）。',
  scene: 1,
  slots,
};

const navFile = `${repo}/data/nav/nav-zhujuejia-slots.json`;
const slotFile = `${repo}/data/home-slots.json`;
const collFile = `${repo}/data/home-collision.json`;

if (CHECK) {
  const cur = fs.existsSync(navFile) ? JSON.parse(fs.readFileSync(navFile, 'utf8')) : null;
  const ok = cur && cur.slots === SLOTS && cur.width === W && cur.height === totalH
    && JSON.stringify(cur.blocked) === JSON.stringify(nav.blocked);
  console.log(ok ? '[gen-home-slots] PASS 槽位导航数据与源一致' : '[gen-home-slots] FAIL 槽位导航数据过期或不一致（重跑不带 --check）');
  if (!ok) process.exit(1);
  process.exit(0);
}

fs.writeFileSync(collFile, JSON.stringify(homeCollision, null, 1) + '\n');
fs.writeFileSync(slotFile, JSON.stringify(doc, null, 1) + '\n');
fs.writeFileSync(navFile, JSON.stringify(out, null, 1) + '\n');
const walkable = Array.from(nav.blocked).filter(b => !b).length;
console.log(`[gen-home-slots] 场景 1 = ${SLOTS} 槽 x ${W}x${H}（合并 ${W}x${totalH}，可走 ${walkable} 格）；`);
console.log(`  写出 ${path.relative(repo, collFile)} / ${path.relative(repo, slotFile)} / ${path.relative(repo, navFile)}`);
for (const s of slots.slice(0, 3)) console.log(`  ${s.doorHint}`);
console.log(`  ...共 ${slots.length} 槽`);