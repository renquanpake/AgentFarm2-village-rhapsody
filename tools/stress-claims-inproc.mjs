#!/usr/bin/env node
// tools/stress-claims.mjs —— 联机村 C 包抢占原子化并发压力测试 (100 并发抢 1 树)
// 验证：100 个主体在同一 tick / 微任务并发争抢同一资源，恰好 1 个胜出，99 个被拒，零锁死

import { tryClaim, release, holderOf, claimsOf } from '../server/src/world/claims.ts';
import { WorldState } from '../server/src/persistence/state.ts';

const CONCURRENCY = 100;
const RESOURCE_KEY = 'tree@village_center_pine';

console.log(`[stress-claims] 开始运行资源抢占高并发压力测试 (并发量: ${CONCURRENCY})...`);

const ws = new WorldState({
  savesDir: '/tmp/af-stress-claims',
  seedFile: '/tmp/af-stress-claims/seed.json',
  slot: 1,
  farmLeft: 0,
  spawns: null,
  growDayMs: 24 * 3600 * 1000,
  init: false,
  noPersist: true,
});

// 并发 100 个不同玩家 uid 同时发出抢占
const now = Date.now();
const players = Array.from({ length: CONCURRENCY }, (_, i) => `player_${String(i).padStart(3, '0')}`);

let winners = 0;
let losers = 0;
let winnerUid = null;

// 使用 Promise.all 模拟高并发交织调用
await Promise.all(
  players.map(async (uid) => {
    // 制造微小的随机事件微任务时序扰动
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    const res = tryClaim(ws, uid, 'tree', RESOURCE_KEY, now);
    if (res.ok && res.fresh) {
      winners++;
      winnerUid = uid;
    } else {
      losers++;
      if (res.holder !== winnerUid && !res.holder) {
        throw new Error(`[stress-claims] 错误：拒绝结果未附带有效占用者，uid=${uid}`);
      }
    }
  })
);

console.log(`[stress-claims] 第一轮抢占结束: 胜出者=${winnerUid}, 胜出数=${winners}, 被拒数=${losers}`);

if (winners !== 1 || losers !== CONCURRENCY - 1) {
  console.error(`❌ [stress-claims] 失败：并发裁决非原子化！预期胜出 1，实际胜出 ${winners}`);
  process.exit(1);
}

const currentHolder = holderOf(ws, 'tree', RESOURCE_KEY);
if (currentHolder !== winnerUid) {
  console.error(`❌ [stress-claims] 失败：资源记录持有者与胜出者不符！当前持有者: ${currentHolder}`);
  process.exit(1);
}

// 释放资源测试
const released = release(ws, winnerUid, 'tree', RESOURCE_KEY);
if (!released || holderOf(ws, 'tree', RESOURCE_KEY) !== null) {
  console.error(`❌ [stress-claims] 失败：释放资源未生效！`);
  process.exit(1);
}

console.log(`[stress-claims] 第二轮释放后复测...`);
// 释放后再次争抢，验证状态已重置
const secondWinner = tryClaim(ws, 'player_second_round', 'tree', RESOURCE_KEY, now + 1000);
if (!secondWinner.ok || !secondWinner.fresh) {
  console.error(`❌ [stress-claims] 失败：释放后无法再次抢占！`);
  process.exit(1);
}

console.log(`✅ [stress-claims] 100 并发抢占原子化压力测试全部通过 (CONSISTENT)！`);
process.exit(0);
