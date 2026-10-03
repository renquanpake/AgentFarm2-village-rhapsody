# Agent 小人画面可视化修复 Implementation Plan（批1b）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/agent` 的 move/move_to/非移动动作在玩家画面实时可见：任意时机开画面 2s 内对齐 agentPos、走路状态机失败兜底插值、动作行为飘字、验收工具三段断言进门禁。

**Architecture:** 全部在 `client/mod/agentfarm.js`（不动原版壳）。活体断言工具先行（RED=现功能缺 + 新 API 不存在即 TypeError 红），再逐任务修复转 GREEN。测试钩子 `window.__AF_TEST__` 仅当 `localStorage.af.test==='1'` 注册（不进生产路径、文本无障碍审计不受影响）。

**Tech Stack:** 原版 Cocos 壳 + mod；puppeteer（AF_CHROME）；agent WS `/agent?token=` + 游戏 WS `/ws`。

**Spec:** `docs/长期工作规划书.md` §1.1/§1.2（P1.1-P1.5）。

## Global Constraints

- 不触碰 `client/assets/**`；壳哈希 5140 不变
- ui-lint 红线：裸色值 0、af-* 点击 100% `AFUNI.on`、常驻 DOM ≤ RESIDENT_NODES
- 验收必须 `page.setCacheEnabled(false)`（已内置于 shot-session 模式）
- 服务端实例：隔离 slot 起服 `PORT<待用> AF_SLOT=99 AF_NO_TUNNEL=1 AF_NO_GIT=1 AF_DEV_ENDPOINTS=0 AF_ADMIN_TOKEN=<local>` + `bash tools/ci-seed-datadir.sh`（若用 AF_DATA_DIR）
- 每 commit 前 security-check

## File Structure

- Create: `tools/agent-vis-assert.mjs`（活体断言：dir 步随/动作飘字/NONODE 黑洞重放/终点收敛/面板文案 5 场景）
- Modify: `client/mod/agentfarm.js`（resolvePlayerNode 冗余链 + pending 重放 L906-960 区；插值兜底；行为飘字；`__AF_TEST__` 钩子）

## Review Focus

1. 客户端树/原版碰撞挡路 vs 服务端放行（批1a 门控后残余错位）——插值兜底以服务端权威坐标收敛。
2. 跨场景 `agent_move.scene!==myScene` 走 changeSceneEasy 分支，重放必须等场景就绪（轮询上限 20s）。
3. posTimer 200ms 与插值 tween 竞态：重放只应用「最新一条」，插值目标以最新为准。
4. hostedAgentOnline 让位逻辑不被重放队列破坏（本地输入抑制仍由 agent_status 驱动）。
5. `__AF_TEST__` 泄漏风险：无 af.test 旗时必须完全不定义。

---

### Task 1: 活体断言工具 agent-vis-assert.mjs（RED）

**Files:**
- Create: `tools/agent-vis-assert.mjs`

**Interfaces:**
- Consumes: shot-session 的注册/铸 token/localStorage 注入模式（L37-67）；dbg-agent-vis 的 agent WS act 帧。
- Produces: `node tools/agent-vis-assert.mjs --base <url> [--out /tmp/af-vis]`，exit 1 于任何 FAIL，report.json 每场景 pass/expected/actual。
- 页面侧约定（Task 2-4 将实现）：`localStorage.af.test==='1'` 时 `window.__AF_TEST__ = { node(): {x,y,scene}|null, serverPos(): {x,y,scene}|null（最近 agent_move 载荷）, blackhole(n): 丢弃后 n 条 agent_move, floatCount(): 行为飘字计数器 }`；飘字实现需自增计数。

场景：
- A dir 步随：agent `act move dir` ×6（沿路可走方向），断言 `|Δnode| == |Δserver|`（±40px 每步）且最终 `dist(node, serverPos) ≤ 440px` 漂移内（现 changeDir 慢速状态机容差）；**终点对齐由 C 场景兜**。
- B 行为飘字：先 `move_to` 到可砍树（读 observe obstacles），`act chop {x,y}` → `floatCount()` ≥ 1。
- C NONODE 黑洞重放：`blackhole(3)` → `act move {x,y}`（服务端 3 步）→ 400ms 内解除模拟并等 ≤2.5s，断言 node 与服务端最新格一致（±40px）。**现无 `__AF_TEST__` → TypeError 即 RED。**
- D move_to 终点对齐：`act move_to {x,y}` → 等 `done`/超时 20s → node dist ≤40px。
- E 面板文案：`act chop` 后 `#af-agent-live-t` / `#af-hud-agent` 文本含「砍/正在」。

- [ ] Step 1: 写工具（~200 行，puppeteer 生命周期复用 shot-session 常量表）。
- [ ] Step 2: 起隔离实例（AF_SLOT=99），跑工具 → Expected: **FAIL**（C/D TypeError、B floatCount=0、A 可能绿、E 现有 chip 或绿），留 report 证据进 ledger。
- [ ] Step 3: commit（仅工具）`test(client): agent-vis-assert 画面可视化五场景活体断言（RED 基线）`。

### Task 2: 节点冗余链 + 最新态重放队列（P1.1）

**Files:**
- Modify: `client/mod/agentfarm.js:633-680,906-960`

**Produces:**
- `resolvePlayerNode()`：链 `Application.getIns().playerNode` → `PlayerMoudle` `_gPlayer.node` → `cc.director.getScene().walk` 名含 'Player' 首个 active 节点；每调校验 `.valid`。
- `applyAgentMoveMsg(node, item, msg)`（现 onAgentMove 主体拆出，scene!==myScene 仍走 changeSceneEasy 原路）。
- pending 重放：`agentPending={msg,at}` 模块变量；onAgentMove 拿不到节点→存最新（覆盖式，不排旧帧）；posTimer tick 尝试 flush（节点有效 + msg.scene===myScene）；超 20s 丢弃并 console.warn `[af-visual] dropped agent_move`。onAgentMoveDone 同款 pending。
- `__AF_TEST__`（af.test==='1' 才定义）：node/serverPos/floatCount/blackhole(n 设置黑洞计数,agent_move 直接进 pending)。

- [ ] Step 1: 写实现；Step 2: `node --check client/mod/agentfarm.js`；Step 3: 跑 agent-vis-assert：Expected: A 绿、C GREEN（黑洞后 2s 内对齐）。B/D/E 允许仍红。Step 4: ui-lint + 壳哈希不变；commit `fix(client): agent_move 节点冗余获取链与最新态重放队列（P1.1）`。

### Task 3: changeDir 失败兜底插值 + done 终点收敛（P1.2）

**Files:**
- Modify: `agentfarm.js` applyAgentMoveMsg / onAgentMoveDone

- [ ] Step 1: 实现：apply 后 350ms 采样 `node.getPosition()`，位移 <2px 判定接管失败 → cc.tween 150ms `setPosition` 到 msg 坐标（同场景才插值）；onAgentMoveDone 无条件 tween 收敛到 msg.x/ y。插值期间收到新 agent_move 则中止旧 tween。
- [ ] Step 2: agent-vis-assert Expected: D 绿（终点对齐）、A 仍绿。commit `fix(client): 走路状态机接管失败兜底插值与终点收敛（P1.2）`。

### Task 4: 行为飘字层（P1.3）

**Files:**
- Modify: `agentfarm.js:599-606` agent_activity 分支 + 新 `spawnAgentFloatText(text)`

- [ ] Step 1: 实现：cc.Node+cc.Label 挂玩家节点 (0,90)，1600ms 淡出销毁；文案直用 activity 原文；`__AF_TEST__.floatCount` 自增；同帧同文去重。
- [ ] Step 2: 跑工具：Expected: B 绿 + E 绿；页面 error 0。commit `feat(client): agent 动作头顶行为飘字层（P1.3）`。

### Task 5: 面板实时快照核对（P1.4）+ 全门禁

- [ ] Step 1: 断言 E（面板文案=最近 agent 日志）：`GET /af/agent-log` 最近一条动作 label（agent-log.ts ACTION_LABELS）与 `#af-agent-live-t`/hud 文本同行动词；不符则映射表修正。
- [ ] Step 2: 回归：agent-vis-assert A-E 全绿；ui-smoke 17 项；ui-lint；`hash-manifest --check`；shot-session 原流程冒烟；security-check；commit（如需）`fix(client): 指挥面板 agent 实时快照与日志同词（P1.4）`。
