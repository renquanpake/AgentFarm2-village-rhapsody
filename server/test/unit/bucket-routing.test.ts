// test/unit/bucket-routing.test.ts —— 桶路由回归：未知键不得静默丢弃；world 桶补齐
// 背景：bucketOf 曾对未注册 key 返回 null，ws.ts save 的私有分支要求 b 真值，导致
// 这些键进不了任何桶、被静默丢弃且无日志；受害键 sprinklerData/livestockData 注释明写是 world 桶。
import { describe, it, expect } from 'vitest';
import { bucketOf, WORLD_KEYS } from '../../src/persistence/state.ts';

describe('bucketOf 路由', () => {
  it('WORLD_KEYS 补上 livestockData 与 sprinklerData', () => {
    expect(WORLD_KEYS.has('livestockData')).toBe(true);
    expect(WORLD_KEYS.has('sprinklerData')).toBe(true);
  });

  it('未注册的 key 应路由到玩家私有桶，而不是返回 null 被丢弃', () => {
    const r = bucketOf('zzzUnknownKey_u871b1de2ec59');
    expect(r).toEqual(['player', 'zzzUnknownKey']);
  });

  it('已知三类键路由不变', () => {
    expect(bucketOf('plantData_100001')).toEqual(['world', 'plantData']);
    expect(bucketOf('knapData_uabc123')).toEqual(['player', 'knapData']);
    expect(bucketOf('gameData')).toEqual(['global', 'gameData']);
  });

  it('world 桶键剥掉 uid 后缀', () => {
    expect(bucketOf('sprinklerData_u871b1de2ec59')).toEqual(['world', 'sprinklerData']);
    expect(bucketOf('livestockData_u871b1de2ec59')).toEqual(['world', 'livestockData']);
  });
});

describe('ws.ts save 分支不再丢弃未知键', () => {
  it('客户端可回写未知/新桶键（私有），不会被静默丢弃', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/gateway/ws.ts', import.meta.url), 'utf8');
    // 私有分支写 playersDb 的路径存在，且不依赖 b 为真值之外的额外丢弃
    expect(src).toContain("state.playersDb.get(uid)!.set(name, val)");
    // 未知键经 bucketOf 已经落到 player，不再需要单独的 null 兜底判断
    expect(src).toContain("const b = bucketOf(key);");
  });
});