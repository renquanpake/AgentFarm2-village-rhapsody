任务书升级为游戏故事书 Implementation Plan（批3 故事书扩容 20 链）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任务书 126 阶 → ~380 阶、每链 NPC 口吻 intro/outro、换季信、终章全村贺词彩蛋；40 天可完成性模拟器作内容门禁。

**Architecture:** 引擎面 `server/src/world/tasks.ts` 扩展 intro/outro 字段透传与 `seasonLetter` 日钩子；数据面 `data/task-chains.json` v3 + 生成器 `tools/gen-chains-v3.mjs`；日历钩子 `world/calendar.ts` 接换季信（notice 文本通道 + observe.notices）；客户端面板渲染引子/尾声折叠项。40 天模拟器 `tools/taskbook-simulate.mjs`（纯函数内核 + CLI）。

**Tech Stack:** 同批1a（vitest 内核测试 + CLI 工具 + JSON 数据）。

**Spec:** `docs/长期工作规划书.md` §2（2.0 故事书定位 / 2.1 内容矩阵 / 2.2 数值红线 / 2.3 批次）。

## Global Constraints

- type 值只使用已挂 taskCount 的 20 种（f1aa544 教训）
- 链 stage id 全局唯一前缀（progress 槽键 `chain:<stageId>`）
- 金币奖励统一 `rewardCoins`（同源去重已内建）
- 40 天红线：任一日可完成阶 5-20，无断档无井喷；任务书总发放 ≤ 玩家 40 天产能 1.5 倍
- strict + requiresChain 主轴；未解锁链折叠章节尾
- 新可见文案必进 surface-audit + eval-textonly（门10）
- 客户端零硬编码、AFUNI 组件/token 样式、ui-lint 红线

## 内容矩阵（24 新链 ≈ 260 阶，五章既有骨架）

- NPC 个人线 12 链（村长/木匠/梅姨/家石伯/二休禅师/明珠/屠夫/杂货店/树根嫂/赵香茹/飞英/护士，每人 4-6 阶小传，台词与 `data/npcs.json` persona 同源）
- 季节支线 8 链（春育苗/夏防汛 storm 钩子/秋囤粮/冬送暖 ×2 组，对接 season-events.json 未挂钩项）
- 长线收集 4 链（洒水器 77/78/79、鱼谱 65-76、关系网 bind/fav、委托信誉 delegate）
- 每链数据新增 `intro`、`stages[].outro`（字符串，NPC 口吻）；每阶 `day` 字段（可完成最早游戏日，供模拟器与折叠解锁）

### Task 1: tasks.ts intro/outro + day 字段透传（含引擎单测）
- `ChainDef`/`StageDef` 类型扩展（可选字段，旧档零迁移）；`taskView()` 输出带 intro/outro/nextUnlockHint；未解锁链 `chainLockReason` 沿用。
- RED→GREEN：`server/test/unit/tasks.test.ts` 追加 4 例。

### Task 2: 生成器扩写 24 链 260 阶（数据批次=四季）
- `tools/gen-chains-v3.mjs` 模板化生成（每链唯一 id 前缀 + intro/outro 文案表内置），分四季各 ~6 链 65 阶四批提交；每批跑 Task 4 模拟器 + walkthrough 零 FAIL。

### Task 3: 换季信 + 终章彩蛋（calendar 钩子 + notice 通道）
- `calendar.ts runGameDay` 第 11/21/31 天注入 letter notice（季节事件 + 新章解锁公告，文本通道 observe.notices）；终章「一年之约」完成事件 → 全村 NPC 贺词 notice 串 + `村志合卷` 标记（world 桶 `afStorybook`——**必须在 save-keys.ts 登记**，门11）。
- RED→GREEN：单测模拟日推进断言 notice 注入与幂等（同日不重发）。

### Task 4: tools/taskbook-simulate.mjs（40 天可完成性 + 发放曲线红线）
- 纯函数内核 `simulate(chains, dayCapacityFn)`：逐日「可用链×可完成阶」推演（依赖 growMs=1 游戏日、钓鱼冷却 59s、社交第 3 天、节日第 4 天等既有节奏常数，从数据/代码读取）；红线断言 + `--check` 进 CI。
- 发放总额/产能比报告。

### Task 5: 客户端渲染升级
- 面板：active 阶置顶高亮、未解锁链折叠章节尾、intro/outro 展示、换季信入 chat 气泡（复用 __AF_CHAT_ADD__ kind=notice）；「重看引导」预留（批2a 接口）。
- ui-lint + ui-smoke 新断言 2 项（intro 可见、折叠态）。

### Task 6: 收口回归
- tsc/vitest/security/ui-lint/ui-smoke/surface-audit(新面注册!)/eval-textonly/walkthrough 全链/migration-rehearse/壳哈希/nav-audit（不受影响复跑）。

> **Ruling（ledger 引用）**：内容矩阵 260 阶的具体文案在 Task 2 各批执行时定稿；本计划先锁定结构与红线，属规划书 §2.3「内容工程四季各一批」的原批次设计。
