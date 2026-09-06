// save.ts —— JSON 存档（C5）：定时 + 退出保存；重启恢复
import fs from 'node:fs';
import path from 'node:path';
import type { World, Actor, Room, Plant, Building } from './world.ts';
import { SAVE_DIR } from './config.ts';

const SAVE_FILE = () => path.join(SAVE_DIR, 'save.json');

export function saveGame(w: World) {
  try {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    const d = {
      version: 1,
      savedAt: new Date().toISOString(),
      world: { absMin: w.gameAbsMin, nextId: w.nextId },
      players: [...w.actors.values()].filter(a => !a.isNpc).map(a => ({
        id: a.id, name: a.name, color: a.color, isAgent: a.isAgent,
        sceneId: a.sceneId, instanceId: a.instanceId, x: a.x, y: a.y, dir: a.dir,
        hunger: a.hunger, hp: a.hp, gold: a.gold, items: a.items,
        relations: a.relations, relation: a.relation,
        hosted: a.hosted, stats: a.stats, counters: a.counters,
        tasks: a.tasks, brainPlan: a.brain.plan,
        brainCfg: a.brainCfg ? { mode: a.brainCfg.mode, vision: a.brainCfg.vision, token: a.brainCfg.token, baseUrl: a.brainCfg.baseUrl, model: a.brainCfg.model, temperature: a.brainCfg.temperature } : undefined // 注意：key 不落档（敏感）
      })),
      rooms: [...w.rooms.values()].filter(r => r.plants.length || r.buildings.length || r.tilled.size).map(r => ({
        key: r.key, sceneId: r.sceneId, instanceId: r.instanceId, owner: r.owner,
        plants: r.plants, buildings: r.buildings,
        tilled: [...r.tilled]
      }))
    };
    fs.writeFileSync(SAVE_FILE(), JSON.stringify(d, null, 1));
    console.log(`[save] ${new Date().toLocaleTimeString()} 已存档（${d.players.length} 角色）`);
  } catch (e) { console.error('[save] 失败:', e); }
}

export function restoreGame(w: World) {
  try {
    if (!fs.existsSync(SAVE_FILE())) return;
    const d = JSON.parse(fs.readFileSync(SAVE_FILE(), 'utf8'));
    if (!d.players?.length) return;
    w.gameAbsMin = d.world?.absMin ?? 9 * 60;
    w.nextId = d.world?.nextId ?? Math.max(2, d.players.length + 1);
    for (const p of d.players) {
      if (p.isNpc) continue; // NPC 每次启动重建（createNpcs）
      const a: Actor = {
        id: p.id, name: p.name, color: p.color || '#ffd166', isAgent: !!p.isAgent,
        sceneId: p.sceneId, instanceId: p.instanceId, x: p.x, y: p.y, dir: p.dir || 'down', moving: false,
        hunger: p.hunger, hp: p.hp, gold: p.gold, items: p.items || {},
        relations: p.relations || {}, relation: p.relation || {},
        hosted: !!p.isAgent || !!p.hosted, lastInput: Date.now(), asleep: false, busy: null,
        brain: { plan: p.brainPlan || 'idle', path: null, nextThink: Date.now(), lastThought: '', cmdQueue: [] },
        brainCfg: p.brainCfg ? { mode: p.brainCfg.mode || 'builtin', vision: !!p.brainCfg.vision, token: p.brainCfg.token || '', baseUrl: p.brainCfg.baseUrl, model: p.brainCfg.model, temperature: p.brainCfg.temperature, externalConnected: false } : { mode: 'builtin', vision: false, token: '', externalConnected: false },
        stats: p.stats || { useTool: {}, talk: 0, help: 0, plant: 0 },
        counters: p.counters || {}, tasks: p.tasks || { accepted: [], completed: [] },
        spawnedAt: Date.now()
      };
      w.actors.set(a.id, a);
    }
    for (const r of d.rooms || []) {
      const room = w.getRoom(r.sceneId, r.instanceId);
      room.owner = r.owner;
      room.plants = (r.plants || []).map((p: Plant) => ({ ...p }));
      room.buildings = (r.buildings || []).map((b: Building) => ({ ...b }));
      room.tilled = new Set(r.tilled || []);
    }
    console.log(`[restore] 恢复存档：${d.players.length} 角色，第 ${w.day} 天`);
  } catch (e) { console.error('[restore] 失败:', e); }
}