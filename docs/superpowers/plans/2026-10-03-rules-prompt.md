AI 接入规则提示词 rulesPrompt Implementation Plan（批2 之 P3 规则提示词）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent/LLM 开口前即携带村庄游戏规则（价格/坐标/动作语法/日历/任务进度），杜绝「问价不知价、走错场景、猜 NPC 位置」，预算双档 1200/300 token。

**Architecture:** 运行时从权威数据源拼装（永不硬编码数值）：`server/src/world/rules-prompt.ts` 纯函数 `rulesPrompt(app, opts)` 聚合 economy-tables（basePriceOf 三级口径+NPC 六折）、act 动作语义表（gateway/ws.ts 权威 switch 清单→抽 `act-catalog.ts` 同源）、landmarks/buildings（60 可导航地标）、npcs 名册、`taskView()` 摘要、calendar 日历态；返回 `{ text, rulesHash }`。注入点三处：NPC 对话 system prompt、managed 托管 spawn、玩家自带 Key 大脑（game-agent.mjs）；高频短路径走精简档。新端点 `GET /af/prompts?uid=`（admin token 鉴权）现场查拼装结果；rulesHash 进对话归因日志（`/af/agent-recap` 与 llm-usage）。

**Tech Stack:** Node 22 + TS、vitest；纯函数无 IO，数据经 app.tables/Economy 单例读取。

**Spec:** docs/长期工作规划书.md §3（P3）；文本无障碍铁律（MEMORY.md 2026-10-02）。

## Global Constraints

- 完整版 ≤1200 token、精简版 ≤300 token（按 `tokens = ceil(chars/2)` 估算守卫，超限逐段裁剪且裁剪顺序固定：动作表→地标→价目）
- 反幻觉条款固定尾句：「以上资料未写明的，回答不知道」
- 权威数据源唯一：价格 economy-tables、任务进度 tasks.ts taskView、日历 calendar——prompt 内绝不复制第二份数值
- `GET /af/prompts` 必须 admin token；响应不落敏感（玩家 Key 永不进 prompt）
- tsc strict + erasableSyntaxOnly；不入库任何真实 Key
- 每 commit 前 security-check

## File Structure

- Create: `server/src/world/act-catalog.ts`（act 名→参数→返回 一行式清单，ws.ts case 注释同源锚点）
- Create: `server/src/world/rules-prompt.ts`（纯拼装器）
- Modify: `server/src/gateway/ws.ts`（dialogue system prompt 与 spawn 提示词接入）、路由 `server/src/app.ts`（GET /af/prompts）
- Modify: `tools/game-agent.mjs`（system prompt 拼 rulesPrompt 输出，经新 /af/prompts 拉取）
- Create: `server/test/unit/rules-prompt.test.ts`

## Review Focus

1. token 预算与中文占比（2,000+ 行数据全量拼必爆 1200）——裁剪顺序错会砍掉规则主干；需先断言预算守卫。
2. 权威源漂移：economy-tables 与 NPC 收购价（六折）不同步进 prompt 会造成双倍幻觉。
3. `rulesHash` 进对话日志归因后，历史会话行无 hash——降级不报错。
4. 新账号任务进度空 → taskView 摘要占位语义（全未解锁 vs 全完成）。
5. prompt 注入面：NPC 名/玩家 nick 进 prompt 需长度截断（防撑爆与指令注入句）。

---

### Task 1: act-catalog.ts 动作语义表（纯清单）

**Files:** Create `server/src/world/act-catalog.ts`；Modify ws.ts（welcome 串改为引用 catalog 拼接）；Test 追加进 `server/test/unit/`（vitest）。

**Produces:** `export const ACT_CATALOG: Array<{ act: string; args: string; returns: string }>`、`export function catalogText(): string`。welcome 里 `{t:"act",action:"…}` 清单从此表生成（单一事实源）。

**Consumes:** 无（手工与 ws.ts:899-1620 switch 对齐，测试锁定条数）。

- [ ] Step 1: 写失败测试（用例：catalog ≥40 条；每个 `ACT_NAMES`（从 ws.ts 正则提取 case 字符串清单的常量）有对应条目；text 含 chop/claim/bind/sport 四关键词）。Expected: FAIL。
- [ ] Step 2: 实现 + 常量 `ACT_NAMES` ws.ts 导出（switch 分支名唯一源），welcome 改为 `catalogText()` 派生。
- [ ] Step 3: vitest PASS；`node tools/e2e-agent-msg-hud.mjs` welcome 断言回归（旧串含全动作名）。
- [ ] Step 4: commit `feat(world): act-catalog 动作语义表进 welcome 同源`。

### Task 2: rulesPrompt 纯拼装器 + 双档预算

**Files:** Create `server/src/world/rules-prompt.ts`；Test `server/test/unit/rules-prompt.test.ts`；Modify 无。

**Produces:**
- `export function rulesPrompt(app: App, opts: { budget: 'full'|'lite'; uid?: string }): { text: string; rulesHash: string }`
- `export function rulesTokenEstimate(text: string): number`（ceil(chars/2)）
- 段序：世界观(60 token 预算内)→日历→价目摘要（basePriceOf top-12 高频品+NPC 六折标注）→地标 top-20→建筑 top-8→NPC 名册(26 人名+岗位)→动作表(catalogText 压行)→任务进度(uid 给 taskView summary+active 链)→条款（同源权威注记+反幻觉尾句）。lite 档：世界观 1 行+日历 1 行+条款，恒 ≤300。

- [ ] Step 1: 写失败测试：full ≤1200 / lite ≤300（合成 tables fixture 超量数据）、uid 无任务全量占位段、rulesHash 随 price 表变动而变。Expected: FAIL。
- [ ] Step 2: 实现纯拼装（fixtures 走 `server/test/unit/fixtures.ts` 合成 App 既有规范——禁止 new App 落盘，MEMORY 纪律）。
- [ ] Step 3: vitest PASS + `npx tsc --noEmit`。
- [ ] Step 4: commit `feat(world): rulesPrompt 双档规则上下文拼装器`。

### Task 3: GET /af/prompts + admin 鉴权

**Files:** Modify `server/src/app.ts` HTTP 路由与既有 admin token 中间件；Test：e2e 冒烟加 `tools/http-auth-matrix.mjs` 断言（401/200）。

- [ ] Step 1: 失败冒烟：`GET /af/prompts` 无 token→401、带 `AF_ADMIN_TOKEN`→含 rulesHash；期望 FAIL。
- [ ] Step 2: 实现（读 body.query.uid 可选）。
- [ ] Step 3: 隔离实例 curl 双 200/401 + auth-matrix 工具 PASS。
- [ ] Step 4: commit `feat(http): GET /af/prompts 现场查规则拼装(admin)`。

### Task 4: 三注入点接线 + rulesHash 归因

**Files:** Modify `server/src/gateway/ws.ts`（act talk dialogue system prompt 前插 full 文）、managed spawn/`tools/game-agent.mjs`（拉 /af/prompts 拼 system）；对话日志 `data/agent-dialogue.jsonl` schema 追加 `rulesHash`（缺字段兼容旧行不报错）。

- [ ] Step 1: 单测装配层：mock llm.chat 捕获 system 串含「回答不知道」尾句与价格行。Expected: FAIL。
- [ ] Step 2: 实现；managed/game-agent 走 /af/prompts 拉取（失败回退本地规则兜底，不阻断对话）。
- [ ] Step 3: 隔离实例 `AF_LLM_FAKE=1` agent 通道实跑：act talk 问价 → 回复含 economy-tables 真值（fake llm 断言 system 含价目即可）。
- [ ] Step 4: `tools/eval-textonly.mjs` 增 1 环「NPC 问价答对且引用六折」进 eval 报告。
- [ ] Step 5: commit `feat(cognition): rulesPrompt 注入对话/spawn 与 rulesHash 归因`。

**收口回归**：tsc、vitest、security-check --all、auth-matrix、e2e 套、eval-text-only 双口径、壳哈希 5140。
