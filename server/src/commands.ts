// commands.ts —— 聊天命令：/buy /sell /give /make /cast /build /bind /tp /eat /task /who /help
import type { World, Actor } from './world.ts';
import { data, itemNames, balance } from './config.ts';
import { giveGift, bind, unbind, canTp } from './social.ts';
import { onBuild, onEat, onSowCount } from './tasks.ts';

function msg(w: World, a: Actor, text: string) {
  for (const [ws, c] of w.clients) if (c.actorId === a.id) w.send(ws, { type: 'toast', text });
}

function sayWorld(w: World, a: Actor, text: string) {
  w.broadcast?.({ type: 'chat', channel: 'game', from: a.name, text });
}

/** 解析 "名字或ID" → item */
function findItem(arg: string): any {
  const byId = data.items.find(x => x.id === +arg);
  if (byId) return byId;
  return data.items.find(x => x.name === arg) || data.items.find(x => (x.name || '').includes(arg));
}

/** 解析 "角色名或ID" */
function findActor(w: World, arg: string): Actor | null {
  for (const a of w.actors.values()) if (a.name === arg || a.id === arg) return a;
  return null;
}

function near(w: World, a: Actor): Actor[] {
  const out: Actor[] = [];
  for (const o of w.actors.values()) {
    if (o.id === a.id) continue;
    if (o.sceneId === a.sceneId && o.instanceId === a.instanceId && Math.abs(o.x - a.x) + Math.abs(o.y - a.y) <= 3) out.push(o);
  }
  return out;
}

export function runCommand(w: World, a: Actor, text: string) {
  const parts = text.slice(1).trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case 'help': {
      msg(w, a, '命令：/buy 物品 数量 · /sell 物品 数量 · /give 角色 物品 数量 · /make 配方ID · /cast 配方ID ·/build 设施 · /bind 角色 关系 · /tp 角色 · /eat 物品 · /task · /who · /help');
      break;
    }
    case 'who': {
      const list = near(w, a).map(x => `${x.name}${x.isAgent ? '(🤖)' : ''}`).join('、');
      msg(w, a, list ? `附近：${list}` : '附近没有其他角色');
      break;
    }
    case 'buy': {
      const it = findItem(args[0] || '');
      if (!it) return msg(w, a, '找不到这个物品');
      const n = Math.max(1, Math.min(99, +(args[1] || 1)));
      const shop = data.shop.find(s => s.prop_id === it.id);
      if (!shop) return msg(w, a, `${it.name} 不在商店出售`);
      const cost = shop.price * n;
      if (a.gold < cost) return msg(w, a, `金币不足（需要 ${cost}）`);
      a.gold -= cost;
      a.items[String(it.id)] = (a.items[String(it.id)] || 0) + n;
      msg(w, a, `🛒 购买 ${it.name}×${n}（-${cost} 金币）`);
      break;
    }
    case 'sell': {
      const it = findItem(args[0] || '');
      if (!it) return msg(w, a, '找不到这个物品');
      const n = Math.max(1, Math.min((a.items[String(it.id)] || 0), +(args[1] || 1)));
      if (n <= 0) return msg(w, a, '背包里没有这个物品');
      const price = (it.sell_price || 0) * n;
      a.items[String(it.id)] -= n;
      a.gold += price;
      msg(w, a, `💰 卖出 ${it.name}×${n}（+${price} 金币）`);
      break;
    }
    case 'give': {
      const target = findActor(w, args[0] || '');
      if (!target) return msg(w, a, '找不到这个角色（需在附近）');
      if (!near(w, a).some(x => x.id === target.id)) return msg(w, a, `${target.name} 不在附近`);
      const it = findItem(args[1] || '');
      if (!it) return msg(w, a, '找不到这个物品');
      const n = Math.max(1, +(args[2] || 1));
      const r = giveGift(w, a, target, it.id, n);
      msg(w, a, `🎁 ${r.msg}`);
      break;
    }
    case 'make':
    case 'cast': {
      const rid = +args[0];
      const r = data.recipes.find(x => x.id === rid);
      if (!r) return msg(w, a, '找不到这个配方（/cast 20007 等）');
      if (r.category !== (cmd === 'make' ? 'make' : 'cast')) return msg(w, a, `这是「${r.category}」类配方，用 /${r.category} ${rid}`);
      // 检查材料
      for (const [itemId, need] of r.cost || []) {
        if ((a.items[String(itemId)] || 0) < need) {
          const nm = itemNames[String(itemId)] || '#' + itemId;
          return msg(w, a, `材料不足：还需要 ${nm}×${need - (a.items[String(itemId)] || 0)}`);
        }
      }
      for (const [itemId, need] of r.cost || []) a.items[String(itemId)] -= need;
      a.items[String(r.prop_id)] = (a.items[String(r.prop_id)] || 0) + 1;
      msg(w, a, `🔨 制作成功：${r.name}！`);
      sayWorld(w, a, `制作了 ${r.name}`);
      break;
    }
    case 'build': {
      // 设施：熔炉1001/仓库1002/铸造台1003/洒水器1/2/3（名字或 id）
      const facs = balance.facilities || [];
      const arg = args.join(' ');
      let fac = facs.find((f: any) => f.id === +arg || f.name === arg);
      if (!fac) return msg(w, a, '可建造：熔炉(1001) 仓库(1002) 铸造台(1003) 初级/中级/高级洒水器(1/2/3)');
      const room = w.getRoom(a.sceneId, a.instanceId);
      w.loadRoomCollide(room);
      const [c, r] = faceOf(a);
      if (room.buildings.some(b => b.grid[0] === c && b.grid[1] === r)) return msg(w, a, '那里已有设施');
      if (!w.canWalk(room, c, r)) return msg(w, a, '那里不能放置设施');
      // 扣材料
      const cost = fac.build_cost || (fac.recipe ? data.recipes.find(r => r.id === fac.recipe)?.cost : null);
      if (cost) {
        for (const [itemId, need] of cost) {
          if ((a.items[String(itemId)] || 0) < need) return msg(w, a, `材料不足（${itemNames[String(itemId)] || itemId}×${need}）`);
        }
        for (const [itemId, need] of cost) a.items[String(itemId)] -= need;
      }
      room.buildings.push({ buildId: fac.id, sceneId: room.sceneId, instanceId: room.instanceId, grid: [c, r], owner: a.id });
      msg(w, a, `🏗️ 建好了 ${fac.name}！`);
      sayWorld(w, a, `在附近建起了 ${fac.name}`);
      onBuild(w, a, fac.id);
      // 洒水器浇灌里程碑计数
      if ([1, 2, 3].includes(fac.id)) {
        const radius = fac.radius ?? 1;
        const n = room.plants.filter(p => Math.abs(p.grid[0] - c) <= radius && Math.abs(p.grid[1] - r) <= radius).length;
        onSowCount(w, a, n);
      }
      if (fac.id === 1002) { // 仓库：容量生效（简化：计数任务）
      }
      break;
    }
    case 'bind': {
      const target = findActor(w, args[0] || '');
      if (!target) return msg(w, a, '找不到这个角色（需在附近）');
      const r = bind(w, a, target, (args[1] || '').toLowerCase());
      msg(w, a, r.msg);
      break;
    }
    case 'unbind': {
      const target = findActor(w, args[0] || '');
      if (!target) return msg(w, a, '找不到这个角色');
      const r = unbind(w, a, target);
      msg(w, a, r.msg);
      break;
    }
    case 'tp': {
      const target = findActor(w, args[0] || '');
      if (!target) return msg(w, a, '找不到这个角色');
      if (!canTp(a, target)) return msg(w, a, '只有伴侣/灵魂搭档/结义可以传送');
      const room = w.getRoom(target.sceneId, target.instanceId);
      w.loadRoomCollide(room);
      a.sceneId = target.sceneId; a.instanceId = target.instanceId;
      for (let i = 1; i < 5; i++) if (w.canWalk(room, target.x + i, target.y)) { a.x = target.x + i; a.y = target.y; break; }
      msg(w, a, `✨ 传送到 ${target.name} 身边`);
      break;
    }
    case 'eat': {
      const it = findItem(args[0] || '');
      if (!it) return msg(w, a, '找不到这个食物');
      if ((a.items[String(it.id)] || 0) <= 0) return msg(w, a, '背包里没有这个食物');
      if (it.type !== 3 && it.type !== 8) return msg(w, a, '这个不能吃');
      a.items[String(it.id)] -= 1;
      const restore = 10 + Math.floor(Math.random() * 31); // 10~40（balance.food_restore_range）
      a.hunger = Math.min(100, a.hunger + restore);
      msg(w, a, `🍽️ 吃了 ${it.name}，饱食度 +${restore}`);
      onEat(w, a);
      break;
    }
    case 'task': {
      const list = Object.values<any>(data.tasks.tasks)
        .filter(t => a.tasks.accepted.includes(String(t.id)) && !a.tasks.completed.includes(String(t.id)))
        .map(t => `${t.id} ${t.name}`);
      msg(w, a, list.length ? `任务书：\n${list.join('\n')}` : '目前没有进行中的任务');
      break;
    }
    case 'agent': {
      const cfg = a.brainCfg!;
      if (args[0] === 'regen') cfg.token = w.randToken();
      msg(w, a, `🤖 Agent 接入\n地址: ws://<服务器>:8081/agent\nToken: ${cfg.token}\n外部程序示例: server/examples/agent-program.mjs\n（/agent regen 重新生成）`);
      break;
    }
    default:
      msg(w, a, `未知命令 /${cmd}（/help 查看）`);
  }
}

function faceOf(a: Actor): [number, number] {
  const m = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as Record<string, number[]>;
  const [dx, dy] = m[a.dir];
  return [a.x + dx, a.y + dy];
}