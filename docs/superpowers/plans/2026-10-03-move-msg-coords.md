move_to 失败点名坐标与邻接可站环预检 Implementation Plan（批1 之 move_to 点名坐标）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「有障碍的坐标一定要全」落到指令回路：move_to 失败必点名阻挡来源坐标，目标格动作执行前校验邻接可站环并给出建议站立格。

**Architecture:** 纯函数内核 `server/src/navigation/reloc.ts`（可站环搜索/阻挡定性/文案装配），vitest 锁死；`gateway/ws.ts` 六处目标格动作与 move_to 失败分支改为调用内核装配 msg。文案只增不改语义，`离目标太远` 等既有断言（tools/e2e-agent-msg-hud.mjs L135）保持兼容。

**Tech Stack:** Node 22 + TS、vitest。

**Spec:** docs/长期工作规划书.md §1.0 项 2-3（全文最高优先级基线 §0）。

## Global Constraints

- 文案点名具体格坐标（含来源定性：水面/建筑/边界）——配合 hpath 交互环吸附
- 距离>180 格仍拒（维持现状），拒绝文案给「换近目标」建议坐标
- 不动原版壳、nav 数据文件（工具链产物口径）
- 每任务 tsc 0 错 + `npx vitest run` 全绿 + `node tools/nav-audit.mjs --check` 绿后再 commit
- commit 前 security-check

## Review Focus

1. 目标格动作的「不可达」误报：当前 `Math.abs(gx-px)>1` 只看距离，不看目标格本身是否站得下（如水面格浇地）——预检须区分距离错 vs 目标错。
2. move_to 假想可达但路径被建筑实体围死（nav 更新但 rect 后补）——点名格要来自 nav.kind 真值。
3. near=water/npc 60 格环搜失败文案已有坐标，缺「最近的替代水边格」——给建议时不能退化成长文案。
4. 目标格恰在跨场景门位格——建议站立格不得指向另一场景。
5. 老账号 agent 集成脚本可能解析旧文案关键词（「离目标太远」），新文案保留旧短语前缀。

---

### Task 1: reloc.ts 纯函数内核

**Files:**
- Create: `server/src/navigation/reloc.ts`
- Test: `server/test/unit/reloc.test.ts`

**Interfaces:**
- Produces（Task 2/3 精确消费）：
  - `export type CellKind = 'open' | 'block' | 'water' | 'tree' | 'out'`
  - `export function cellKindOf(nav: NavGrid, gx: number, gy: number): CellKind`（nav.kind 1→block、2→water、3→tree、越界→out、其余→open）
  - `export function stdRingOf(nav: NavGrid, gx: number, gy: number, maxR?: number): Array<[number, number]>`（8 邻可站立格列表，r=1 起方形环升序，最多 maxR 环；可走口径 `nav.blocked!==1 && nav.cost>0`）
  - `export function bestStandCell(nav: NavGrid, gx: number, gy: number, from: [number, number], maxR?: number): [number, number] | null`（stdRingOf 内距 from 切比雪夫最近者）
  - `export function targetUnreachableMsg(cell: [number, number], kind: CellKind, alt: [number, number] | null): string`（装配：`(65,54) 为建筑阻挡，建议绕行；可先 move_to {x:..,y:..}`；alt 为 null 时省略建议段）
  - `export function moveFailMsg(s: [number, number], goal: [number, number], navA: NavGrid | null, navB: NavGrid | null): string`（起点/目标点名 + 目标格 kind；跨场景 navB 判目标场景落格）
- Consumes: `NavGrid`（navgen.ts:13-18）。

- [ ] Step 1: 写失败测试（5 例：cellKindOf 五类；stdRingOf 环序与 maxR；bestStandCell 距离 tie-break；两 msg 装配含坐标与 kind 词）。
- [ ] Step 2: `cd server && npx vitest run test/unit/reloc.test.ts` Expected: FAIL。
- [ ] Step 3: 实现 reloc.ts。
- [ ] Step 4: `npx vitest run test/unit/reloc.test.ts` Expected: PASS；`npx tsc --noEmit` 0 错。
- [ ] Step 5: commit `feat(nav): reloc 纯函数内核（目标格定性/可站环/点名文案装配）`。

### Task 2: move_to 失败分支接入点名文案

**Files:**
- Modify: `server/src/gateway/ws.ts:1075`（同场景 A* 失败 → `moveFailMsg`）、`:1147`（跨场景失败）、`:1064`（60 格环搜失败附 bestStandCell 建议）、`:1026` `targetScene 30500 无门` 类路径保持。
- Test: ws 层不写单测——由 `tools/e2e-agent-msg-hud.mjs` 增 2 断言锁定。

**Interfaces:**
- Consumes: Task 1 `moveFailMsg`、`targetUnreachableMsg`、`bestStandCell`、`cellKindOf`。
- Produces: result.msg 契约（e2e 用）：move_to 不可达 → 含 `(gx,gy)` + kind 词（水面|建筑|边界）。

- [ ] Step 1: e2e `D:\agent-farm\tools\e2e-agent-msg-hud.mjs` move_to 小节增加两断言：目标=建筑格（如交易大厅腹地 (51,46)）失败 msg 匹配 `/建筑|(5\d),(46)/`；目标不可达文案含「建议」站立格。Expected: FAIL。
- [ ] Step 2: 改 4 处失败装配（保留原句主干，追加坐标段）。
- [ ] Step 3: 起隔离实例重跑 e2e 断言。Expected: PASS。
- [ ] Step 4: `npx tsc --noEmit` + vitest 全绿 + `node tools/nav-audit.mjs --check`。
- [ ] Step 5: commit `feat(ws): move_to 失败点名阻挡坐标与建议站立格`。

### Task 3: 目标格动作邻接可站环预检（六处）

**Files:**
- Modify: `server/src/gateway/ws.ts:1278 / :1294 / :1317 / :1336 / :1362 / :1435`（浇/种/收/plant/采矿/fish 等 `gx,gy` 与 `px,py` 判定位）——在距离判定之前插入 `stdRingOf(nav,gx,gy,0)` 判目标格自身可站且 8 邻环非空；`farm.ts L41 / :72 / :95 / :114` 水格判定口径不改。
- Test: `server/test/unit/reloc.test.ts` 追加装配函数 `actionPrecheck(nav, goal, from): {ok:true}|{ok:false,reason:'target-blocked'|'no-stand'|'far', msg}` 放 reloc.ts（含全部三 reason 文案），vitest 锁。

- [ ] Step 1: reloc.ts 加 `actionPrecheck`（先红：单测 3 reason + 兼容「离目标太远」前缀保留）。
- [ ] Step 2: 实现 actionPrecheck。Expected: PASS。
- [ ] Step 3: ws.ts 六处统一替换为 `actionPrecheck`（farm 水/土判定在其后，语义不回归）。
- [ ] Step 4: 全门禁：tsc、vitest run、e2e-agent-msg-hud（含旧断言不回归）、nav-audit --check。
- [ ] Step 5: commit `fix(ws): 目标格动作前置邻接可站环预检（杜绝离目标太远式死胡同）`。

---

**批1c 收口回归清单**：`npx vitest run`；`cd server && npx tsc --noEmit`；`node tools/nav-audit.mjs --check`；e2e `agent-msg-hud/agent-commands/agent-travel`；`node tools/build-scene-collisions.mjs --check`；security-check。
