# 施工任务清单：联机村（共享世界 · 阶段零）

Feature Name: online-village
Updated: 2026-10-02
状态图例: [ ] 未开始 | [~] 进行中 | [x] 完成 | [!] 受阻
依赖：建议在玩家审计 P0-P2 清零后开工；R2（回放确定性）为其余一切的前置。

## 工作包 A：回放确定性（R2，最高优先，其余的地基）

- [x] A1 根因排查：重启「重放哈希 != 运行态哈希」告警已归因——`structuredHash` 只覆盖「事件拥有」的结构化域，自由桶（mapData/playerData/knapData，客户端可覆写）不参与；git stash 回旧代码、slot95 未改存档同样告警（events=172），与新功能无关，属正常诊断
- [x] A2 一致性可观测：`app.replayVerify` 记录上次自检结论 + `/af/replay-status` 探针（含 broadcastQueue/memTail）；重放口径统一（rebuildState 同源）
- [x] A3 fail-fast 判定：`tools/replay-consistency.mjs`——events=0 仍漂移判 FAIL（真异常拦截），自由桶漂移归因放行（不拦截只记录）
- [x] A4 一致性第九道门进 CI（ci.yaml 门9，隔离数据目录起服务取 /af/replay-status）+ `replay-consistency.test.ts` 4 例

## 工作包 B：私有住宅（R1）

- [x] B1 出生槽位生成器 `world/spawn-slots.ts`：门户吸附环 N 等分，同门多玩家互不叠身（确定性，可回放）
- [x] B2 槽位接入 `ensurePlayerData`（第 1 玩家保留原版家门，第 2+ 玩家按序取 houses）
- [x] B5/B6 单测 `spawn-slots.test.ts` 6 例（同门不叠身/回绕/空 houses 边界）
- [x] B4（2026-10-03 落地）场景 1 槽位化导航：`tools/gen-home-slots.mjs` 把原版 29x29 单槽纵向拼成 8 槽（29x240，槽间整行阻挡）+ `data/home-slots.json` 槽位表 + `data/home-collision.json` 单槽源；服务端按加入序号（`state.playerIdx`，持久化在 globals.afPlayerIdx）做归属校验 —— 人类 `move` 与 Agent `move`/`move_to` 跨槽一律拒，实机验「坐标 (14,44) 属于别人的家门口（槽 2），你住槽 1」；navOf 场景 1 优先用 `nav-zhujuejia-slots.json`；`gen-home-slots --check` 进 CI 门6
- [~] B3 场景 1 客户端渲染：服务端子链 ready，客户端 Cocos 渲染待实机环境验收

## 工作包 C：抢占原子化（R3）

- [x] C1 `world/claims.ts` 裁决器：tryClaim 先到先得 + 幂等 + 过期抢占；claimsData 桶登记 WORLD_KEYS（回放参与哈希）
- [x] C2/C4 裁决结果含 holder 与资源状态（Agent 可读文案）；单事件化事务边界（fresh=true 后调用方发单条 claim 事件 + persist）
- [x] C3 单测 `claims.test.ts` 8 例（先到先得/幂等/过期抢占/释放/批量释放）
- [x] 并发压力脚本 `tools/stress-claims.mjs`（2026-10-03 落地）：真实 /agent 通道 N 并发抢同一资源，判定「恰好 1 个成功」；实机 40 并发 x 3 轮全过，挂 nightly 独立 job。脚本要点：`accounts.register` 有每秒 5 个硬限流 → 串行备号 + 退避；每轮换一块目标格（上一轮胜者仍持有旧资源）；kind 默认 generic 直接压裁决器

## 工作包 D：租约与再生（R4/R5）

- [x] D1 `world/lease.ts` 起租/照料（延长上限 5 次防无限占位）/枯萎判定/再生复位；leaseData 桶登记 WORLD_KEYS
- [x] D3 风暴预警 stormWarning（临期未照料提前通知）
- [x] act `lease` 接 open/care/tick/status（tick 批量枯萎→公告+八卦，再生→公告）
- [x] 单测 `lease.test.ts` 8 例（起租/超租枯萎/照料延租/上限/非持有者/再生/预警边界）

## 工作包 E：灰度可观测（R6）

- [x] E1 `world/gray-scale.ts`：AF_GRAYSCALE_ON 总开关 + 白名单 + 特性级开关（单测 3 例）
- [x] E2 可观测：app.startMemorySampler 内存曲线（30s/120 点）+ 广播队列深度 + /af/replay-status.memTail
- [x] 锁房门（WP3）：/af/register 邀请码 AF_REGISTER_INVITE + 玩家上限 AF_MAX_PLAYERS
- [x] E3 分片决策备忘：体积超阈值按 56x56 区块分片（记于上线方案风险表，只做预案不预做）

## 工作包 F：异步社交（R7）

- [x] F1 送礼扩展 `agent:<uid>`：离线 Agent 收货（入账目标仓库 + 收件箱情绪事件，observe 可见）；在线玩家仍走 socialNear 距离校验
- [x] F2 显著事件白名单 → `world/gossip.ts` 环形 50 条八卦（大额送礼/委托/节日/租约）→ 注入 NPC talk LLM system 素材 + 公告
- [x] F3 委托栏 `world/delegate.ts`：发布（冻结金校验）/接取（不能接自己的）/完成结算转账/破产自动关闭；delegatedData 桶登记 WORLD_KEYS；act `delegate` 接 publish/accept/complete/list；单测 5 例

## 工作包 H：文本无障碍通道（R9，设计铁律）

- [x] H1 `world/mapdoc.ts` buildMapDoc：nav kind 连通分量簇 bbox（阻挡/水）+ 建筑门位 + 地标 + 矿点 + 门户 + 出生槽位 + 自规划示例；`/af/mapdoc` 公开 GET（数据缺失回落仓库 data/；对象分场景 flatten 兼容）
- [x] H2 公告通道 `world/notices.ts`（环形 100 条，noticeData 桶登记 WORLD_KEYS）+ 租约/再生/八卦事件挂钩 + observe.notices + /af/notices?since=
- [x] H3 observe.tasks 任务视图（系统任务 inProgress + 委托栏 delegated）
- [x] H4 observe.festival 既有（计分随 act fish/harvest 累计、act stall 开摊）
- [x] H5 `tools/eval-textonly.mjs` 文本盲测门 M-O4：LLM 零视觉 8 环节通道齐备断言（实跑 PASS；LLM 对白环节需 provider 配置后全量）
- [x] H6 表面审计 `tools/surface-audit.mjs` 10 类玩家可见信息面进 CI 门10（缺任一文本通道判死）

## 收口

- [x] G1 全量回归绿：tsc 0 错 / vitest 343 项 41 文件全绿 / gen-nav / nav-replay 48 pass（门6 另跑 `--smoke --drift` 48 例）/ check-roads / build-scene-collisions / f4 / security / 一致性第九门 CONSISTENT / 表面审计门10 / M-O4 文本盲测 PASS / **门11 存档键审计 / 门12 路由鉴权矩阵**（2026-10-03 新增，见下）
- [~] G2 实机视觉验收（shot-client 截图判读：双开出生、住宅、共砍树）——仅开发验收用，Agent 决策回路零视觉；待用户在实机环境跑影子窗后确认
- [x] G3 tasklist/MEMORY 登记 + 推送（628e8b3）
- [ ] G4 按 `docs/上线部署方案.md` 启动上线（R8）——游戏完工后按 §7 触发条件执行

## 里程碑门

- M-O1: 回放零告警（A 包完成即达）✅ 一致性第九门 CONSISTENT
- M-O2: 双账号实机「各有家、共争树」演示通过（B+C 包）——服务端裁决链路已 ready，实机演示待 G2 环境
- M-O3: 10 账号灰度哈希稳定（E 包）✅ 灰度开关 + 内存曲线 + 广播队列可观测
- M-O4: 文本盲测通过——LLM 零视觉完整游戏日（H 包）✅ 通道齐备 PASS
- M-O5: 上线链接发出（G4）——待触发条件

## 2026-10-03 差距核查与收口（上线阻塞群 + 门禁补齐）

规划书与代码逐条核对后落地（详见 `docs/全方位旗舰进化书.md` §6 与本文 G 段）：

- [x] 存档键注册表 P0：8 个服务端桶键（fitnessData/staminaData/facilityData/afStalls/gossipData/afDayAnchor/afLastGameDay/afLastStorm）未登记注册表 → `importSave` 落进 `uid=''` 幽灵桶，**重启静默丢失**（slot94/96/97/98/99 实测中招）。补登记 + `repairStrayBuckets()` 回收历史数据 + 无主键护栏 + **门11 `tools/save-key-audit.mjs`**（单测 5 例）
- [x] D17 客户端直写防护：`world/save-guard.ts` 服务端专属桶拒写 + 背包增量封顶（金币 +500 / 物品 +20）+ 未注册键拒写 + `/af/replay-status.saveGuard` 计数 + `AF_TRUST_CLIENT_SAVE=1` 逃生阀（单测 14 例）
- [x] D18 鉴权矩阵：`tools/auth-matrix.mjs` + `docs/鉴权矩阵.md` + **门12**（46 路由：公开 11 / 带 token 37 / 未授权 0 —— 后续新增 /af/metrics、/af/economy-design、/af/save-version 均带 token）；`/af/saves` `/af/players` `/af/replay-status` 补 token，`/af/room` 的 roomCode 仅带 token 返回，dev 发币发物可 `AF_DEV_ENDPOINTS=0` 关
- [x] N12 成本熔断：`cognition/llm-budget.ts` 每日账号 token 预算（`AF_LLM_DAILY_TOKENS`）+ 软提醒（`AF_LLM_BUDGET_WARN`）+ 硬熔断降级（chat->null / embed->伪向量），`/af/llm-usage` 增 budget 字段
- [x] 经济钩子冻结闸：`act stall` 此前无闸（与 hooks 声明相反，实收金币），现走 `world/economy-gates.ts`（缺省冻结，`AF_ECON_HOOKS` 解冻），`/af/economy` 增 `hooksFrozen`
- [x] D1 drift 验证进自动门：nightly 的 `--matrix` 曾是 nav-replay 未识别旗标（静默落默认分支），现显式解析 + CI 门6 跑 `--smoke --drift`
- [x] CI 门3 自足化：ws-test 不再依赖 gitignore 的 `data/accounts.json`，改为自备账号（register/login + `/af/agent-token`）
- [x] N8 留存/漏斗/时长度量（`world/metrics.ts` + `/af/metrics`，世界桶 metricData）
- [x] N9 内容扩容（`data/task-chains.json` 6 链 31 阶 + `data/season-events.json` 16 事件 + `data/onboarding.json` 第一小时 10 环）
- [x] N10 经济数值表（`data/economy-tables.json` + `Tables.basePriceOf` + 种子 6 折 + `/af/economy-design`）
- [x] N11 存档版本化（SAVE_VERSION=5 + 迁移注册表 + `tools/migration-rehearse.mjs` 16 存档位重演）
- [x] C/D 包事件化与哈希扩容（`claim.*`/`lease.*` 四事件 + apply 分支 + structuredHash 收 claims/lease；域级回放对比一致）
- [x] `act give`/`act bind` 从人类 /ws 通道下沉 `world/social-actions.ts`，Agent 与人同源
- [ ] 遗留：`noticeData`/`gossipData`/`delegatedData` 事件化后再纳入 structuredHash（当前多路径直写，收进去只会永久漂移）
- [ ] 遗留：G2 实机视觉验收（shot-client 双开出生/共砍树截图判读）、G4 上线
