// world/social-actions.ts —— 送礼 / 结关系 的共享实现（人类 /ws 消息与 Agent /act 同源）
//
// 事故背景：social_give / social_bind 原来只长在 /ws 游戏通道的消息分支里，
// Agent 走 /act 完全触不到 —— 「人情练」类任务对 Agent 永远无法完成，
// 社交内容事实上只对人开放。抽出后两个通道调同一份逻辑，行为与事件流保持一致。
import type { App } from '../app.ts';
import type { WorldState } from '../persistence/state.ts';
import { knapAdd, knapHas, knapSub } from './farm.ts';
import {
  resolveOnlineUid, resolveAnyUid, socialNear, giftFavGain, addFav, favBetween,
  dmUnlock, announceDmUnlock, pushDmUnlockedLists, pairOf, RELATION_DEFS,
} from './social.ts';
import { recordGossip, isSignificant } from './gossip.ts';
import { publishNotice } from './notices.ts';
import { taskCount } from './tasks.ts';

export interface SocialActionResult {
  ok: boolean;
  msg: string;
  /** 供上层推送的附加消息（social_in / 公告已在函数内广播） */
  detail?: Record<string, unknown>;
}

function nickOf(app: App, state: WorldState, uid: string, fallback: string): string {
  return state.online.get(uid)?.nick || app.accountNick(uid) || fallback;
}

/** 送礼：在线玩家走距离校验；离线 Agent 走 agent:<uid> 收货（F1） */
export function socialGive(app: App, state: WorldState, uid: string, rawTarget: string, rawItemId: unknown, rawNum: unknown): SocialActionResult {
  const target = resolveOnlineUid(state, String(rawTarget || '')) || resolveAnyUid(state, app.accounts, String(rawTarget || '')) || '';
  const pB = state.online.get(target);
  const targetAgentId = target.startsWith('agent:') ? target.slice(6) : null;
  if (!target) return { ok: false, msg: '对方不在村内（在线昵称 / uid / agent:<uid>）' };
  if (!pB && !targetAgentId) return { ok: false, msg: '对方不在线' };
  if (pB) {
    const nr = socialNear(state, uid, target);
    if (!nr.ok) return { ok: false, msg: nr.msg || '距离太远（需同场景 8 格内）' };
  }
  const itemId = Number(rawItemId);
  const num = Math.max(1, Math.min(99, Number(rawNum || 1)));
  const it = app.tables.items.find(x => x.id === itemId);
  if (!it) return { ok: false, msg: '没有这个物品' };
  const pmA = state.playersDb.get(uid);
  if (!pmA || !knapHas(pmA, itemId, num)) return { ok: false, msg: `背包里没有 ${it.name}×${num}` };

  knapSub(pmA, itemId, num);
  const pmB = state.playersDb.get(target);
  if (pmB) knapAdd(pmB, itemId, num);
  const g = giftFavGain(state, app.tables, uid, target, itemId);
  const fav = addFav(state, uid, target, g);
  taskCount(state, app.tables, uid, 'give');

  const fromNick = nickOf(app, state, uid, '玩家');
  const toNick = targetAgentId ? `托管 ${targetAgentId}` : (pB?.nick || target);

  app.log.append('item.consumed', uid, { uid, itemId, num });
  app.log.append('item.gained', uid, { uid: target, itemId, num });
  app.log.append('social.fav', uid, { a: uid, b: target, delta: g });
  app.log.append('task.progress', uid, { uid, type: 'give', n: 1 });

  for (const [, o] of state.online) o.ws.send(JSON.stringify({ t: 'chat', uid: 'sys', nick: '系统', text: `${fromNick} 送给了 ${toNick} ${it.name}×${num}，好感 +${g}` }));
  if (pB) pB.ws.send(JSON.stringify({ t: 'social_in', social: 'give', from: uid, nick: fromNick, itemId, num, fav }));
  else if (targetAgentId) app.inboxPush(targetAgentId, fromNick, `收到你赠送的 ${it.name}×${num}，好感 +${g}`);

  const giveMeet = dmUnlock(state, uid, target);
  if (giveMeet) {
    app.log.append('dm.unlocked', uid, { a: uid, b: target });
    announceDmUnlock(state, uid, target, `${fromNick} 给 ${toNick} 送了礼物，可以开始私聊了`);
    pushDmUnlockedLists(state, uid, target, app.agentSockets);
  }
  const giftCoins = itemId === 1 ? num : 0;
  if (isSignificant('gift', giftCoins)) {
    recordGossip(state, Date.now(), 'gift', `${fromNick} 大手笔送了 ${toNick} ${it.name}×${num}`);
    publishNotice(state, Date.now(), 'generic', `村口传闻：${fromNick} 给 ${toNick} 送了 ${it.name}×${num}`);
  }
  console.log(`[social] ${fromNick} 送礼 ${toNick} ${it.name}x${num}`);
  return {
    ok: true,
    msg: `送礼成功，${toNick} 对你的好感 +${g}（现 ${fav}）`,
    detail: { social: 'give', itemId, num, fav, target },
  };
}

/** 结为关系：好友(30) / 知己(60) / 伴侣(90)，按对 TA 的好感门槛 */
export function socialBind(app: App, state: WorldState, uid: string, rawTarget: string, rawType: string): SocialActionResult {
  const target = resolveOnlineUid(state, String(rawTarget || '')) || resolveAnyUid(state, app.accounts, String(rawTarget || '')) || '';
  const pB = state.online.get(target);
  if (!pB) return { ok: false, msg: '对方不在线（结关系需要对方在线）' };
  const type = String(rawType || 'friend');
  const def = RELATION_DEFS[type];
  if (!def) return { ok: false, msg: `关系类型：friend(好友)/confidant(知己)/partner(伴侣)` };
  const f = favBetween(state, uid, target);
  if ((f.aToB || 0) < def.level) return { ok: false, msg: `好感不足：${def.name} 需要你对 TA 好感 ≥ ${def.level}（当前 ${f.aToB || 0}）` };
  const { p: pair } = pairOf(state, uid, target);
  if (pair.relation && pair.relation !== type) return { ok: false, msg: `你们已有其他关系（${RELATION_DEFS[pair.relation]?.name}）` };
  pair.relation = type;
  pair.relBy = uid;
  state.persist();
  taskCount(state, app.tables, uid, 'bind');
  app.log.append('social.relation', uid, { a: uid, b: target, relation: type, by: uid });
  app.log.append('task.progress', uid, { uid, type: 'bind', n: 1 });
  const fromNick = nickOf(app, state, uid, '玩家');
  for (const [, o] of state.online) o.ws.send(JSON.stringify({ t: 'chat', uid: 'sys', nick: '系统', text: `${fromNick} 与 ${pB.nick} 结为「${def.name}」！` }));
  pB.ws.send(JSON.stringify({ t: 'social_in', social: 'bind', from: uid, nick: fromNick, relation: type, relName: def.name }));
  console.log(`[social] ${fromNick} 与 ${pB.nick} 结为 ${def.name}`);
  return { ok: true, msg: `已与 ${pB.nick} 结为「${def.name}」`, detail: { social: 'bind', target, relation: type, relName: def.name } };
}