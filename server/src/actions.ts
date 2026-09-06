// actions.ts —— 交互动作（D2/D3）：耕地/播种/浇水/收获/挖矿/砍树/钓鱼/睡觉/设施
import type { World, Actor, Room, Building, Plant } from './world.ts';
import { DIR_V } from './world.ts';
import { data, itemNames, scenesById, balance } from './config.ts';
import { resourceAt } from './maps.ts';
import { onUseTool, onPlant, onHarvest, onCount } from './tasks.ts';
import { writeDiary, writePlans } from './memory.ts';

const FAC_SPRINKLER = { 1: '初级洒水器', 2: '中级洒水器', 3: '高级洒水器' };
const FAC_NAME: Record<number, string> = { 1001: '熔炉', 1002: '仓库', 1003: '铸造台' };

function toast(w: World, a: Actor, text: string) {
  w.broadcast?.({ type: 'toast', text: `${text}` });
  for (const [ws, c] of w.clients) if (c.actorId === a.id) w.send(ws, { type: 'toast', text });
}

function sayRoom(w: World, a: Actor, text: string) {
  w.broadcast?.({ type: 'chat', channel: 'game', from: a.name, text });
}

export function faceCell(a: Actor): [number, number] {
  const [dx, dy] = DIR_V[a.dir];
  return [a.x + dx, a.y + dy];
}

export function addItem(w: World, a: Actor, itemId: number, n: number): boolean {
  if (n <= 0) return true;
  const key = String(itemId);
  a.items[key] = (a.items[key] || 0) + n;
  return true;
}

export function hasItem(a: Actor, itemId: number, n = 1): boolean {
  return (a.items[String(itemId)] || 0) >= n;
}

export function addGold(w: World, a: Actor, n: number) {
  a.gold = Math.max(0, a.gold + n);
}

export function doInteract(w: World, a: Actor) {
  if (a.asleep) return;
  if (a.busy && Date.now() < a.busy.until) { toast(w, a, '⏳ 忙着手头的事…'); return; }
  const hour = w.hour;
  // 1) 夜晚 → 睡觉
  if (hour >= balance.time.night_start_hour || hour < 5) { sleep(w, a); return; }
  const [c, r] = faceCell(a);
  const room = w.getRoom(a.sceneId, a.instanceId);
  w.loadRoomCollide(room);

  // 2) 设施
  const b = room.buildings.find(x => x.grid[0] === c && x.grid[1] === r);
  if (b) { operateBuilding(w, a, b, room); return; }

  // 3) 植物：成熟收获 / 未熟浇水
  const p = room.plants.find(x => x.grid[0] === c && x.grid[1] === r);
  if (p) {
    if (p.grow >= plantGrowDays(p.plantId)) harvest(w, a, p, room);
    else waterPlant(w, a, p);
    return;
  }

  // 4) 已开垦的空地 → 播种
  if (room.tilled.has(`${c},${r}`)) { sow(w, a, room, c, r); return; }

  // 5) 资源点：挖矿 / 砍树 / 钓鱼
  const res = w.mapName ? resourceAt(room.mapName, c, r) : null;
  if (res) {
    if (res.kind === 'ore') mine(w, a, room, c, r);
    else if (res.kind === 'tree') chop(w, a, room, c, r);
    else if (res.kind === 'water') fish(w, a, room, c, r);
    return;
  }

  // 6) 可走空地 + 农场场景 → 开垦
  const sc = scenesById[a.sceneId];
  if (sc?.farm && w.canWalk(room, c, r)) { till(w, a, room, c, r); return; }

  toast(w, a, '🤷 这里没有什么可做的');
}

function plantGrowDays(plantId: number): number {
  const p = data.plants.find(x => x.id === plantId);
  return p?.grow ?? 1;
}

/** 种子 → 作物链终点 id（收获产物） */
function harvestIdOf(seedId: number): number {
  let cur = data.plants.find(x => x.id === seedId);
  let guard = 0;
  while (cur?.next_id?.length && guard++ < 6) cur = data.plants.find(x => x.id === cur.next_id[0]);
  return cur?.id ?? seedId;
}

// —— 开垦 ——
function till(w: World, a: Actor, room: Room, c: number, r: number) {
  if (!hasItem(a, 2)) { toast(w, a, '🔧 需要锄头（杂货店有卖）'); return; }
  const key = `${c},${r}`;
  if (!room.tilled.has(key)) room.tilled.add(key);
  toast(w, a, '🌱 开垦了一块地');
  onUseTool(w, a, 2);
}

// —— 播种 ——
function sow(w: World, a: Actor, room: Room, c: number, r: number) {
  const seed = Object.keys(a.items).find(k => {
    const it = data.items.find(x => x.id === +k);
    return it?.type === 4 && a.items[k] > 0;
  });
  if (!seed) { toast(w, a, '🧺 背包里没有种子，去杂货店买（/buy 小麦种子）'); return; }
  if (room.plants.some(x => x.grid[0] === c && x.grid[1] === r)) { toast(w, a, '这块地已经种了东西'); return; }
  a.items[seed] -= 1;
  room.plants.push({ plantId: +seed, sceneId: room.sceneId, instanceId: room.instanceId, grid: [c, r], grow: 0, watered: false, wateredToday: false });
  const nm = data.items.find(x => x.id === +seed)?.name || ('#' + seed);
  toast(w, a, `🌿 种下了${nm}`);
  onPlant(w, a);
  onUseTool(w, a, 0); // 播种动作算 1 次"种地"
}

// —— 浇水 ——
function waterPlant(w: World, a: Actor, p: Plant) {
  if (p.wateredToday) { toast(w, a, '💧 今天已经浇过水了'); return; }
  p.watered = true; p.wateredToday = true;
  p.grow += 0.5; // 浇水即快进半天生长
  toast(w, a, '💧 浇水，作物长得更快了');
}

// —— 收获 ——
function harvest(w: World, a: Actor, p: Plant, room: Room) {
  const outId = harvestIdOf(p.plantId);
  const nm = itemNames[String(outId)] || ('#' + outId);
  // 结义(90)+10% / 师徒:徒弟+20% 收获
  let n = 1;
  for (const [oid, rel] of Object.entries(a.relation)) {
    if (rel === 'sworn' && (a.relations[oid] || 0) >= 90) n += 0; // 产出+10%
    if (rel === 'apprentice' && (a.relations[oid] || 0) >= 80) n += 0.2;
  }
  const gain = Math.max(1, Math.round(n * (isSwornBoosted(a) ? 1.1 : 1)));
  addItem(w, a, outId, gain);
  room.plants = room.plants.filter(x => x !== p);
  toast(w, a, `🌾 收获了 ${nm}×${gain}`);
  w.broadcast?.({ type: 'toast', text: `${a.name} 收获了 ${nm}` });
  onHarvest(w, a);
}

function isSwornBoosted(a: Actor): boolean {
  for (const [oid, rel] of Object.entries(a.relation)) {
    if (rel === 'sworn' && (a.relations[oid] || 0) >= 90) return true;
    if (rel === 'apprentice' && (a.relations[oid] || 0) >= 80) return true;
  }
  return false;
}

// —— 挖矿 ——
function mine(w: World, a: Actor, room: Room, c: number, r: number) {
  if (!hasItem(a, 58)) { toast(w, a, '⛏️ 需要镐子'); return; }
  a.busy = { until: Date.now() + 900, label: 'mining' };
  // 掉落：矿表 rate_rewards 按概率 + 必得碎石
  const rewards: Record<string, number> = {};
  rewards['7'] = 1; // 碎石
  for (const m of data.mine) {
    for (const [itemId, count, rate] of m.rate_rewards || []) {
      if (Math.random() * 100 < (rate ?? 0)) rewards[String(itemId)] = (rewards[String(itemId)] || 0) + count;
    }
  }
  if (!Object.keys(rewards).some(k => k !== '7' && rewards[k] > 0)) rewards['61'] = 1; // 保底铜矿
  for (const [k, v] of Object.entries(rewards)) addItem(w, a, +k, v);
  const names = Object.keys(rewards).filter(k => rewards[k] > 0).map(k => `${itemNames[k] || '#' + k}×${rewards[k]}`).join(' ');
  toast(w, a, `⛏️ 挖矿成功：${names}`);
  onUseTool(w, a, 58);
}

// —— 砍树 ——
function chop(w: World, a: Actor, room: Room, c: number, r: number) {
  if (!hasItem(a, 4)) { toast(w, a, '🪓 需要斧头'); return; }
  a.busy = { until: Date.now() + 700, label: 'chop' };
  let n = 1;
  if (hasItem(a, 98)) n = 2;       // 不得了的斧子：两下砍倒（每次给2）
  else if (hasItem(a, 85)) n = 1;  // 锋利斧头
  addItem(w, a, 18, n);
  toast(w, a, `🪓 砍树得 木材×${n}`);
  onUseTool(w, a, 4);
}

// —— 钓鱼 ——
function fish(w: World, a: Actor, room: Room, c: number, r: number) {
  if (!hasItem(a, 6)) { toast(w, a, '🎣 需要鱼竿'); return; }
  const hasBait = hasItem(a, 59);
  a.busy = { until: Date.now() + 2200, label: 'fish' };
  setTimeout(() => {
    if (a.asleep) return;
    const pool = data.fish.filter(f => hasBait || (f.rate ?? 0) >= 100);
    const total = pool.reduce((s, f) => s + (f.rate ?? 10), 0);
    let roll = Math.random() * total;
    let pick = pool[pool.length - 1];
    for (const f of pool) { roll -= (f.rate ?? 10); if (roll <= 0) { pick = f; break; } }
    addItem(w, a, pick.prop_id, 1);
    if (hasBait) a.items['59'] -= 1;
    const nm = itemNames[String(pick.prop_id)] || pick.name;
    toast(w, a, `🐟 钓到了 ${nm}！`);
    w.broadcast?.({ type: 'chat', channel: 'game', from: a.name, text: `🎣 钓到了 ${nm}` });
    onCount(w, a, 'fish');
  }, 2200);
}

// —— 睡觉 ——
function sleep(w: World, a: Actor) {
  if (a.asleep) return;
  a.asleep = true;
  toast(w, a, '💤 回屋睡觉了…');
  // 睡前写日记（低频记忆落盘）
  try { writeDiary(a, w.day); } catch { }
  const home = w.getRoom(101, a.instanceId || 0);
  w.loadRoomCollide(home);
  if (home.width) { a.sceneId = 101; a.instanceId = a.instanceId || 0; const s = w.findSpawn(home); a.x = s[0]; a.y = s[1]; }
  setTimeout(() => {
    a.asleep = false;
    a.hunger = 100; a.hp = 100;
    // 晨起写今日计划（低频记忆落盘）
    try { writePlans(a, w.day); } catch { }
    // 睡到次日 06:00
    const cur = w.gameAbsMin;
    const next6 = (Math.floor(cur / 1440) + 1) * 1440 + 6 * 60;
    w.gameAbsMin = next6;
    const front = w.getRoom(1, 0);
    w.loadRoomCollide(front);
    const s = w.findSpawn(front);
    a.sceneId = 1; a.instanceId = 0; a.x = s[0]; a.y = s[1];
    toast(w, a, `🌞 新的一天！第 ${w.day} 天，饱食度与体力恢复`);
    w.broadcast?.({ type: 'toast', text: `${a.name} 睡醒，新的一天开始了` });
  }, 6000);
}

// —— 设施操作 ——
function operateBuilding(w: World, a: Actor, b: Building, room: Room) {
  const name = FAC_SPRINKLER[b.buildId] || FAC_NAME[b.buildId] || `设施#${b.buildId}`;
  if (FAC_SPRINKLER[b.buildId]) {
    // 手动触发浇灌半径内植物
    const radius = (balance as any).facilities?.find((f: any) => f.id === b.buildId)?.radius ?? 1;
    let n = 0;
    for (const p of room.plants) {
      if (Math.abs(p.grid[0] - b.grid[0]) <= radius && Math.abs(p.grid[1] - b.grid[1]) <= radius && !p.wateredToday) {
        p.watered = true; p.wateredToday = true; p.grow += 0.5; n++;
      }
    }
    toast(w, a, `${name} 浇灌了 ${n} 块地`);
    return;
  }
  if (b.buildId === 1001) toast(w, a, '🔥 熔炉：可把矿石熔成金属锭（后续版本）。用它解锁铸造台');
  else if (b.buildId === 1002) toast(w, a, '🏠 仓库：容量 100，可存放多余物资');
  else if (b.buildId === 1003) toast(w, a, '⚒️ 铸造台：用 /cast 查看并铸造「不得了的」巨工具');
  else toast(w, a, `${name} 已就位`);
}