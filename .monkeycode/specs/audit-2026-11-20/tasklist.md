# 全盘审计任务清单（2026-11-20）

> 来源：本会话四路并行审查（代码 / 文档 / 数据契约 / 安全）+ 终评校正。
> 状态符号：`[ ]` 未开始 / `[~]` 进行中 / `[x]` 已收口 / `[!]` 撤销（含理由）

## P0（必须立即处理）—— 0 项

无。原 P0 #1（protocol.ts 51 处裸 any）经 systematic-debugging Phase 2 对照参考实现后**降级为 P1**，理由见下。

## P1（高优先级）

### P1-1 protocol.ts 字段类型可收紧但不彻底重写
- 位置：`server/src/gateway/protocol.ts:9-59`
- 现象：原报告称"51 处裸 any 是入口防线失效"。
- **校正事实**（Phase 2 验证）：文件头部第 2-3 行明示设计原则——「结构层强校验（t 必须命中已知指令、kv 必须为数组）+ 业务字段保持宽松让 handler 自行 String()/Number() 转换」。这是与冻结 legacy afserver.mjs 行为等价的有意选择，非疏漏。
- 残余风险：`passthrough()` 下未知字段静默通过，下游 NaN/字符串数字需 handler 兜底（MEMORY 已记录 normXY/build 等多处 NaN 守卫）。
- 实际可做：①关键数值字段改 `z.coerce.number()`（兼容字符串数字，等价 legacy）；②关键文本字段改 `z.string().or(z.coerce.string())`；③TS 接口派生自 zod（`z.infer`）；④保留 `.passthrough()` 不破坏存量客户端。
- 用户决策（2026-11-20）：**一次性全量重构**。预期改动 100 行内 + vitest 协议回归全绿。

### [x] P1-2 README 关键文件段陈旧（2026-11-20 收口）
- 收口动作：README 架构段重写为 server/src TS 栈（含 gateway/cognition/world/persistence 分层）+ 关键文件段修正不存在引用（AgentFarm2-规划书.md → 最终版规划书/进化书/.monkeycode/docs 项目 wiki）；顺手修 `deploy/start.bat`（原启冻结 legacy afserver.mjs 且检查不存在的 server\world.json → `cd server && node src\index.ts` + `data\saves\slot1\world.json`）。改动未 commit。
- 位置：`/workspace/README.md` 关键文件段
- 现象：引用不存在的 `docs/AgentFarm2-规划书.md`；把冻结 legacy `afserver.mjs` 描述成现行服务端，实际入口是 TS 版 `server/src/index.ts`。

### [~] P1-3 跨文档数字漂移（统一病根）（2026-11-20 大部分收口，余 2 子项归后续批次）
- 本日钉死口径（实跑验证）：门户 72 条（portals.json 求和）/ 任务链 26 链 126 阶（task-chains.json）/ 路由 49 条（auth-matrix 重算 PASS）/ 哈希 5138 文件（hash-manifest --check exit 0）/ 场景 27 / 槽位 29×240 / 村景 189×173。
- 已同步：MEMORY(3) / 旗舰书(2) / 长期规划书(2) / 接手指南(1) / 出生地方案(2) / scenes.json note / online-village tasklist / playability tasklist（走查记录加扩容前口径标注，历史证据保留原文）。
- 暂缓：①vitest 项数 343/448/471/484 四口径需重跑 vitest 定案，随 P1-1 批次一起跑；②e2e-nav 26/29 与 surface 15/16 双口径均在 MEMORY 内部，并入 P2-4 处理。
涉及：
- 场景数：28 vs 实测 27（`data/nav/scenes.json`）
- 门户数：56 vs 实测 72（`data/nav/portals.json`）
- 任务链规模：6×31 vs 实测 26×126（`data/task-chains.json`，旗舰书 N9 标"已收口"但数字停在扩容前）
- D18 路由数：43 / 46 / 49 三口径
- vitest 项数：343 / 448 / 471 三口径
- 原版哈希基线：5128 / 5140 / 5138 三口径
- e2e-nav-arrive 项数：26 / 29 双口径
- surface-audit 面数：15 / 16 双口径
- 场景 1 槽位图：29×61 vs 实测 29×240
- 村景格宽：133×117（scenes.json note 残留）vs 189×173

### [x] P1-4 specs 目录 tasklist 齐备性违约（2026-11-20 收口）
- 新建 4 份 tasklist.md：flagship-visual-polish / trade-hall（缺 tasklist 的两条）；ux-flagship（plan.md 保留原任务总纲，新 tasklist 承载逐条对账状态）/ world-expansion（design §6 排期承载对账）。六条线全部具备可对账 tasklist。未 commit。
- 现象：旗舰书 §0 自设「进度归一到各 line tasklist」机制失效——6 条 spec 线中 flagship-visual-polish/trade-hall 无 tasklist，ux-flagship/world-expansion 非标准命名，导致 M1-M5/N7 的 ✅ 无从对账。

### P1-5 D2/D3 收口状态跨文档冲突
- 最终版规划书 §3.2 标 ✅ 收口；旗舰书 §6 标「代码侧收口待行为验证」。需单一裁决口径。

### P1-6 ~20 个 server 文件共 71 处 console.* 直调
- 绕过 `logging.ts`（含 500 条环形缓冲 + level 分级），生产日志不可检索。

### P1-7 PORT 环境变量两处内联回退
- `gateway/http.ts:509` 与 `cognition/managed.ts:72` 各写 `process.env.PORT || 8080`，未复用 config.ts 已导出常量。

### [x] P1-8 data/npcs_new.json 0 字节空文件留在仓库（2026-11-20 收口：git rm 清除，零引用）
### [x] P1-9 data/world.json.bak 约 68 MB 仍在仓库（2026-11-20 用户裁决收口：git rm 清除，零引用）

## P2（中优先级）

| 编号 | 位置 | 现象 |
|---|---|---|
| P2-1 | `tsconfig.json` | noUnusedLocals/Parameters: false + 30+ 处 as unknown as X 双重断言逃逸 strict |
| P2-2 | `docs/鉴权矩阵.md:46` | market 正则路由显示为原始代码文本而非 `/af/market/{id}` 形式 |
| P2-3 | `world/economy-gates.ts` | interest/insurance/matching 三钩子仅常量声明无结算路径，构造性冻结缺省安全态 |
| P2-4 | MEMORY.md 内部 | 同一指标多代快照并存（交接点段 vitest 448 vs 构建节 471；e2e 26 vs 29；surface 15 面 vs 16 面） |
| P2-5 | `gateway/http.ts:893` | refresh();setInterval(refresh,10000); 两语句挤一行未格式化 |
| P2-6 | `cognition/managed.ts:81-96` | child as unknown as ChildProcess 双重断言后手工 pipe stdout/stderr |
| P2-7 | `gateway/ws.ts` 全文件 1782 行 | 上帝文件：连接管理 + 消息分发 + Agent 任务执行 + 存档守卫全揉在一个文件 |

## 已确认健康项（无需动）

- 门11 存档键审计：WORLD_KEYS 23 + GLOBAL_KEYS 11 + PLAYER_KEYS 13 全在册；`tools/save-key-audit.mjs` 实跑 PASS
- 门12 鉴权矩阵：http.ts 47 行 + 1 正则 = 49 条；auth-matrix.mjs 重算结果与 docs/鉴权矩阵.md 逐行同源
- D17 save-guard：7 拒写分支 + 8 reason 码，五类规则全齐 + 单测在册
- N12 llm-budget：硬熔断四项全齐并真接线 + 单测在册
- 零硬编码密钥：sk-/ghp_/api_key 三 pattern 扫描 clean
- CI 十二道门：ci.yaml 实列与 MEMORY 描述逐条吻合
- 依赖卫生：零冗余、无凭据泄露、无吞错空 catch、注释质量高
- client/mod 隔离：agentfarm.js 对原版 API 深度依赖但 try/catch 隔离；af-ui/af-fx/af-audio IIFE 独立软依赖降级

## 本轮不做（ponytail 决定 + 假设清单）

- P0 撤销项不阻塞流程，仅作为 P1-1 的校正说明保留。
- `world.json.bak` 与 `npcs_new.json` 已按用户裁决清除（2026-11-20，收口记录见 P1-8/P1-9）。
- 多代历史快照统一由 P1-3 一次性重写处理，不逐个打补丁。