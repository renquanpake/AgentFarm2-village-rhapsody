// test/unit/agent-dialogue.test.ts —— 玩家 ↔ Agent 对话闭环（"他刚才干了什么"）
// 事故背景：①玩家 agent_msg 进的是 Agent 自己的 inbox，Agent 想回话只能 dm_send，
// 而 dm_send 到自己账号被 target===uid 直接拒 —— 玩家永远看不到回答；
// ②「刚才干了什么」只能靠 LLM 自己的日记，可能没写/写错 = 编造。
// 现在：行为流水（事实源）+ act reply（回程通道）+ agent_msg_ack（诚实回执）。
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldState } from '../../src/persistence/state.ts';
import { recordAgentOp, opsOf, recapLines, recapView, actionCn, clearAgentOps, recapText } from '../../src/world/agent-log.ts';
import { pushAgentMail, agentMailOf, pushAsk, asksOf } from '../../src/world/agent-mail.ts';

const NOW = 1_800_000_000_000;
function state(): WorldState {
  const dir = mkdtempSync(join(tmpdir(), 'af-dlg-'));
  const s = new WorldState({ savesDir: dir, seedFile: '', slot: 92, farmLeft: 0, spawns: null, growDayMs: 600000 });
  s.playersDb.set('u1', new Map<string, unknown>([['playerData', { uID: 'u1', day: 3 }]]));
  return s;
}

describe('行为流水（事实源）', () => {
  it('记录成功与失败动作，含结果摘要', () => {
    const s = state();
    recordAgentOp(s, 'u1', { day: 3, action: 'fish', ok: true, detail: '钓到一条鲈鱼！', ts: NOW - 60_000 });
    recordAgentOp(s, 'u1', { day: 3, action: 'mine', ok: false, detail: '附近没有矿山', ts: NOW - 30_000 });
    const ops = opsOf(s, 'u1', 10);
    expect(ops.length).toBe(2);
    expect(ops[0].action).toBe('mine');       // 倒序，最新在前
    expect(ops[0].ok).toBe(false);
    expect(ops[1].detail).toContain('鲈鱼');
  });

  it('流水文本带相对时间 + 中文动作名 + 失败标记', () => {
    const s = state();
    recordAgentOp(s, 'u1', { day: 3, action: 'plant', ok: true, detail: '种下了小麦', ts: NOW - 5 * 60_000 });
    recordAgentOp(s, 'u1', { day: 3, action: 'chop', ok: false, detail: '这个格子上没有树', ts: NOW - 30_000 });
    const lines = recapLines(s, 'u1', 10, NOW);
    expect(lines[0]).toContain('砍树（未成）');
    expect(lines[0]).toContain('这个格子上没有树');
    expect(lines[1]).toContain('5 分钟前');
    expect(lines[1]).toContain('播种：种下了小麦');
  });

  it('视图给出 total/lines/note，且可清空', () => {
    const s = state();
    expect(recapView(s, 'u1')).toBeNull();
    for (let i = 0; i < 3; i++) recordAgentOp(s, 'u1', { day: 3, action: 'move', ok: true, detail: '走了', ts: NOW - i * 1000 });
    const v = recapView(s, 'u1', 10, NOW)!;
    expect(v.total).toBe(3);
    expect(v.lines.length).toBe(3);
    expect(v.note).toContain('agentLogData');
    expect(recapText(s, 'u1', 3, NOW)).toContain('移动');
    clearAgentOps(s, 'u1');
    expect(recapView(s, 'u1')).toBeNull();
  });

  it('环形上限：超量只保留最近 n 条', () => {
    const s = state();
    // ts 随 i 递增（#0 最早、#29 最新），环形裁剪后 opsOf 倒序返回最新的 #29
    for (let i = 0; i < 30; i++) recordAgentOp(s, 'u1', { day: 1, action: 'move', ok: true, detail: `#${i}`, ts: NOW - (29 - i) * 1000 }, 10);
    const ops = opsOf(s, 'u1', 50);
    expect(ops.length).toBe(10);
    expect(ops[0].detail).toBe('#29');  // 最新在前
  });

  it('动作中文名覆盖 act 全表的关键项（文案即契约）', () => {
    for (const a of ['move_to', 'fish', 'mine', 'chop', 'harvest', 'plant', 'water', 'till', 'buy', 'trade', 'tasks', 'recap', 'reply']) {
      expect(actionCn(a)).not.toBe(a);
    }
  });

  it('不同账号的流水互不干扰', () => {
    const s = state();
    s.playersDb.set('u2', new Map<string, unknown>());
    recordAgentOp(s, 'u1', { day: 1, action: 'fish', ok: true, detail: 'a', ts: NOW });
    recordAgentOp(s, 'u2', { day: 1, action: 'chop', ok: true, detail: 'b', ts: NOW });
    expect(opsOf(s, 'u1', 5).map(o => o.action)).toEqual(['fish']);
    expect(opsOf(s, 'u2', 5).map(o => o.action)).toEqual(['chop']);
  });
});

describe('对话回程通道', () => {
  it('Agent 回话写入信箱并带上主人原话', () => {
    const s = state();
    const ask = pushAsk(s, 'u1', '你刚才干了什么？');
    expect(ask.text).toContain('干了什么');
    const mail = pushAgentMail(s, 'u1', 'agent', '我刚钓了一条鲈鱼，然后去挖矿但没找到矿山。', ask.text);
    expect(mail.replyTo).toBe('你刚才干了什么？');
    const list = agentMailOf(s, 'u1', 5);
    expect(list.length).toBe(1);
    expect(list[0].text).toContain('鲈鱼');
    expect(asksOf(s, 'u1').length).toBe(1);
  });

  it('信箱环形上限 50，最新在前', () => {
    const s = state();
    for (let i = 0; i < 55; i++) pushAgentMail(s, 'u1', 'agent', `msg${i}`);
    const list = agentMailOf(s, 'u1', 50);
    expect(list.length).toBe(50);
    expect(list[0].text).toBe('msg54');
  });

  it('回话是玩家私有桶里的服务端权威数据（客户端不可写）', async () => {
    const { SERVER_OWNED_PLAYER_KEYS } = await import('../../src/world/save-guard.ts');
    const { PLAYER_KEYS: PK } = await import('../../src/persistence/state.ts');
    expect(PK.has('afAgentMail')).toBe(true);
    expect(PK.has('afAgentAsk')).toBe(true);
    expect(SERVER_OWNED_PLAYER_KEYS.has('afAgentMail')).toBe(true);
    expect(SERVER_OWNED_PLAYER_KEYS.has('afAgentAsk')).toBe(true);
  });

  it('提问留痕可读（Agent 侧 observe.ownerAsks 的来源）', () => {
    const s = state();
    pushAsk(s, 'u1', '你在干嘛');
    pushAsk(s, 'u1', '你刚才干了什么');
    const asks = asksOf(s, 'u1');
    expect(asks.length).toBe(2);
    expect(asks[1].text).toContain('刚才');
  });
});

describe('接线（源码级锁定，防旁路）', () => {
  it('ws.ts：act 出口写流水、reply 推玩家、agent_msg 有回执', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/gateway/ws.ts', import.meta.url), 'utf8');
    expect(src).toContain('recordAgentOp(state, uid, {');
    expect(src).toContain("t: 'agent_reply'");
    expect(src).toContain("t: 'agent_msg_ack'");
    expect(src).toContain('pushAsk(state, uid!, text)');
    // 查询类动作不得污染流水
    expect(src).toContain("const SILENT_OPS = new Set(['recap'");
  });

  it('agent-log 世界桶已登记（门11 会拦）', async () => {
    const { WORLD_KEYS } = await import('../../src/persistence/state.ts');
    expect(WORLD_KEYS.has('agentLogData')).toBe(true);
  });

  it('game-agent 提示词含「先读流水再回话」铁律与三个工具', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../../tools/game-agent.mjs', import.meta.url), 'utf8');
    expect(src).toContain('主人提问必须回答');
    expect(src).toContain('TOOL:game_recap');
    expect(src).toContain('TOOL:game_reply');
    expect(src).toContain("case 'game_reply'");
  });

  it('客户端 mod 能显示回话与读取流水', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../../client/mod/agentfarm.js', import.meta.url), 'utf8');
    expect(src).toContain("case 'agent_reply'");
    expect(src).toContain('/af/agent-recap?token=');
    expect(src).toContain('af-agent-recap-btn');
  });
});