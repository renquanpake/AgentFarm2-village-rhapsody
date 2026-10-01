# 项目记忆（AgentFarm2 服务端）

> 供后续会话快速上手。只记"怎么做/怎么跑/怎么排障"，不记"做了什么"。

## 运行与部署（Operations & Deployment）
- 正式服务端入口：`cd server && node src/index.ts`（`npm start` / `npm run dev` 同义）。
- 平台 git credential helper 偶发 500：push 失败先间隔重试几次；持续失败就留本地 commit 继续干活，恢复后再推，勿改 remote。
- Node 22 原生直接跑 TS（type stripping），**无构建步骤**；`afserver.mjs` 是冻结的 legacy 行为基准，勿再改。
- 常用环境变量：
  - `PORT`（默认 8080）、`AF_SLOT`（存档位 1/2/3，默认 1）
  - `AF_NO_TUNNEL=1` 关自动内网穿透；`AF_NO_GIT=1` 关 git 自动备份（测试/本地必开）
  - `AF_WS_HEARTBEAT_MS=2000` 测试时缩短心跳；`AF_ADMIN_TOKEN=<x>` 管理后台口令
  - `AF_AES_KEY=<32字节hex/base64>` 启用玩家自带 LLM Key 的 AES-256-GCM 保管（不开则 M7 降级运行）
  - `AF_DATA_DIR` 把数据目录指到持久卷（容器）
  - `AF_GROW_MS=<ms>` 游戏日长度（默认 10 分钟；**不是** GROW_DAY_MS）；商人/NPC/畜牧/历法周期都按它折算
  - `AF_NO_MERCHANTS=1` 关商人/经济定时器；`AF_NO_NPC_SCHED=1` 关 NPC 日程/畜牧产出定时器（活体冒烟测试建议全开隔离）
- 运行时数据都在 `data/`（部分 gitignore）：存档 `data/saves/slotN/`（world.json + meta.json + events.db），账号 `data/accounts.json`，备份 `data/backups/`；`data/nav/`（gen-nav 生成）、`data/decor.json`、`data/recipes.json`、`data/art/manifest.json`（美术生产清单）为跟踪数据。

## 构建与验证（Build & Test）
- 类型检查：`cd server && npx tsc --noEmit`（tsconfig strict + erasableSyntaxOnly，禁用 enum/namespace/参数属性）。
- 单元/事件溯源/M7 测试：`cd server && npx vitest run`（在 `server/test/unit/`，当前 141 项）。
- 协议回归：起服务 `AF_NO_TUNNEL=1 AF_NO_GIT=1 AF_WS_HEARTBEAT_MS=2000 node src/index.ts`，另跑 `AF_BASE=http://127.0.0.1:8080 node server/ws-test.mjs`（应 11 项全过）。
- 导航门：`node tools/gen-nav.mjs --check`（村景锚点可达 + 56 条跨场景门户吸附）+ `node tools/nav-replay.mjs [--smoke|--drift]`（27 场景 210 例，drift=偏差重规划）+ E2E `AF_BASE=... node tools/e2e-nav-arrive.mjs`（14 项，测试服务 `PORT=8091 AF_SLOT=9 AF_NAV_ARRIVE_MS=1200`）。
- CI 八道门见 `.github/workflows/ci.yaml`（门8=旗舰UI 静态+冒烟：`tools/ui-lint.mjs` 三静态门 + `tools/ui-smoke.mjs` 17 项模块逻辑冒烟，无浏览器可跑；Cocos 实机反射归 N2）；原版外壳哈希基线 `client/original-hash.json`（`node tools/hash-manifest.mjs [--check]`，mod 层豁免）。
- 美术管线（C6-C9）：`tools/extract-palette.py`（16 色提取）+ `tools/art-postprocess.py`（量化/抠图/网格校验，需 Pillow）+ `tools/art-prompts/`（v1 基础 + **style-v2.md 现行铁律：纯白底+单体锁定**）；CC0 素材在 `assets/cc0/`（Kenney 三包 465 张）；生图走 agnes API（`tools/art-gen.mjs` + .env 的 USER_IMG_*，用户自备 Key）。

- **市政路网 P1a（2026-10-01，d027ba9）**：新增门禁 `node tools/check-roads.mjs`（连通档全图判死 / 相交档村景判死、卫星 P1c 随碰撞提取告警 / 双源档村景判死：老区路格 = shilu 提取∩可走，diff 0；端点锚点 = 他路∪地标∪门户∪房屋门∪地图边界 3 格带）。流水线顺序：`build-shilu.mjs`（村 shilu 掩码，与 build-collision 同解密解法）→ `data/roads.json`（村 37 段=25 shilu 宽1 精确复刻+12 环内市政段；12 卫星进场路）+ `data/landmarks.json` → `gen-nav.mjs` + `build-scene-collisions.mjs`（写 kind=4/roadIdx 进 nav-*.json）→ `check-roads` + `nav-replay`（成本比基线 `data/nav/replay-baseline.json`，g 比 ≤1.1；改 hpath 塑形/road 数据后基线作废需重录）。已知豁免：村广场中心 3 格 = 原房层压石板（房叠 shilu），applyRoads 跳过 + 相交档 shiluExempt，属设计内非违规。gen-nav 不再写 portals.json（权威源 = build-scene-portals，全量 56 条）。
- **市政路网 P1b 数据/功能层（2026-10-01，f95bec6；L2+L3 落地，L1 路牌画面/P1d 生图未做）**：指引三层的服务端+客户端功能侧——`/af/mapgrid` 响应增 `roads/landmarks/signs`（小地图 L2 数据源，村景 37 路 12 地标 6 牌）；`state`（observe）增 `municipal`（L3：`onRoad` 当前路名 roadOf 反查 + `nearest` 最近地标方位/距离，agent 离地标 >30 格时合理为 null）；`move_to` 同场景 A* 长移动结果增 `road`（路线主路名）；客户端小地图 `afMapRoads/afMapLandmarks` 双覆盖层（路=浅色线、地标=按 type 色盲安全简笔）+ `#af-map-layers` 显隐开关（AFUNI.on 三态 + `localStorage af.map.layers`）。`server/src/navigation/municipal.ts` = 市政数据 mtime 缓存加载 + villageNavOf + municipalContext 纯函数（observe 用，不碰 ws 运行路径）。`tools/scene-walls.mjs` = 场景碰撞/水层提取单一源（check-roads 与 build-scene-collisions 共用，口径含 never 层；改提取逻辑两处同步）。check-roads 已挂 CI 门6。
- **P1c 卫星碰撞源提取（2026-10-01，573d895）**：`scene-walls.mjs` 语义层回退——collide 空时按层名精确匹配提阻挡（fanzi/dik/huaiqiao/lieheng/barrir/bianyuan）+ 水层（含 "shui" 正则 + wenquan），每层全满遮罩防护；**shanding 山层 shan 不入表**（门户可达性 BFS 验证：其两门户在 8 格山体带内，标阻即断门户，原版山体即可走）；歧义地形（suodao xiatukuda 44% 密集带、migon shiqian 满幅）保持可走。check-roads 相交档 P1c 起全场景判死（有碰撞/水数据即查，无数据恒 0）；build-scene-collisions 状态三分：ready / ready-water-only（仅水层）/ ready-empty-collide（无数据需核验）。
- **P1d 市政生图 + P2 建筑功能层（2026-10-01，573d895）**：manifest 301-311（市政小件 6 + 建筑 5，v2 纯白底 `--white-bg`，免费档 `--concurrency 1 --gap 20 --retry 5`；建筑 288x384/384x288 走 art-gen apiSize 映射 512x768/512x512）；`data/municipal-decor.json`（村景 18 件，格坐标经可走校验）+ `/af/mapgrid.decor/buildings` + 客户端 `injectMunicipalDecor/injectBuildingSigns`（挂村景 TiledMap 节点，lx/ly 与 injectBlockers 同公式，1s tick 幂等）；`data/buildings.json` 统一 7 建筑（C1 交易大厅 = 中央空房 (48,43)-(57,51) 定稿；银行/邮局 A 挂牌 102 gfujia / 109 laott；4 B 覆盖件 pending 随 +28 环）；`move_to {near:"建筑名"}` 自动跨场景解门户到门位（`buildingTargetOf` 模糊匹配，不可解析时回可用名清单）；act `letter {to,body}` 走 notes.pushInbox 持久化 + `/af/letter` 只读收件箱 + `/af/buildings?scene=N`；observe state 增 `buildings` 区域（同场景已落成建筑门位+切比雪夫距离）。经济钩子（匹配/计息/投保/开摊）默认关，M-B1 影子窗结束后开启。
- **P3 相机/边界 spike 结论（2026-10-01）**：原版 Cocos 相机钳制 `updateCameraPos` 用 `sceneSize = tiledMap.getMapSize()×tileSize`（client/assets/main/index.e6d95.js @1811059/1809344）——**钳制随 TiledMap 资产尺寸自动扩展，+28 环（133→189）零相机代码改动**；风险收敛到 TMX 资产重烘（expand-village-map 管线）+ 1-2 个 hash 基线文件变更（文档化）。
- **e2e-nav-arrive 运行要求（2026-10-01）**：21 项（含 P2 场景 E），必须带 `AF_NAV_ARRIVE_MS=1200` 起测试服（盲推节拍，否则 B/C「走完 done」时序级联失败）；`AF_BASE=http://127.0.0.1:<port> AF_SLOT=<slot>`。
## 排障要点（Troubleshooting）
- **测试隔离**：`config.ts` 在模块加载时读 `AF_DATA_DIR`。单测必须直接构造 `WorldState`/`EventLog`（临时目录），**不要**在单测里 `new App()`（会把测试夹具写进真实 `data/saves/`——曾发生，已隔离）。
- **回放态禁落盘**：`rebuildState`/`fromSnapshot` 的重建态必须 `noPersist:true`，否则一致性校验会把回放结果写进生产存档（已修）。
- 事件库按存档位隔离：`data/saves/slotN/events.db`；切档即换库。`events` 表 seq 单调递增，崩溃后 `EventLog.init()` 读回 MAX(seq) 续增。
- `structuredHash` 只覆盖"事件拥有"的结构化域（plant/farm/sprinkler/social/afTasks/agentPos），自由桶（mapData/playerData/knapData 等客户端可覆写）不参与——启动一致性告警属正常诊断，非错误。

## 施工进度与续作（Workflow）
- 当前进度与任务清单：`.monkeycode/specs/agentfarm2-playability-upgrade/tasklist.md`（先读它确认，再读同目录 requirements.md / design.md）。
- 已收口：A 轨全量 + B 轨全量（B1-B11）+ C 轨认知栈 C1-C5 + 美术管线 C6/C7/C8/C9（C8：52 件生图 + 8 件 CC0 = 60/60 闭环）+ C 轨 LLM 编排层（llm.ts 走 M7 路由，规则兜底）+ F1/F2/F3/F4（评测集、导航回放、Tailscale 验收清单）+ 进化书 D1-D7/D9/D10/D11 收口 + 旗舰美化 M1-M5 代码侧（tokens/AFUNI 组件/particles/atmosphere/audio + 日历驱动接线 /af/calendar hour 字段）。vitest 141 项全绿。
- C8 生图管线（运维）：`tools/art-gen.mjs` 批量生成（`.env` 的 USER_IMG_* 用户自备凭据，gitignored；`assets/generated/` 量化产物入库，`data/art/raw/` 原图不入库）。模型：agnes-image-2.5-flash（512x512 / 512x768 非方形）。**免费档分钟级 429：大批量用 `--concurrency 1 --gap 20` 慢跑；高并发会触发限速**（429 退避 30s x 次数已内置）。
- C8 生图 v2 铁律（`--white-bg`，详见 tools/art-prompts/style-v2.md）：文生图模型做不出透明底，提示词必须"绝对纯白底 #FFFFFF 铺满 + EXACTLY ONE 单体锁定"；后处理 `--white-bg` 边界连通近白(>=250)转透明。"transparent background" 写法已证伪（v1 彩底残留 5 件）。
- 遗留与路线图：**以 `docs/全方位旗舰进化书.md` 为单一权威源**（12 债务 D1-D12 + 6 缺口 N1-N6 + 五阶段路线 + 验收总纲），本文件不重复维护进度清单，避免双处分叉。
- 真实原版精灵 PNG 在 `server/public/client/sprites/`（约 900 张，调色板提取源）；`client/assets/**` 的 Cocos 原生 PNG 是压缩二进制，PIL 读不了。
- 新增 HTTP/WS 路由：加到 `server/src/gateway/http.ts`（HTTP）与 `gateway/ws.ts`（WS 双通道 /ws 游戏 + /agent agent），协议走 `gateway/protocol.ts` 的 zod（act 消息 passthrough，新字段无需改协议）。
- **act/trade 消息只走托管 /agent 通道**（token=账号 agentToken）；/ws 游戏通道发 act 会被静默忽略（B4 流量驱动踩坑：0 成交）。/agent 升级 URL 必须显式 `ws://host/agent?token=`（连根路径会被 socket.destroy 报 "socket hang up"）。
 - 验收/观察工具：`tools/f4-acceptance.mjs`（F4 4.1 六项，服务端需带 AF_AES_KEY 过 LLM 项）；`tools/shadow-observe.mjs`（B4 影子 14 真实日观察流量驱动+报告，M-B1 门窗口=now-14d 不可快时钟压缩；支持 `--days` 参数，活体验证用默认 1、判门复查用 14）；`tools/art-qa.mjs`（C8 60 件自动终检）；`/af/npc-schedule` 快照端点（快时钟下游戏时恒 21-23 时段 NPC 幂等不换位，npc_move 实机观察需 AF_GROW_MS=600000 生产日钟 ~13 分钟首个换时段）。
 - 影子引擎 D8 根因修复（2026-09-30）：mm-shadow 报价锚点改实盘 best bid/ask（默认 0 价差紧镜像）+ 按深度缺口补挂（旧「有成交即停挂」是漏量根因之一）。**引擎行为变更 → 观察窗作废重计**：生产 8080 重启加载新引擎后重跑 `tools/shadow-observe.mjs` 记新起点，14 日后 `--days 14` 判 M-B1 门（旧 2026-09-29T14:33Z 起点作废）。

## 工作模式（Workflow & Collaboration，用户指令）
- **资源获取策略（2026-09-29 用户明确指示，长期生效）**：需要图片素材就上网搜（图片搜索）或自己生图（tools/art-gen.mjs 管线），双通道保供；对图片质量要求严苛——按 C8 v2 铁律（纯白底+单体锁定+量化+art-qa 机审）与授权合规把关。**入库素材优先级：生图产物（风格可控）> CC0 素材包（Kenney 已有 465 张）> 网络搜索（仅作参考/概念图，直接入库须逐张核授权）**。其他资源同理：缺任何东西（音源/字体/数据/依赖/参考资料）就去上网搜，不空等不空想。
- **提交前安全审查（2026-09-29 用户明确指示，长期生效）**：每次 git commit 前必须先跑 `node tools/security-check.mjs`（默认扫暂存区；`--all` 扫全仓），PASS 才允许提交。检查项：敏感文件（.env/.env.local/*.pem/*.key 等）禁止入库 + 机密内容规则（sk- 密钥/GitHub PAT/GitLab PAT/AWS/Slack/私钥块/凭据赋值长串，占位符豁免）。首跑即抓出 4 个存量文件硬编码本地 agentToken，已按 P0 模式修复（脚本改读 AF_AGENT_TOKEN，观察记录脱敏 ***REDACTED***）。
- **分工模式（2026-09-29 用户明确指示，长期生效）**：会话主模型负责对话、规划、拆解、审查、验收；具体写代码等执行类工作，先把任务规划好再委托 agnes-3.0-flash 执行，节省主模型额度。委托通道：`tools/llm-worker.mjs`（`echo 任务 | node tools/llm-worker.mjs`，或 `--in/--out` 文件进出；Key 走 .env 的 AF_LLM_*/USER_IMG_* 用户自备 Key，模型缺省 agnes-3.0-flash）。
- **代码自审（2026-10-01 用户指示：每批工作完自审）**：`alibaba/open-code-review` 已装（npm 全局 `@alibaba-group/open-code-review` v1.12.11，CLI `ocr`；PyPI 无此包）。流程：`ocr delegate preview --from <base> --to <head>`（可审文件清单）→ `ocr delegate rule <files...>`（系统规则集，免 LLM）→ 宿主 Agent 对 diff 逐条套规则，产行级意见分三档（必须修复/建议修复/可以忽略）；必改项修完跑回归再提交。全自动行级评论 `ocr review` 需用户提供 LLM 端点（URL/token/model，平台自身 key 禁止接入）。git 2.39.5 低于其最低支持 2.41.0，有 warning 不影响运行。
- 委托注意事项：flash 小模型无工具/仓库访问能力，prompt 里必须打包所需代码上下文；输出有"自言自语纠错"倾向（先写错再自行输出干净终版），主模型必须审查后取终版集成；适合独立函数/单文件脚本/文档/测试草稿等边界清晰任务，多文件重构与调试类主模型自己做更划算。

## 安全（P0，需用户操作）
- 17 个 `tools/` 调试脚本明文 sk- **已改读 env**（tools/env.mjs + .env.local，gitignored；a0f6dc6）；.gitleaks.toml 文件级豁免已全部移除。**密钥仍在 git 历史与 .env.local——用户需轮换 AGNES_API_KEY/DEEPSEEK_API_KEY 后更新 .env.local 才真正闭环**。
- 本次会话出现过的 GitHub PAT 应由用户撤销（含 2026-09-30 用户在聊天中直接提供、用于绕开故障凭据服务完成推送的那枚 ghp_ 开头 PAT——聊天暴露即视为泄露，尽快轮换；本地 /root/.git-credentials 已删除）。
- 2026-09-29 用户在聊天中提供过 agnes-ai Key（.env 的 USER_IMG_* 与 AF_LLM_*，未入库）；该 Key 已在会话中暴露，**建议轮换**后更新 `.env`/`.env.local`。
- 服务端自身零池化 LLM 密钥；玩家 Key 经 `AF_AES_KEY` 派生的 AES-256-GCM 加密保管，接口永不回显明文。
