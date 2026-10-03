// test/unit/save-guard.test.ts —— D17 客户端直写防护
// 事故：save 可整体覆写玩家私有桶（knapData 金币/物品、attributeData 技能、buffData、
// playerData 位置）→ 改版客户端一次 save 铸币/满技能；bucketOf 对未注册 key 默认落
// 玩家私有桶 → 客户端可自造任意新 key 写进存档。
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { bucketOf } from '../../src/persistence/state.ts';
import {
  guardSaveKey, saveGuardStats, resetSaveGuardStats,
  SERVER_OWNED_WORLD_KEYS, SERVER_OWNED_PLAYER_KEYS, CLIENT_OWNED_PLAYER_KEYS, DEFAULT_LIMITS,
} from '../../src/world/save-guard.ts';

const knap = (props: Array<[number, number]>) => ({ props: props.map(([id, num]) => ({ id, num })) });

beforeEach(() => resetSaveGuardStats());

describe('服务端专属桶拒写', () => {
  it('服务端世界桶（抢占/租约/委托/公告/八卦/摊位/体能/设施/社交）拒写', () => {
    for (const k of ['claimsData', 'leaseData', 'delegatedData', 'noticeData', 'gossipData', 'afStalls', 'fitnessData', 'staminaData', 'facilityData', 'socialData']) {
      expect(SERVER_OWNED_WORLD_KEYS.has(k)).toBe(true);
      const v = guardSaveKey(k, 'world', { hacked: true }, {});
      expect(v.allow).toBe(false);
      expect(v.reason).toBe('server-owned-world');
    }
  });

  it('服务端玩家桶（任务书/成长/仓库）拒写', () => {
    for (const k of SERVER_OWNED_PLAYER_KEYS) {
      const v = guardSaveKey(k, 'player', { props: [] }, undefined);
      expect(v.allow).toBe(false);
      expect(v.reason).toBe('server-owned-player');
    }
  });

  it('客户端自有键放行（playerData/taskData/achvData/settingData/knapData）', () => {
    for (const k of CLIENT_OWNED_PLAYER_KEYS) {
      expect(guardSaveKey(k, 'player', k === 'knapData' ? knap([[1, 100]]) : { x: 1 }, k === 'knapData' ? knap([[1, 100]]) : undefined).allow).toBe(true);
    }
  });
});

describe('背包/金币幅度封顶（防一次 save 铸币）', () => {
  it('金币净增超上限 -> 回落服务端现值并标注', () => {
    const v = guardSaveKey('knapData', 'player', knap([[1, 100_000]]), knap([[1, 500]]));
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('gold-step');
    expect((v.value as { props: Array<{ id: number; num: number }> }).props[0].num).toBe(500);
  });

  it('金币净减不拦（玩家花钱/买东西照常）', () => {
    const v = guardSaveKey('knapData', 'player', knap([[1, 100]]), knap([[1, 5000]]));
    expect(v.allow).toBe(true);
    expect((v.value as { props: Array<{ num: number }> }).props[0].num).toBe(100);
  });

  it('普通物品净增超上限 -> 逐项回落，合法项保留', () => {
    const v = guardSaveKey('knapData', 'player', knap([[1, 600], [5, 3], [9, 9999]]), knap([[1, 100], [5, 1]]));
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('item-step');
    const m = new Map((v.value as { props: Array<{ id: number; num: number }> }).props.map(p => [p.id, p.num]));
    expect(m.get(1)).toBe(600);   // 金币 +500 = 上限内
    expect(m.get(5)).toBe(3);     // 物品 +2 = 上限内
    expect(m.get(9)).toBe(0);     // 凭空 +9999 -> 0
  });

  it('客户端没带的道具保留服务端值（不被整体清空背包）', () => {
    const v = guardSaveKey('knapData', 'player', knap([[1, 100]]), knap([[1, 100], [7, 42]]));
    expect(v.allow).toBe(true);
    const m = new Map((v.value as { props: Array<{ id: number; num: number }> }).props.map(p => [p.id, p.num]));
    expect(m.get(7)).toBe(42);
  });

  it('边界：正好等于上限放行，超一即拒', () => {
    const lim = { ...DEFAULT_LIMITS, goldStep: 10, itemStep: 2 };
    expect(guardSaveKey('knapData', 'player', knap([[1, 110]]), knap([[1, 100]]), lim).allow).toBe(true);
    expect(guardSaveKey('knapData', 'player', knap([[1, 111]]), knap([[1, 100]]), lim).allow).toBe(false);
  });

  it('非法数值不入账（NaN/负数道具数被夹住）', () => {
    const v = guardSaveKey('knapData', 'player', { props: [{ id: 3, num: -5 }, { id: 4, num: 'x' }] }, knap([[1, 0]]));
    const m = new Map((v.value as { props: Array<{ id: number; num: number }> }).props.map(p => [p.id, p.num]));
    expect(m.get(3)).toBe(0);
  });
});

describe('字段白名单与观测', () => {
  it('未注册键拒写（杜绝客户端自造 key）', () => {
    const v = guardSaveKey('zzzSelfMadeKey', 'player', { coins: 1e9 }, undefined);
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('unknown-key');
  });

  it('uid 含下划线时 bucketOf 切错名字 -> 护栏仍拒写（防绕过）', () => {
    // bucketOf 用 lastIndexOf('_') 切名：`settingData_u_test_a` 会被切成 `settingData_u_test`，
    // 白名单查不到即拒写 —— 方向是安全的（拒 > 误放），生产 uid 为 hex 不含下划线
    const b = bucketOf('settingData_u_test_a');
    expect(b[1]).toBe('settingData_u_test');
    const v = guardSaveKey(b[1], b[0], { hello: 1 }, undefined);
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('unknown-key');
  });

  it('超大值拒写', () => {
    const big = { blob: 'x'.repeat(600 * 1024) };
    const v = guardSaveKey('taskData', 'player', big, undefined);
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('oversized');
  });

  it('AF_TRUST_CLIENT_SAVE=1 逃生阀全放行（单机调试）', () => {
    const v = guardSaveKey('zzzSelfMadeKey', 'player', { any: 1 }, undefined, DEFAULT_LIMITS, { AF_TRUST_CLIENT_SAVE: '1' });
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('trusted-mode');
  });

  it('计数按拒写原因分类，供 /af/replay-status 观测', () => {
    guardSaveKey('claimsData', 'world', {}, {});
    guardSaveKey('attributeData', 'player', {}, undefined);
    guardSaveKey('zzzSelfMadeKey', 'player', {}, undefined);
    const s = saveGuardStats();
    expect(s.checked).toBe(3);
    expect(s.rejected).toBe(3);
    expect(s.byReason['server-owned-world']).toBe(1);
    expect(s.byReason['server-owned-player']).toBe(1);
    expect(s.byReason['unknown-key']).toBe(1);
  });

  it('ws.ts save 分支确实走护栏（源码级锁定，防旁路）', () => {
    const src = readFileSync(new URL('../../src/gateway/ws.ts', import.meta.url), 'utf8');
    expect(src).toContain('guardSaveKey(');
    expect(src).toContain('app.log.append(\'save.guarded\'');
  });
});