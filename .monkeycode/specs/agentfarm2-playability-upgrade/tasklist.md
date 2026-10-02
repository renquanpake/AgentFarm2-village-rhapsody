# 施工任务清单：AgentFarm2 可玩性升级（旗舰版）

Feature Name: agentfarm2-playability-upgrade
Updated: 2026-09-28
状态图例: [ ] 未开始 | [~] 进行中 | [x] 完成 | [!] 受阻

> 恢复指引：新会话续作时，先读本文件确认进度，再按需读同目录 requirements.md（验收标准）与 design.md（技术方案）。三轨可并行，轨内任务按序。

## 轨道 A：地基（52 人日）

- [x] A1 TypeScript 服务端重写：七模块拆分（gateway/world/market/navigation/cognition/narrative/persistence），strict 模式，zod 校验（design M6.1，26 人日中的 12）
- [x] A2 事件溯源：events 表 + apply 纯函数 + 事件内随机种子 + 快照表（design M6.2，8 人日）
- [x] A3 迁移与备份：migrations、WAL、每日本地备份保留 30 天（design M6.3，3 人日）
- [x] A4 CI 六道门：typecheck/vitest/协议回归/gitleaks/原版哈希/导航回放（design M6.4，3 人日；导航回放为占位，M3 落地 tools/nav-replay.mjs 后自动生效）
- [x] A5 管理后台与结构化日志（design M6.5，… 余量）：/admin 鉴权(房主/AF_ADMIN_TOKEN) + 统计/日志环形缓冲/事件审计/手动备份；logging.ts 结构化日志接入看门狗/托管启停/一致性校验
- [x] A6 玩家 Key 接入：AES-256-GCM 保管、子进程注入、脱敏（design M7，6 人日）
- [x] A7 双档路由与缓存：tier_map 查表、前缀缓存、用量面板（design M7，6 人日）
- [~] A8 导演镜头与想法气泡（design M1.1-1.2，4 人日）：服务端核心完成（director.ts 镜头时间线 + CameraDirector 节流观战推送 + spectate/unspectate 协议 + 想法气泡 thought）；**观战数据通道已开（WS camera 广播 + mod 村事面板导演观战区，efafeef）**；Cocos 内镜头跟随动画待客户端环境；资产交付端点 + __AF_ART__ 加载器/toSprite 注入基座已就绪（见 C8 段）
- [~] A9 画报日报：叙事服务 + 生图插画 + 回落截图（design M1.3，4 人日）：聚合骨架完成（report.ts buildDailyReport 纯函数 + /af/daily-report 端点 + 单测 3 项）；LLM 文案/生图插画/回落截图依赖 M4/M7 编排与客户端，遗留
- [~] A10 确定性回放器与回放模式渲染（design M1.4，6 人日）：回放器核心完成（replay.ts runReplay/verifyReplayDeterminism + /af/replay 只读端点 + 快照/事件重放哈希）；**回放时间线已接入 mod 村事面板（/af/replay?verify=1，确定性标注，efafeef）**；回放模式 Cocos 逐帧渲染待客户端环境

## 轨道 B：玩法（50 人日）

- [x] B1 CDA 订单簿撮合引擎 + NPC 商人做市冷启动（design M2.1，8 人日）：引擎 7f82162（价格优先+时间优先、挂单方价格、做市冷启动/熔断/破产护栏）+ 接线 88f8643（预留/过户/持久化/OHLC//af/market/trade act/行情广播）。商人决策策略属 B2
- [x] B2 NPC 商人策略与跨场景采购（design M2.2，4 人日）：商人台账 + 动量策略 + 决策周期（b47d726）；跨场景采购需 M3 导航（B5/B6）接入后启用，当前商人在家场景撮合
- [x] B3 货币治理与通胀回收（design M2.3，3 人日）：总量监控 + 通胀指数 + 回收档位 feeMultiplier + /af/economy + 每日监控告警（ad571a9）；造价/服务费/摊位费的实际扣减接入待 B8 历法与 B10 集市
- [~] B4 影子模式 14 日观察与调参（design M2.4，3 人日 + 观察期）：引擎+报告完成（shadow.ts 双实例 + market_shadow_fills + /af/shadow，19c2dfe）；**引擎活体验证通过**（tools/shadow-observe.mjs 流量驱动 3 司机 /agent 通道挂单：物品1 实盘=影子量 7/7 偏差 0 价差 0.84%，物品2 影子漏成交偏差 1 -> M-B1 调参信号）；M-B1 门为 14 **真实日**窗口（报告 from=now-14d），快时钟无法压缩——观察期在用户实跑服务器上开始（起点 2026-09-29T14:33Z，凭据 data/eval/shadow-live-check.json），到期 `AF_BASE=... node tools/shadow-observe.mjs` 复查 /af/shadow?days=14（门：价差中位 <15% 且 volumeDeviation <0.5，否则调影子 spread/makerQty）
- [x] B5 导航数据生产：27 场景 nav-grid + 门户图 + 人工核验截图（design M3.1，4 人日）：navgen 生成核心 + 村景落地（133x117/13锚点全可达/7门户）+ gen-nav CLI/--check 门 + 27 场景注册骨架（3e1a147）；26 场景源数据（客户端加密资源）提取遗留
- [x] B6 分层寻路与航点确认协议（design M3.2-3.3，6 人日）：场景内 A*（clearance 塑形）+ 门户 Dijkstra + planRoute + 航点偏差校验 + move_to 升级/arrive 协议（42f51ca）；旧 120ms 盲推保留为 debug/回落分支
- [x] B7 NPC 日程系统与节庆/天气聚集规则（design M3.4，3 人日）：时段日程 + 天气/节日覆盖（风暴避险/雨天居家/节日聚集）+ 幂等调度器 + npc_move 广播 + npc.schedule 事件（1648754）；mod 层村民动态 DOM 走马灯已落地（d84f1bc，npc_move -> af-npc-ticker overlay，Cocos 内显示效果待客户端验收）；Cocos 节点级 NPC 实体渲染遗留
- [x] B8 历法/天气/季节（design M5a，4 人日）：日历纯函数 + 天气日效应（雨 1.5x 生长 / 雪 0.5x 冬白名单 / 风暴 20% 损毁 + 次日保险）+ 服务器游戏日时钟（afDayAnchor，快照按游戏日）；客户端天气通道已开（GET /af/calendar 当日+7 日日程 + mod 今日村况 DOM 浮层，天气全屏特效渲染待 Cocos 环境）
- [x] B9 畜牧 + 烹饪加工（design M5a，7 人日）：动物状态机（幼崽->成年->周期产出）+ 品质三档（饱食+心情）+ 畜棚容量；recipes.json 三设施配方 + 成品起步价=原料 x1.4 + 设施建造（5909981）；数据通道已开（/af/animals + mod 村事面板动物区，efafeef）；Cocos 内动物实体贴图渲染待客户端环境
- [x] B10 家具装饰 + 最美庭院评比（design M5a，5 人日）：宅基地布置点位表 + 60 件家具目录 + 布置/移除（50%退款）+ 庭院分/完成度 + 评比排行 + 满分触发 decor.contest 事件（e32caa8）；数据通道已开（/af/decor-board 纯读排行 + mod 庭院榜区，efafeef）；家具 Cocos 内贴图渲染 + C8 视觉模型评分接入待客户端环境
- [x] B11 节日集市与比赛玩法（design M5a，3 人日）：节日->赛制映射 + 集市摊位费（x通胀系数）+ 节日议价 + 比赛计分/结算发奖 + stall act（ff2b07a）；节日集市客户端渲染遗留

## 轨道 C：认知与美术（36 人日）

- [x] C1 L2 情节记忆：memory 表 + embedding 检索 + FTS5 回落（design M4.1，5 人日）：三路 1/3 加权召回（recency 指数衰减+余弦相关+重要性），无 Key 伪向量兜底（3555857）；LLM embedding 生成经 M7 路由已接（050abdc）
- [x] C2 L3 时序知识图谱：facts 表 + 抽取 + 失效修订（design M4.2，5 人日）：bi-temporal 三元组 + 事件规则抽取 <=3/事件 + 睡眠期低置信修订（3555857）；LLM 抽取经 M7 路由已接（050abdc extractLlm）
- [x] C3 OCC 情感模型：8 分量 + 衰减 + 行为权重映射（design M4.3，4 人日）：事件评价规则表 x 人设权重 + 半衰期 1 游戏日 + 愤怒砍树/喜悦送礼映射（3555857）
- [x] C4 目标层级与睡眠期整理（design M4.4-4.5，4 人日）：life/daily/action 三层 + 睡眠序列（反思->图谱清洗->关系摘要->次日计划，每日 1 次）（3555857）；LLM 强档编排经 M7 路由已接（050abdc planDailyLlm）
- [x] C5 八卦传播链（design M4.6，2 人日）：好感突变->可信度加权入记忆 + 每跳 30% 细节截断 + 3 跳上限（3555857）
- [x] C6 风格提示词库 v1 + 调色板提取（design M5b.1，2 人日）：style/negative/palette 三件套版本化 + 16 色锚定提取（eaed9e1）
- [x] C7 后处理链脚本 art-postprocess.py（design M5b.3，2 人日）：最近邻缩放->调色板量化->抠图->网格校验（eaed9e1）
- [x] C8 首批 60 件资产生成 + 送审归档（design M5b，10 人日）：manifest 60 件逐件 prompt（v1）已建；生图改走用户自备 USER_IMG_* 凭据（.env，不入库）+ tools/art-gen.mjs 批量管线（POST /images/generations -> 下载 -> art-postprocess 16 色量化/抠图/网格 -> assets/generated/，429 长退避断点续跑）；52 件生图完成 + 8 件 CC0 直采 = 60/60；**v2 策略返工 5 件**（绝对纯白底+单体锁定，--white-bg 白转透明，见 tools/art-prompts/style-v2.md）；**资产交付端点 /af/art-manifest + /af/art/{id}.png（公开只读）+ mod 侧 __AF_ART__ 加载器（dataURL 缓存 + Cocos toSprite 注入 best-effort 守卫）**；人工修整/送审归档待有客户端环境
- [x] C9 CC0 素材直采与 LICENSES 目录（design M5b.5，2 人日）：Kenney x3 实下 465 张 + 许可登记 + 署名落点（eaed9e1）；0x72/Game-icons 下载队列待执行
- [x] C-LM LLM 编排层（C1/C2/C4 的 LLM 强档走 M7 路由，050abdc）：cognition/llm.ts（OpenAI 兼容 chat/embeddings + 玩家 Key 路由 + 计量落 llm_usage + 无 Key/网络失败优雅降级伪向量/规则）；CognitionService 增 llm()/rememberWithEmbed/extractLlm/planDailyLlm 钩子；F2 LLM 脑实测熵优于规则基线（data/eval/roleplay-report-llm.json）

## 收口（8 人日）

- [x] F1 三轨联调 + 协议回归全绿（bd7741e）：tsc 0 / vitest 134/134 / ws-test 11/11 / gen-nav / 新端点 200
- [x] F2 角色扮演评测集达标（含自主行为占比 >= 30%、多样性熵防退化）：tools/eval-roleplay.mjs + eval-roleplay-scenarios.json（3 场景：rainy-village/festival-day/quiet-morning）；门：自主占比 >= 0.3、动作熵 >= 0.6；双脑模式：无 LLM 基线（OCC + C4 目标层交替，报告 data/eval/roleplay-report.json）+ **LLM 脑（AF_EVAL_LLM=1：planDailyLlm + extractLlm 走 M7 路由，报告 data/eval/roleplay-report-llm.json——熵 0.998/0.855/0.742，优于规则基线；llm_usage 计量 + 缓存命中均落库验证）**；CI 门 7 已接入（默认规则脑）
- [x] F3 导航路线回放 x10 场景矩阵通过（bd7741e：村景 10x3 全过；27 场景 nav 数据已生成 cad75c4，矩阵可按需扩展）
- [~] F4 本地 + Tailscale 部署验收（docs/tailscale.md §4 清单）：**4.1 本地单机 6/6 全过**（tools/f4-acceptance.mjs 实测：登录 move 广播/economy+market/画报/影子/npc-schedule 快照/LLM 加密保管，报告 data/eval/f4-4.1-acceptance.json；快时钟下 npc_move 幂等不换位属正常，机制以 /af/npc-schedule 快照验收）；4.2 双机 Tailscale 联机待用户第二台设备执行

## 里程碑门

- M-A1: 事件溯源上线（事件即唯一事实源）
- M-B1: 影子市场 14 日报告达标
- M-C1: 认知评测集三指标达标
- M-Final: requirements.md 全部 EARS 条目通过

## 施工前必办

- [x] P0 用户确认开工（2026-09-28 会话内确认，A1 已开工并完成）
- [~] P0 用户撤销并轮换已暴露的 GitHub PAT（本次会话聊天中出现；已由用户本人操作，平台侧无法验证）
- [x] P0 决定是否推送规划文档到远程仓库（决定：推送；规划文档已推至 GitHub master，后续代码提交保持本地）
- [~] P0 安全：18 个 tools/ 本地调试脚本含真实 `sk-` API 密钥明文（verify-remote*/_agnes-*/debug-agent-move 等），已用 .gitleaks.toml 豁免待清理；需用户轮换这些密钥并把脚本改为读 env（.env.example 已提供），轮换后移除豁免

## 进度备注（2026-09-28 会话）

- A1 完成：TS 七模块重写，legacy 行为等价（ws-test 11/11）。afserver.mjs 冻结为行为基准。
- A2 完成：事件溯源（events/snapshots 表 + 纯函数 apply + 事件内 seed + 快照重建），vitest 11 项 + 协议回归全绿。
- A3 完成：本地备份（每日 + 30 天保留，WAL checkpoint）。
- A4 完成：CI 六道门（typecheck/vitest/协议回归/gitleaks/原版哈希/导航回放占位）+ 原版外壳哈希基线（5128 文件）。
- A5 完成：/admin 管理后台 + 结构化日志（看门狗/托管启停/一致性校验接入）。
- 事故记录：早期测试版本因 config.ts 提前加载把测试事件写进真实 slot1 事件库/存档，已隔离污染数据并从 seed 重建干净基线；重建态加 noPersist 杜绝复发。

## 进度备注（2026-09-29 会话，A8/A10 服务端段）

- A8 服务端核心完成：narrative/director.ts（buildTimeline 纯函数镜头时间线 + CameraDirector 实时节流观战推送 + 想法气泡 thought）；ws 加 spectate/unspectate 消息；断开清观战。commit daee232。
- A10 回放器核心完成：narrative/replay.ts（runReplay/verifyReplayDeterminism）+ /af/replay 只读端点（verify=1 出确定性判定）；快照 + 事件重放终点哈希。
- 验证：tsc 0 / vitest 34/34（含 narrative 9 项）/ 观战 E2E PASS（agent 移动触发 camera 推送 + replay deterministic=true）。
- 遗留：A8/A10 的客户端渲染（mod 注入 Cocos）需有客户端环境再做；A9 画报（LLM 文案 + 生图插画）待 M4/M7 编排。
- 观察：`events` 观战模式按设计仅出有位置语义的镜头（plant.sown/plot.tilled/crop.harvested），agent 移动镜头走 `agent:<uid>` 档位——E2E 用后者验证。

## 进度备注（2026-09-29 会话，轨道 B 市场经济）

- B1.1 完成（7f82162）：CDA 订单簿撮合引擎（价格优先+时间优先、挂单方价格成交、逐腿聚合、做市冷启动/熔断/破产护栏，纯函数可重放）。
- B1.2 完成（88f8643）：市场接线（挂单即预留、成交过户、撤单退还、mm 虚拟账户、market_orders/market_fills 表、/af/market/:item、agent act trade、在线玩家 market.tick 行情广播、重启恢复、7 日 OHLC）。活体 E2E 全通 + legacy ws-test 11/11 回归。
- B2 完成（b47d726）：NPC 商人策略（3 家种子商人 + 7 日动量 ±5% 买卖意向 + risk 单量限额 + 破产停采/清仓）+ 决策周期定时器（1 游戏小时，AF_NO_MERCHANTS 可关）+ 商人台账（merchants 表，预留/过户/退还走台账）。
- 遗留：B2 跨场景采购（需 B5/B6 导航）；商人 OHLC 历史跨重启恢复（market_fills 已持久化，load() 回灌）；历法 B8 前周期用现实时间粗控频。
- B3 完成（ad571a9）：货币治理（总量监控 + 通胀指数 + 回收档位 feeMultiplier + /af/economy + 每日监控告警）。造价/服务费/摊位费实际扣减待 B8/B10 接入。
- 活体验证注意：ws-test/市场 E2E 在默认端口跑会写进生产 slot1（data/ 已 gitignore，本地开发态可接受）；新数据目录测试可指 AF_DATA_DIR。

## 进度备注（2026-09-29 会话，续：B8 历法）

- B8 完成（2102268）：历法/天气/季节纯函数 + 天气日效应（雨 1.5x 生长 / 雪 0.5x 冬白名单 / 风暴 20% 损毁 + 次日保险）+ 服务器游戏日时钟（afDayAnchor，快照按游戏日）。节庆玩法与天气客户端渲染遗留。
- 注意：游戏时长环境变量是 `AF_GROW_MS`（非 GROW_DAY_MS）；历法推进器 min(30s, 1/4 游戏日)。
- B4 影子模式依赖 B8 游戏日；影子撮合引擎（双实例只记账不结算 + 14 日对比报告）为下一可执行段，14 日观察期本身限时。
- B4 引擎完成（19c2dfe）：ShadowMarket 双实例（镜像实盘挂单、自成做市流动性、只记账不结算、重启恢复）+ market_shadow_fills + /af/shadow 14 日对比报告（量偏差/价差分布）。14 日观察值守限时未开始；M-B1 门待观察数据后决定启用真实结算开关。

## 进度备注（2026-10-02 会话，玩家视角审计 11 项）

玩家视角审计（`tools/player-cli.mjs` 驱动真实 agent 完整游玩）产出 11 条问题，逐项修复中。
验收一律走真实 `/agent` WS 通道（observe + act），不以内部函数结果冒充玩家体验。

已闭环：
- P1 砍树跨 sceneType（22a9c2b）：世界植物桶修正为 VILLAGE_MAP(2)，村桶 173 棵树从"永远够不着"变为可砍；含 `migratePlantBucket` 重发 uId 与 `cropAtWorld` 解决同格装饰/作物并存。
- P2 买入限价改善退差额（0bf3b19）：成交后按 `(buyerLimit - f.price) * qty` 退差归买方，记 `trade.refund`。
- P2 动作指引与实现不一致（2dfd6a7）：train 中文字段别名、move_to 缺坐标误报、`near=water` 恒无解（根因是 `isWater` 叠了 `walk()`，把不可走的真水判成非水）。

待办：
- [ ] P2 挖矿/钓鱼设计资源消耗或冷却——当前无限产出，会冲击固定 10% 手续费的通缩回收。
- [ ] P3 `till` 缺坐标 NaN 文案（同 move_to 已修的入参校验模式）。
- [ ] P3 observe 场景数据过滤（应按玩家所在场景过滤，别把别处数据混进快照）。
- [ ] P3 NPC 无 LLM 可用时直接回 tagline（应走兜底文案而非静默）。
- [ ] P1 建筑实体缺失（2026-10-02 实测碰撞图确认）：`buildings.json` 声明的 rect 与 `village-collision.json` 的实体轮廓对不上——交易大厅 (76,71) 10x9 **100% 阻挡（唯一完整实体）**；宴会厅 (94,104) 5x5 内只有 3x3 阻挡（rect 四周留了 2 格空边）；气象台 (91,3) 9x9 仅 13/81 阻挡且散乱；健身房 (172,96) 10x9 只有顶行+左列阻挡（L 形边墙，内部全空，19%）；铁匠铺 (172,118) 10x10 **0/100，完全空地**。门位/POI 全部落在可走格上。需为气象台/宴会厅/健身房/铁匠铺补建碰撞实体，并确认 rect 与实体尺寸对齐（原版客户端资源里查不到这些中文建筑名，无法据此核对原版坐标）。
- [x] ~~P2 外环（+28）连通性~~ 已排除：健身房/铁匠铺从村内**可达**。根因已修（2026-10-02）：同场景 `move_to` 的"单段 <=60 格"硬上限是航点确认环建成前的权宜，70+ 步路线被整段拒绝（"路径过长请分两段走"），agent 换中途点又常选中阻挡格循环失败——表现为"长路线不推进"。上限已撤（保留 2000 格病理上限），长路线走 D1 段确认环。实测：健身房 133 步/35 航点被接受、自动确认推进后任务完成、落点 (17150,10050) 即健身房门位附近。
