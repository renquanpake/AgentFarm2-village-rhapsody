import { describe, it, expect } from 'vitest';
import type WebSocket from 'ws';
import { isCiJoin, mirrorToCiObs } from '../../src/gateway/ws.js';
import type { WorldState } from '../../src/persistence/state.js';

/** 假观察连接：只实现 readyState + send（够 mirrorToCiObs 用） */
function fakeWs(readyState = 1): { ws: WebSocket; sent: string[] } {
  const sent: string[] = [];
  const ws = { readyState, send: (raw: string) => { sent.push(raw); } } as unknown as WebSocket;
  return { ws, sent };
}

/** 只提供 ciObs 的最小 state 替身 */
function fakeState(): WorldState {
  return { ciObs: new Map<string, Set<WebSocket>>() } as unknown as WorldState;
}

describe('CI 旁路观察者：连接判定', () => {
  it('join 载荷 ci=1 判为 CI 连接', () => {
    expect(isCiJoin({ t: 'join', uid: 'u1', ci: 1 })).toBe(true);
  });

  it('升级 URL 带 is_ci_bot=true 判为 CI 连接（与载荷等价）', () => {
    expect(isCiJoin({ t: 'join', uid: 'u1' }, new URL('ws://127.0.0.1:8097/ws?is_ci_bot=true'))).toBe(true);
  });

  it('普通玩家连接不带标记', () => {
    expect(isCiJoin({ t: 'join', uid: 'u1' })).toBe(false);
    expect(isCiJoin({ t: 'join', uid: 'u1', ci: 0 })).toBe(false);
    expect(isCiJoin({ t: 'join', uid: 'u1' }, new URL('ws://127.0.0.1:8097/ws'))).toBe(false);
    expect(isCiJoin({ t: 'join', uid: 'u1' }, null)).toBe(false);
  });
});

describe('CI 旁路观察者：广播镜像', () => {
  it('同 uid 的观察连接收到 agent_move，未登记 uid 不收', () => {
    const state = fakeState();
    const mine = fakeWs();
    state.ciObs.set('u1', new Set([mine.ws]));

    mirrorToCiObs(state, 'u1', { t: 'agent_move', scene: 2, x: 33, y: 15 });
    mirrorToCiObs(state, 'u2', { t: 'agent_move', scene: 2, x: 1, y: 1 });

    expect(mine.sent.map(r => JSON.parse(r))).toEqual([{ t: 'agent_move', scene: 2, x: 33, y: 15 }]);
  });

  it('多个观察连接各收一份', () => {
    const state = fakeState();
    const a = fakeWs();
    const b = fakeWs();
    state.ciObs.set('u1', new Set([a.ws, b.ws]));

    mirrorToCiObs(state, 'u1', { t: 'agent_move_done', scene: 2, x: 5, y: 6 });

    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });

  it('未打开的连接（readyState!=1）跳过，空集合直返', () => {
    const state = fakeState();
    const closed = fakeWs(3);
    state.ciObs.set('u1', new Set([closed.ws]));
    state.ciObs.set('u2', new Set());

    mirrorToCiObs(state, 'u1', { t: 'agent_activity', activity: 'x' });
    mirrorToCiObs(state, 'u2', { t: 'agent_activity', activity: 'x' });

    expect(closed.sent).toHaveLength(0);
  });
});