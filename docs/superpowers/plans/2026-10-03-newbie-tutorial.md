# 新玩家视角新手教程 Implementation Plan（批2 之 P4 教程）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 人类玩家第一次开画面 5 分钟内完成 7 步引导（移动→任务书→种收→对话→托管 Agent→委托），全程不依赖弹窗轰炸。

**Architecture:** 服务端权威进度：玩家私有桶 `afTutorial`（登记进 `server/src/data/save-keys.ts`，门11 强制）+ `act tutorial_done {step}` 经 agent 通道；数据 `data/tutorial.json`（7 步：id/title/hint/验收动作断言）。客户端现有 `injectOnboarding` 升级为逐步引导条（右侧常驻步骤卡片，非遮罩阻断，可跳过/重放），完成信号走既有 `/af/local` 存档推送防抖。

**Tech Stack:** Cocos 原版壳（不动）+ 客户端 mod 层 + 服务端 TS。

**Spec:** `docs/长期工作规划书.md` P4；设计基线 §0（第 6 步「小人在动」即 P1 成果展示）。

## Global Constraints

- 新私有桶必须登记 `WORLD_KEYS/WORLD_REJECT_CLIENT` 口径正确（tutorialProgress 属玩家私有：`afTutorial`——服务端可写、客户端可推（非拒绝清单））；漏登记=门11 判死
- `act` 表 20 种之外不新增动作（tutorial 复用 act 事件计数模式：每步断言=已完成的其他 act）
- 弹窗纪律：同屏 toast ≤1、引导卡片可永久关闭，老账号（有存档位玩家）默认已完成不再弹
- 客户端不新增硬编码数值/名称——全部读 `/af/tutorial`（新公开 GET）
- 每 commit 前 `node tools/security-check.mjs` PASS

## Review Focus

1. 幽灵桶：`afTutorial` 键名若与既有键冲突或漏登记，重启丢进度（历史教训 slot94）。
2. 老账号升级：首次加载 `/world` 带 `af.tutorial.done` 本地标记 vs 服务端权威冲突时的取舍。
3. 托管 Agent 步骤离线：`GET /af/agent-status` 不可用（AF_NO_MANAGED 或 LLM 未配）时第 6 步必须可跳过而非卡死。
4. 步骤验收竞态：玩家在引导中移动导致坐标断言抖动——验收只查「本步内完成记录」，不查瞬时态。
5. 文本无障碍面：`data/tutorial.json` 与引导文案进 surface-audit 新面 + eval-textonly，否则门10 判死。

---

### Task 1: 教程数据表与服务端进度模块

**Files:**
- Create: `data/tutorial.json`
- Create: `server/src/world/tutorial.ts`
- Modify: `server/src/persistence/save-keys.ts`（登记 `afTutorial`）
- Test: `server/test/unit/tutorial.test.ts`

**Consumes:** WorldState globals/playersDb、Economy npcBuy（第 7 步委托完成信号）、tasks.ts claim（第 5 步收菜）。
**Produces:**
- `export function tutorialSteps(tables: Tables): Array<{ id: string; title: string; hint: string; need: string }>`（读 data/tutorial.json，7 步）
- `export function tutorialProgress(state, uid): { done: string[]; active: string | null }`（active=第一个未完成步）
- `export function tutorialAct(state, app, uid, actName: string, ok: boolean): void`（在 actResult 处调用，按步 need 标记完成，仅 ok 计数——同 tasks 模式）
- `export function tutorialView(...)`: GET /af/tutorial 响应 { steps, progress }

- [ ] Step 1: 写失败测试（用例：7 步齐；act 序列 `move×2/till/plant/water/harvest/talk/delegate` 完成后 progress 全绿；未登记键报错）。Expected: FAIL no such module。
- [ ] Step 2: data/tutorial.json（7 步 + 文案，与规划书 P4 列表一一对应）。
- [ ] Step 3: 实现 tutorial.ts + save-keys 登记 + `server/src/gateway/ws.ts` actResult 尾段挂 `tutorialAct` + GET /af/tutorial 路由（app.ts）。
- [ ] Step 4: `npx tsc --noEmit` 0 错；`npx vitest run` 全绿（含 tutorial）。
- [ ] Step 5: node server 隔离 AF_SLOT=99 + AF_DATA_DIR + ci-seed-datadir → curl `/af/tutorial` 7 步结构 → curl act move 经 agent 通道后 progress 首步 done；杀测试实例。
- [ ] Step 6: security-check → commit `feat(tutorial): 数据驱动新手教程服务端（afTutorial 登记 + act 计数）`。

### Task 2: 客户端引导 UI（升级 injectOnboarding）

**Files:**
- Modify: `client/mod/agentfarm.js`（injectOnboarding L2192-2475：卡片步骤化 + 右侧常驻步骤条 + 完成 tick 高亮 + `⏭️ 跳过` / 设置面板「重看引导」）
- 修改（若需）: `client/index.html`（无新 script 标签，纯 DOM）

**Consumes:** `GET /af/tutorial`（含 token；fetch 模式同 refreshTasks L1506）。
**Produces:** `#af-tut-bar`（DOM 常驻增量=1，门8 容量 12 内）+ localStorage `af.tutorial.v` 跳过后不再弹（老账号兼容）。

- [ ] Step 1: 失败冒烟：`node tools/face-smoke/capture.mjs` 新断言——新档进入后 `#af-tut-bar` 可见且含 7 项、文案与 /af/tutorial 一致。Expected: FAIL。
- [ ] Step 2: 重写 injectOnboarding：步骤状态机（读 /af/tutorial 轮询 30s 节流——同 tasks 模式），当前步高亮+hint 文案；「第 6 步」点击后开 #af-agent 面板（复用 P1.4 托管入口）。
- [ ] Step 3: 冒烟重跑 → PASS；门8 人脸检查 `node tools/face-audit/face-ui.mjs --check`（裸色 0 / 点击 100% `AFUNI.on`——新 UI 全走 AFUNI 组件）。
- [ ] Step 4: security-check → commit `feat(client): 新手引导步骤化 UI（7 步卡片 + 重放）`。

### Task 3: 文本面对齐 + 全批回归

**Files:**
- Modify: `tools/face-audit/surface.mjs`（新面 GET /af/tutorial）
- Modify: `tools/face-audit/eval-textonly.mjs`（第 15 环：走查 7 步教程完成链，文本通道完成 progress 断言）

- [ ] Step 1: 两工具接入，Expected: 首跑 FAIL（面未注册）。
- [ ] Step 2: 接线后全绿：`node tools/face-audit/surface.mjs` + `node tools/face-audit/eval-textonly.mjs`。
- [ ] Step 3: 全批回归清单（规划书 §7）：`npx vitest run`、`node tools/security-check.mjs --all` PASS、门8 人脸、门10 面审计 16 面、`node tools/data-migration-test.mjs 16`、壳哈希 5140 不变。
- [ ] Step 4: commit `test(audit): 教程面进 surface/eval 双环（门10 容量 16）`。
