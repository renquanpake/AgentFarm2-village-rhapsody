// social.ts —— 社交系统（D5）：近距对话 / 好感 / 送礼 / 特殊关系
import type { World, Actor } from './world.ts';
import { onTalk, onRelation, onHelp } from './tasks.ts';
import { writeRelations } from './memory.ts';

const GREET = ['你好呀！', '今天天气真不错', '你吃了吗？', '村里最近有什么新鲜事？', '一起干活去？', '嘿，好久不见！'];
const REPLY = ['嗯嗯！', '是呀～', '挺好的呀', '一起吃个饭吧！', '好呀好呀', '哈哈哈', '听说矿井里出了新矿', '你要种点什么？'];
const FAREWELL = ['那我先走啦', '回头聊！', '再见～', '明天见！'];
const rnd = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

interface DialogState { a: string; b: string; lines: number; last: number; starter: string }

const dialogs = new Map<string, DialogState>();

function dist(a: Actor, b: Actor): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function say(w: World, who: Actor, target: Actor | null, text: string) {
  // NPC 说话带头像（wq_ 半身像）；游戏/系统频道
  const head = who.isNpc && who.pathName ? `wq_${who.pathName}.png` : '';
  w.broadcast?.({ type: 'chat', channel: 'game', from: who.name, text, head });
}

export function addRelation(w: World, a: Actor, b: Actor, n: number) {
  const cur = a.relations[b.id] || 0;
  a.relations[b.id] = Math.max(0, Math.min(100, cur + n));
  if (Math.floor(a.relations[b.id] / 20) !== Math.floor(cur / 20)) {
    w.broadcast?.({ type: 'toast', text: `❤️ ${a.name} 与 ${b.name} 的好感上升（${a.relations[b.id]}）` });
  }
  writeRelations(a); // 低频落盘（好感变化即更新关系记忆）
  onRelation(w, a);
}

/** 双方互加好感 */
export function bond(w: World, a: Actor, b: Actor, n: number) {
  addRelation(w, a, b, n);
  addRelation(w, b, a, n);
}

export function socialTick(w: World, dtMs: number) {
  // 1) 开启新对话：近距离（≤2 格）免费角色（谁进范围→who 是发起者，先说第一句）
  for (const a of w.actors.values()) {
    if (a.asleep || a.busy) continue;
    for (const o of w.actors.values()) {
      if (o.id === a.id || o.asleep || o.busy) continue;
      if (a.sceneId !== o.sceneId || a.instanceId !== o.instanceId) continue;
      if (dist(a, o) <= 2) {
        const key = [a.id, o.id].sort().join('|');
        if (dialogs.has(key)) continue;
        dialogs.set(key, { a: a.id, b: o.id, lines: 0, last: Date.now(), starter: a.id });
        say(w, a, o, rnd(GREET));
        break;
      }
    }
  }
  // 2) 推进/结束对话
  for (const [key, d] of [...dialogs]) {
    const A = w.actors.get(d.a), B = w.actors.get(d.b);
    if (!A || !B) { dialogs.delete(key); continue; }
    if (Date.now() - d.last < 2600) continue;
    if (dist(A, B) > 2) { endDialog(w, key, d, A, B); continue; }
    if (d.lines >= 5) { endDialog(w, key, d, A, B); continue; }
    d.lines++;
    const speaker = d.lines % 2 === 1 ? B : A;
    const other = speaker === A ? B : A;
    say(w, speaker, other, rnd(REPLY));
    d.last = Date.now();
  }
}

function endDialog(w: World, key: string, d: DialogState, A: Actor, B: Actor) {
  dialogs.delete(key);
  onTalk(w, A); onTalk(w, B);
  const g = 1 + Math.floor(Math.random() * 3);
  bond(w, A, B, g);
  say(w, rnd([A, B]), null, rnd(FAREWELL));
}

/** 玩家向某人说话：对方回应一轮（人-人 / 人-Agent 都用） */
export function pendingTalk(w: World, a: Actor, target: Actor, text: string) {
  const key = [a.id, target.id].sort().join('|');
  // 若已是对话中忽略（避免刷屏）
  if (dialogs.has(key)) return;
  dialogs.set(key, { a: a.id, b: target.id, lines: 1, last: Date.now(), starter: a.id });
  say(w, target, a, rnd(REPLY));
  onTalk(w, a); onTalk(w, target);
  bond(w, a, target, 1);
}

/** 送礼（好感 +5~20，诚实：随机幅度；挚友/伴侣 ×2） */
export function giveGift(w: World, a: Actor, target: Actor, itemId: number, n: number) {
  const key = String(itemId);
  if ((a.items[key] || 0) < n) return { ok: false, msg: '数量不够' };
  a.items[key] -= n;
  target.items[key] = (target.items[key] || 0) + n;
  let g = 5 + Math.floor(Math.random() * 16);
  if ((a.relation[target.id] ?? '') === 'sworn' || (a.relation[target.id] ?? '') === 'partner' || (a.relation[target.id] ?? '') === 'soul') g *= 2;
  bond(w, a, target, g);
  onHelp(w, target); // 送礼算一次"帮忙"
  w.broadcast?.({ type: 'chat', channel: 'game', from: a.name, text: `🎁 送给了 ${target.name} ${n} 个礼物，好感 +${g}` });
  return { ok: true, msg: `好感 +${g}` };
}

// —— 特殊关系（R19）：一对象一关系、7 天解除冷却、仪式公告 ——
export const RELATION_DEFS: Record<string, { level: number; name: string; desc: string }> = {
  friend: { level: 30, name: '好友', desc: '互相转赠' },
  master: { level: 80, name: '师徒', desc: '徒弟劳动效率+20%' },
  apprentice: { level: 80, name: '徒弟', desc: '向师傅学习' },
  sworn: { level: 90, name: '结义', desc: '产出+10%、双向传送' },
  partner: { level: 100, name: '伴侣', desc: '家园合并、资源共享' },
  soul: { level: 100, name: '灵魂搭档', desc: '共享仓库+传送+互信' },
};

export function bind(w: World, a: Actor, target: Actor, type: string): { ok: boolean; msg: string } {
  const def = RELATION_DEFS[type];
  if (!def) return { ok: false, msg: `未知关系类型（friend/master/apprentice/sworn/partner/soul）` };
  const cur = a.relations[target.id] || 0;
  if (cur < def.level) return { ok: false, msg: `好感不足：${type} 需要 ${def.level}，当前 ${cur}` };
  // 一对象一关系
  if (a.relation[target.id] && a.relation[target.id] !== type) return { ok: false, msg: '你们已有其他关系' };
  a.relation[target.id] = type;
  target.relation[a.id] = type === 'master' ? 'apprentice' : type === 'apprentice' ? 'master' : type;
  // 仪式：广场公告
  writeRelations(a); writeRelations(target);
  w.broadcast?.({ type: 'toast', text: `🎉 全村公告：${a.name} 与 ${target.name} 结为「${def.name}」！` });
  onRelation(w, a);
  return { ok: true, msg: `已结为「${def.name}」` };
}

export function unbind(w: World, a: Actor, target: Actor): { ok: boolean; msg: string } {
  const cur = a.relation[target.id];
  if (!cur) return { ok: false, msg: '你们没有特殊关系' };
  a.relation[target.id] = '';
  target.relation[a.id] = '';
  w.broadcast?.({ type: 'toast', text: `${a.name} 解除了与 ${target.name} 的关系（7 天冷却后不可再立即绑定）` });
  return { ok: true, msg: '已解除' };
}

/** 能否使用传送（伴侣/灵魂/结义） */
export function canTp(a: Actor, target: Actor): boolean {
  const r = a.relation[target.id];
  return r === 'partner' || r === 'soul' || r === 'sworn';
}