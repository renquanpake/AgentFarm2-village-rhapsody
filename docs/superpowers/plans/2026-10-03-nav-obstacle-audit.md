导航障碍数据完整性与 move 门控 Implementation Plan（批1 之 P1.0 导航审计）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 障碍坐标全量登记可审计（rect 覆盖漏登=0、未归因阻挡格=0、nav 陈旧=0、门户双向可达、锚点无孤岛），且 `act move` 单步受权威格门控、失败文案点名具体坐标。

**Architecture:** 三层——纯函数内核 `server/src/navigation/audit.ts` / `movegate.ts`（vitest 可测，无 IO）；数据装配 CLI `tools/nav-audit.mjs`（读 data/，`--check` 进 CI 门6）；`gateway/ws.ts` 接线（move/chop/plant/water/till 调纯函数）。村层归因从 `tools/build-collision.mjs` 抽共享模块 `tools/village-layers.mjs`，build-collision 改引用（产物字节一致为回归证据）。

**Tech Stack:** Node 22 原生 TS（type stripping，无构建）、vitest ^3；tools 为 .mjs 纯 node。

**Spec:** `docs/长期工作规划书.md` §1.0 + §7 回归清单（规划书为权威源）。

## Global Constraints

- tsc strict + erasableSyntaxOnly（禁 enum/namespace/参数属性）
- 不触碰 `client/assets/**`；原版壳哈希基线 5140 不变
- 数值/坐标零硬编码，运行时读 `data/*.json`
- 改 `server/src/**` 后必须重启实例再验证（MEMORY 纪律）
- 每次 commit 前 `node tools/security-check.mjs` PASS
- 报错文案点名具体格坐标（f1aa544 / NaN 误诊教训）

## File Structure

- Create: `server/src/navigation/audit.ts`（rect 覆盖/归因/门户双向/孤岛环 纯函数）
- Create: `server/src/navigation/movegate.ts`（单步门控 + 分类文案 纯函数）
- Create: `tools/village-layers.mjs`（解密+图层解析共享模块）
- Modify: `tools/build-collision.mjs`（改 import village-layers，产物不变）
- Create: `tools/nav-audit.mjs`（装配 CLI + report + `--check`，`--write` 重生成村 nav）
- Modify: `server/src/gateway/ws.ts`（move 接线 ~L882；move_to 不可达文案 ~L1075；目标格动作孤岛预检 ~L1278-1435）
- Create: `server/test/unit/nav-audit-kernel.test.ts`、`server/test/unit/movegate.test.ts`
- Modify: `.github/workflows/ci.yaml`（门6 加 nav-audit --check）、`data/nav/nav-2.json`（重生成 189x173）

## Review Focus

1. **客户端树阻挡 vs 服务端树格可走**：村 nav 无 kind=3（treeCells=0）；若 P1 真机验证发现小人穿树，属新增登记需求——本计划只在报告里列出「树格但可走」数量，不加阻挡（擅自加阻挡会造成反向不一致）。
2. **shilu 广场豁免**：路格上的栅栏装饰保持可走（build-collision 规则 `onRoad`），归因 mask 必须复刻同样规则，否则未归因误报。
3. **nav-2.json 陈旧（133x117）**：重生成后 `gen-nav --check` 门户吸附结果可能与旧文件不同，须实跑核。
4. **village-layers 抽取回归**：解密/图层清单若漏层，产物字节 diff 会爆——Task 2 的验证步骤就是防线。
5. **move 新门控误拒**：宅门/矿点等贴障碍格被拒会破坏任务链——门控只挡 `blocked/cost<=0` 格，吸附与环预检给替代坐标。

---

### Task 1: 审计内核 audit.ts

**Files:**
- Create: `server/src/navigation/audit.ts`
- Test: `server/test/unit/nav-audit-kernel.test.ts`

**Interfaces:**
- Produces（Task 3 消费，签名精确）:
  - `export interface AuditRect { name: string; x: number; y: number; w: number; h: number }`（格坐标，含左上、含右下 x+w-1）
  - `export function rectMisses(w: number, h: number, blocked: number[], r: AuditRect): Array<[number, number]>`
  - `export function unattributedCells(w: number, h: number, blocked: number[], attrib: Array<{ name: string; mask: number[] }>): { perSource: Record<string, number>; unattributed: Array<[number, number]> }`
  - `export function portalsBidirectional(portals: Portal[], navOf: (scene: number) => NavGrid | null, maxSnap?: number): string[]`（violation 行含 scene/toScene/坐标）
  - `export function isolatedCell(nav: NavGrid, gx: number, gy: number): boolean`（本格与 8 邻全不可走）
  - `export function nearestStand(nav: NavGrid, gx: number, gy: number, maxR?: number): [number, number] | null`（格入、格出，方形环 8 邻可走）
  - 可走性判定与 navgen `snapToWalkable` 同口径：`blocked!==1 && cost>0`

- [ ] Step 1: 写失败测试（6 例）：rect 内 1 格未 blocked→恰返该行坐标；attrib 全覆盖→unattributed 空、漏盖 1 格→报该格；portals 双向齐→[]、缺反向→1 行含 `反向门户`；scene 无 nav→该行含 `无导航数据`；孤岛格→true、有邻可走→false；nearestStand 被半环围住返回最近可走格、maxR 内无可走→null。
- [ ] Step 2: `cd server && npx vitest run test/unit/nav-audit-kernel.test.ts` → FAIL（模块不存在）。
- [ ] Step 3: 实现 audit.ts（纯函数；import type { NavGrid, Portal } from './navgen.ts'）。
- [ ] Step 4: 同命令 → PASS 6/6。
- [ ] Step 5: `npx tsc --noEmit` 0 错；commit `feat(nav): 障碍审计纯函数内核（rect覆盖/归因/门户双向/孤岛环）`（前置 security-check）。

### Task 2: 共享村图层模块 + build-collision 改引用

**Files:**
- Create: `tools/village-layers.mjs`
- Modify: `tools/build-collision.mjs:16-45`

**Interfaces:**
- Produces: `export function loadVillageLayers(rootDir: string): { W: number; H: number; ORIG_W: number; ORIG_H: number; MARGIN: number; layers: Record<string, number[]>; getT(name: string, x: number, y: number): number; onRoad(x: number, y: number): boolean; inOrig(x: number, y: number): boolean }`（rootDir=仓库根；client 资源相对路径与解密 KEY 原样搬入）
- Consumes: 无；build-collision.mjs 改为调用它。

- [ ] Step 1: 抽逻辑（脚本搬迁，无新行为）。
- [ ] Step 2: `node tools/build-collision.mjs` → 生成后 `git diff --exit-code data/village-collision.json` 干净（Expected: exit 0，字节一致即回归合格）。
- [ ] Step 3: commit `refactor(tools): 村图层解析抽取 village-layers 共享模块（产物字节一致）`。

### Task 3: tools/nav-audit.mjs CLI + CI 门

**Files:**
- Create: `tools/nav-audit.mjs`
- Modify: `.github/workflows/ci.yaml`（门6 追加一行）

**Interfaces:**
- Consumes: audit.ts 内核（动态 import TS：`await import('../server/src/navigation/audit.ts')` Node22 可直跑）、`scene-walls.mjs`、`village-layers.mjs`、`data/*.json`、`data/nav/scenes.json|portals.json|nav-*.json`。
- Produces: report JSON 写 `/tmp/af-nav-audit/report.json`，console 每场景一节；`checkViolations(report): string[]` 汇总；CLI 旗标 `--check`（violations 非空 exit 1）、`--write`（重生 `data/nav/nav-2.json`：`buildNavGrid(2, col.blocked, col.width, col.height, farm.water, treesFromPlant?)`——只传 collision+water，与 ws 运行时 `navGridFromTables` 同参，保证「文件=运行时」一致）。

装配规则（全部运行时读数据）:
1. 村（scene 2）阻挡权威 = `village-collision.json`。归因 masks：fanzi/inOrig、shuich 全图、mulan+mulan2（带 `!onRoad` 豁免同规则）、spawn-points houses.rect 格、buildings.json scene2 rect、边界环（x/y 0 与 max）。未归因=0 红线。
2. rect 覆盖：buildings.json 全部 scene2 rect + spawn-points houses rect 必须 ⊆ blocked（漏登=0）。
3. 每场景 nav 新鲜度：卫星场景重算 `extractSceneWalls` blocked 与 `nav-<slug>.json.blocked` 逐格 diff（漂移=0）；村：重算 `navGridFromTables` 等价（collision+water 经 buildNavGrid）与已提交 `nav-2.json` 尺寸+blocked diff（陈旧→`--write`）。
4. 门户双向：`portalsBidirectional(portalsOfAll, sceneNavOf)`。
5. 孤岛与锚点环：houses door、mine-spots、地图中心 anchors `isolatedCell`+`nearestStand` 检（违规=0）。
6. 信息项（不判死）：树格但可走 count（village plant 桶 ∩ walkable）、`ready-empty-collide` 场景清单。

- [ ] Step 1: 先跑红：实现 CLI 后立即 `node tools/nav-audit.mjs` —— Expected: 村 nav 陈旧（133x117）报警（真实缺陷曝光）。
- [ ] Step 2: `node tools/nav-audit.mjs --write` 重生成 nav-2.json，再 `node tools/gen-nav.mjs --check && node tools/nav-replay.mjs --smoke && node tools/nav-replay.mjs --smoke --drift && node tools/check-roads.mjs` —— Expected: 全绿；若 replay 成本比>1.1 停下 systematic-debugging（运行时 nav 本就重建自 Tables，文件仅 --check 消费，理论零成本差）。
- [ ] Step 3: `node tools/nav-audit.mjs --check` → exit 0；`git stash` 不适用——用临时改动验红：mock 一个 rect 漏 blocked（`--selftest` 内置自检向量跑 audit 纯函数断言 rectMisses>0）Expected: selftest PASS。
- [ ] Step 4: ci.yaml 门6 追加 `node tools/nav-audit.mjs --check`。
- [ ] Step 5: security-check + commit `feat(nav): nav-audit 障碍全量审计——rect覆盖/归因diff/nav新鲜度/门户双向/孤岛环，--check 进门6；重生成村 nav(189x173)`。

### Task 4: movegate.ts + act move 权威格门控

**Files:**
- Create: `server/src/navigation/movegate.ts`
- Modify: `server/src/gateway/ws.ts:874-894`
- Test: `server/test/unit/movegate.test.ts`

**Interfaces:**
- Produces:
  - `export type BlockedKind = 'none' | 'water' | 'building' | 'tree' | 'edge'`
  - `export function classifyStep(nav: NavGrid | null, gx: number, gy: number): BlockedKind`（nav null→只认 OOB 外为 'edge' 由调用方保证尺寸；blocked/kind 映射同 audit）
  - `export function stepGate(nav: NavGrid | null, houseBlocked: boolean, gx: number, gy: number): { ok: true } | { ok: false; msg: string }`——houseBlocked→`前方有障碍：(${gx},${gy}) 为住宅建筑，绕行`; water→`不可进入 (${gx},${gy})：水域阻挡，沿河岸绕行可 move_to {near:"water"}`; building/tree→`不可进入 (${gx},${gy})：${kindCN} 阻挡，请绕行`; 'none'/'edge' 放行（边界文案 ws 原有检查在前，保持不动）。
- ws 接线：现有 `blockedHouse` 与 `nx<0` 检查保留原序，在其后追加 `const cell=[Math.floor(nx/100),Math.floor(ny/100)]; const gate=stepGate(navOf(app, apos.scene), false, cell[0], cell[1]); if(!gate.ok){result.msg=gate.msg; continue;}`（houseBlocked 分支并入）。
- 无 nav 卫星场景（ready-empty-collide）→stepGate('none') 照走，行为不劣化。

- [ ] Step 1: 失败测试：合成 5x5 nav（1 水格、1 障碍格、1 树格；null nav 场景）7 断言：三格各含坐标文案、空地 ok、null nav ok、门住宅文案含「住宅建筑」。
- [ ] Step 2: vitest → FAIL；Step 3: 实现 movegate.ts + ws.ts 接线 → vitest PASS 7/7；Step 4: `npx tsc --noEmit` + 重启 8080 实例。
- [ ] Step 5: 活体：`node tools/dbg-agent-vis.mjs` 风格快速脚本（agent 通道连测试账号，向水面方向连发 12 步 dir）——Expected: 收到含 `(x,y)` 格坐标的水域拒绝文案且不再走越水面；跑 `AF_BASE=... node tools/e2e-nav-arrive.mjs` 26 项仍全绿。
- [ ] Step 6: security-check + commit `fix(nav): act move 单步受权威格门控，水/建筑/树阻挡点名坐标`。

### Task 5: move_to 不可达点名 + 目标格动作孤岛预检

**Files:**
- Modify: `server/src/gateway/ws.ts`（~L1064-1075 同场景分支；~L1127-1136 跨场景分支；L1278/1294/1317/1336/1362/1435 目标格动作）
- Test: `server/test/unit/nav-audit-kernel.test.ts` 追加文案装配断言（若装配留 ws 内，则本 test 仅覆盖内核 nearestStand/isolatedCell 已在 Task1——文案以活体验证为准，ledger 记 Ruling）。

- [ ] Step 1: 同场景 path null 时文案改为含端点格：`` `目标不可达（被障碍包围）：(${ssx},${ssy})→(${adx},${ady})，目标周边8格无可站立格时先 move_to 到附近可站格` ``（endpoint 取 nearestReachable 实际吸附点，未吸附点即点名 `原目标(gx,gy) 被障碍封死，8格内无可站格` 用 isolatedCell/nearestStand 判定与给建议坐标）。
- [ ] Step 2: 目标格动作（till/plant/water/harvest/chop/mine/fish 已有坐标目标处）统一预检：`isolatedCell(nav,gx,gy)` → msg `目标格 (gx,gy) 周边无可站立格（被障碍包围），建议 move_to {x,y} 到 (nx,ny)`（nx,ny=nearestStand）；不动「离目标太远」原文案（那是站位距离问题，语义不同）。
- [ ] Step 3: 重启实例；活体脚本验证两条文案（围岛坐标目标 till → 点名建议坐标；旧缺陷回归：NaN 文案不变）。`npx vitest run`（358+7 全绿）+ `npx tsc --noEmit`。
- [ ] Step 4: security-check + commit `fix(nav): 不可达/孤岛目标点名坐标并给可站格建议`。

### Task 6: 批1a 收口回归

- [ ] tsc 0 错；vitest 全绿；`node tools/nav-audit.mjs --check` exit 0；`gen-nav --check`/`check-roads`/`nav-replay --smoke(+--drift)`/`e2e-nav-arrive` 26 项绿；`hash-manifest --check` 5140；`surface-audit` + `eval-textonly`（可见文案面新增报错文案，确认文本通道即 agent 通道 result，无需新面——ledger 记结论）；`migration-rehearse` 16 位；`security-check --all`。报告漏网/未归因/漂移全 0 贴进 ledger。
