// world/social.ts —— 玩家间社交：好感 / 送礼 / 关系绑定 / DM 解锁 / 同场景共处
// 数据存 world.socialData（世界级）与玩家 afTasks（私有）；DM 日志持久化到 data/dm-logs/。
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import type { WorldState } from '../persistence/state.ts';
import type { AccountStore } from '../persistence/accounts.ts';
import type { Tables } from './tables.ts';
import type { DmEntry, SocialPair } from '../types.ts';
import { loadJson } from '../persistence/state.ts';
import { DM_SCENE_COOLDOWN_MS } from '../config.ts';

export const RELATION_DEFS: Record<string, { level: number; name: string }> = {
  friend: { level: 30, name: '好友' },
  confidant: { level: 60, name: '知己' },
  partner: { level: 90, name: '伴侣' },
};

// ---------- 系统频道广播（uid:'sys'，全部在线玩家） ----------
export function sysChat(state: WorldState, text: string): void {
  for (const p of state.online.values()) {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'chat', uid: 'sys', nick: '系统', text }));
  }
}

// ---------- 好感 / 关系 ----------
export function pairOf(state: WorldState, a: string, b: string): { k: string; p: SocialPair } {
  const k = [a, b].sort().join('_');
  const s = state.socialDataObj();
  if (!s.pairs[k]) s.pairs[k] = { fav: { [a]: 0, [b]: 0 }, relation: '', relBy: '' };
  return { k, p: s.pairs[k] };
}

export function favBetween(state: WorldState, a: string, b: string) {
  const { p } = pairOf(state, a, b);
  return { aToB: p.fav[a] || 0, bToA: p.fav[b] || 0, relation: p.relation || '', relBy: p.relBy || '' };
}

export function addFav(state: WorldState, giver: string, target: string, n: number): number {
  const { p } = pairOf(state, giver, target);
  const prev = p.fav[giver] || 0;
  p.fav[giver] = Math.min(100, prev + n);
  state.schedulePersist();
  const now = p.fav[giver];
  if (Math.floor(now / 20) !== Math.floor(prev / 20)) {
    const pA = state.online.get(giver), pB = state.online.get(target);
    const na = pA ? pA.nick : giver, nb = pB ? pB.nick : target;
    sysChat(state, `❤️ ${na} 对 ${nb} 的好感提升（${now}）`);
  }
  return now;
}

export function socialNear(state: WorldState, aUid: string, bUid: string): { ok: boolean; msg?: string } {
  const A = state.online.get(aUid), B = state.online.get(bUid);
  if (!A || !B) return { ok: false, msg: '对方不在线' };
  if (A.scene !== B.scene) return { ok: false, msg: '你们不在同一场景，需要走近才能互动' };
  const d = Math.abs(A.x - B.x) + Math.abs(A.y - B.y);
  if (d > 520) return { ok: false, msg: `离对方太远（距离 ${Math.round(d / 100)} 格，需要 5 格内）` };
  return { ok: true };
}

export function giftFavGain(state: WorldState, tables: Tables, aUid: string, bUid: string, itemId: number): number {
  const it = tables.items.find(x => x.id === itemId);
  let g = 5 + Math.floor((it && it.sell_price ? it.sell_price : 10) / 25);
  g = Math.max(5, Math.min(20, g));
  const { p } = pairOf(state, aUid, bUid);
  if (p.relation === 'confidant' || p.relation === 'partner') g *= 2;
  return g;
}

// ---------- DM 解锁（首次见面 / 送礼 / 同场景 10 分钟） ----------
export function dmUnlocked(state: WorldState, a: string, b: string): boolean {
  const { p } = pairOf(state, a, b);
  return p.dmUnlocked === true;
}

export function dmUnlock(state: WorldState, a: string, b: string): boolean {
  const { p } = pairOf(state, a, b);
  if (p.dmUnlocked) return false;
  p.dmUnlocked = true;
  state.schedulePersist();
  return true;
}

export function dmUnlockedList(state: WorldState, uid: string): Array<{ other: string; nick: string }> {
  const s = state.socialDataObj();
  const out: Array<{ other: string; nick: string }> = [];
  for (const [k, p] of Object.entries(s.pairs || {})) {
    if (!p.dmUnlocked) continue;
    const [a, b] = k.split('_');
    if (a !== uid && b !== uid) continue;
    const other = a === uid ? b : a;
    const onl = state.online.get(other);
    out.push({ other, nick: onl?.nick || p.dmNick || p.dmNickBy || other.slice(0, 8) });
  }
  return out;
}

/** 首次见面/送礼/自动解锁 DM 时统一记录双端 nick + 3s 节流系统广播 */
export function announceDmUnlock(state: WorldState, aUid: string, bUid: string, text: string): void {
  const { p } = pairOf(state, aUid, bUid);
  const na = state.online.get(aUid)?.nick || aUid.slice(0, 8);
  const nb = state.online.get(bUid)?.nick || bUid.slice(0, 8);
  p.dmNick = nb;
  p.dmNickBy = na;
  const meetKey = [aUid, bUid].sort().join('|');
  const nowMs = Date.now();
  if (nowMs - (state.lastMeetBroadcast.get(meetKey) || 0) >= 3000) {
    state.lastMeetBroadcast.set(meetKey, nowMs);
    sysChat(state, text);
  }
}

// ---------- 同场景共处跟踪 ----------
export function trackSceneTogether(state: WorldState, uid: string, scene: number): void {
  let m = state.sceneTogether.get(uid);
  if (!m) { m = new Map(); state.sceneTogether.set(uid, m); }
  for (const [peer, rec] of m) {
    if (rec.scene !== scene) m.set(peer, { scene, since: Date.now() });
  }
}

export function registerScenePeer(state: WorldState, uid: string, peerUid: string, scene: number): void {
  let m = state.sceneTogether.get(uid);
  if (!m) { m = new Map(); state.sceneTogether.set(uid, m); }
  if (!m.has(peerUid)) m.set(peerUid, { scene, since: Date.now() });
  let m2 = state.sceneTogether.get(peerUid);
  if (!m2) { m2 = new Map(); state.sceneTogether.set(peerUid, m2); }
  if (!m2.has(uid)) m2.set(uid, { scene, since: Date.now() });
}

export function dropScenePeer(state: WorldState, uid: string): void {
  state.sceneTogether.delete(uid);
  for (const [, m] of state.sceneTogether) m.delete(uid);
}

// 同场景在线 > 10 分钟自动解锁 DM
export function checkAutoDmUnlock(state: WorldState, agentSockets?: Map<string, Set<import('ws').WebSocket>>): void {
  const now = Date.now();
  for (const [uid, peerMap] of state.sceneTogether) {
    const myScene = state.online.get(uid)?.scene;
    if (myScene === undefined) continue;
    for (const [peer, rec] of peerMap) {
      if (state.online.get(peer)?.scene !== myScene) { peerMap.set(peer, { scene: myScene, since: now }); continue; }
      if (rec.scene !== myScene) { peerMap.set(peer, { scene: myScene, since: now }); continue; }
      if (now - rec.since >= DM_SCENE_COOLDOWN_MS) {
        const first = dmUnlock(state, uid, peer);
        if (first) {
          const na = state.online.get(uid)?.nick || uid.slice(0, 8);
          const nb = state.online.get(peer)?.nick || peer.slice(0, 8);
          announceDmUnlock(state, uid, peer, `🤝 ${na} 和 ${nb} 同村待够了，可以开始私聊了`);
          pushDmUnlockedLists(state, uid, peer, agentSockets);
          peerMap.delete(peer);
          const peerMap2 = state.sceneTogether.get(peer);
          if (peerMap2) peerMap2.delete(uid);
        }
      }
    }
  }
}

// 定期清理：lastMeetBroadcast 只保留最近 1000 条；sceneTogether 移除离线玩家空壳
export function cleanupDmMaps(state: WorldState): void {
  if (state.lastMeetBroadcast.size > 1000) {
    const sorted = [...state.lastMeetBroadcast.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < sorted.length - 1000; i++) state.lastMeetBroadcast.delete(sorted[i][0]);
  }
  for (const [uid, peerMap] of state.sceneTogether) {
    if (!state.online.has(uid)) { state.sceneTogether.delete(uid); for (const [, m] of state.sceneTogether) m.delete(uid); continue; }
    for (const [peer, rec] of peerMap) {
      if (!state.online.has(peer) || rec.scene !== state.online.get(peer)?.scene) peerMap.delete(peer);
    }
  }
}

// ---------- 目标解析（uid 或在线昵称） ----------
export function resolveOnlineUid(state: WorldState, nameOrUid: string): string | null {
  if (!nameOrUid) return null;
  if (state.online.has(nameOrUid)) return nameOrUid;
  for (const [k, o] of state.online) if (o.nick === nameOrUid) return k;
  return null;
}

/** agent 端 dm_send 允许离线目标：先查在线玩家，再查账号库 */
export function resolveAnyUid(state: WorldState, accounts: AccountStore, nameOrUid: string): string | null {
  const r = resolveOnlineUid(state, nameOrUid);
  if (r) return r;
  if (accounts.findAccountByUid(nameOrUid)) return nameOrUid;
  return null;
}

// 把 dm_unlocked_list 实时推给两个 uid 的玩家连接 + agent socket
export function pushDmUnlockedLists(state: WorldState, aUid: string, bUid: string, agentSockets?: Map<string, Set<import('ws').WebSocket>>): void {
  sendDmUnlockedTo(state, aUid, agentSockets);
  sendDmUnlockedTo(state, bUid, agentSockets);
}

function sendDmUnlockedTo(state: WorldState, uid: string, agentSockets?: Map<string, Set<import('ws').WebSocket>>): void {
  const p = state.online.get(uid);
  if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'dm_unlocked_list', peers: dmUnlockedList(state, uid) }));
  const ag = agentSockets?.get(uid);
  if (ag) for (const w of ag) if (w.readyState === 1) w.send(JSON.stringify({ t: 'dm_unlocked_list', peers: dmUnlockedList(state, uid) }));
}

// ---------- DM 日志持久化（data/dm-logs/{uidA}_{uidB}.json，cap 200 条，内存缓存） ----------
export class DmLogStore {
  private cache = new Map<string, { file: string; arr: DmEntry[] }>();
  private dataDir: string;
  constructor(dataDir: string) { this.dataDir = dataDir; }
  key(a: string, b: string): string { return [a, b].sort().join('_'); }
  private fileFor(k: string): string { return path.join(this.dataDir, 'dm-logs', k + '.json'); }
  path(a: string, b: string): string { return this.fileFor(this.key(a, b)); }
  logOf(a: string, b: string): { file: string; arr: DmEntry[] } {
    const key = this.key(a, b);
    let cached = this.cache.get(key);
    if (!cached) {
      const file = this.fileFor(key);
      let arr = loadJson(file, [] as unknown as DmEntry[]) as DmEntry[];
      if (!Array.isArray(arr)) arr = [];
      cached = { file, arr };
      this.cache.set(key, cached);
    }
    return cached;
  }
  push(a: string, b: string, entry: DmEntry): void {
    const { file, arr } = this.logOf(a, b);
    arr.push(entry);
    while (arr.length > 200) arr.shift();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(arr, null, 1));
  }
}
