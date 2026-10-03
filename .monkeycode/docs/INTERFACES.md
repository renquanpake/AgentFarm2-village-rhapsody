# 接口文档

## 接口总览

AgentFarm2 单端口 8080 同时承载四类接口：

| 类型 | 路径 | 鉴权 | 使用者 |
|------|------|------|--------|
| HTTP | `GET/POST /af/*` | 玩家 token（query/body） | 客户端注入层 |
| HTTP | 静态文件（`client/` 下） | 无 | 浏览器 |
| WS | `/ws` | join 时带 uid+token（游客放行） | 玩家客户端 |
| WS | `/agent?token=<AGENT_TOKEN>` | agentToken（`/af/agent-token` 生成） | LLM Agent 程序 |
| CLI | `tools/game-agent.mjs` | `--token` | 运维/Agent 接入 |

所有 HTTP 响应带 `Access-Control-Allow-Origin: *`（浏览器直连房主服）。

---

## 1. HTTP API（/af/*）

### 1.1 账号

| 端点 | 方法 | 参数 | 响应 |
|------|------|------|------|
| `/af/register` | POST | `{username, password}`（2-16 位字母数字中文，密码≥4） | `200 {ok,token,uid,nick}`；`409 exists`；`429`（注册限流：全局 5 次/秒） |
| `/af/login` | POST | 同上 | `200 {ok,token,uid,nick}`（每次登录换新 token）；`401 bad login` |
| `/af/me` | GET | `?token=` | `{ok,uid,nick,username}`；`401` |

密码存储：`sha256(salt + '::' + password)`，salt 8 字节随机；`accounts.json` 存 `{username: {salt, hash, uid, nick, token, agentToken, createdAt}}`。

### 1.2 存档与房间

| 端点 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/af/save` | GET | `?uid=&token=` | 权威存档：`{version:4, datas:[{key,val}], _af:{spawns}}`。world 桶 key 重写为 `{name}_{uid}`，玩家桶取该 uid 那份，global 原样；跳过复合污染 key（`_[a-z][0-9a-f]{6,}` 类） |
| `/af/saves` | GET | 无 | 3 个存档位列表：`{currentSlot, saves:[{slot,name,exists,playerCount,createdAt,lastPlayed}]}` |
| `/af/saves/rename` | POST | `{token, slot, name}`（≤20 字） | 设置存档名 |
| `/af/switch-slot` | POST | `{token, slot}`（1-3） | 房主切档：`persist()` 旧档 → 清全部内存运行时状态 → 重载新档 → 踢掉所有在线连接（`kicked` 后 300ms terminate）→ 更新路径变量 |
| `/af/room` | GET | 无 | `{roomCode, tunnelUrl, localUrl}`。`localUrl` 跟随 `req.headers.host` + 请求协议（容器/隧道/本地开发自适应）；无隧道场景两者为 null，前端整块隐藏 |
| `/af/join-room` | POST | `{code}`（6 位） | 房间码 → 公网地址 `{ok, url}`；无效 `404` |

### 1.3 在线与查询

| 端点 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/af/players` | GET | 无 | 在线玩家：`[{uid,nick,scene,x,y}]` |
| `/af/agent-status` | GET | `?token=` | 该账号 Agent 托管状态 `{online, nick}` |
| `/af/mapgrid` | GET | `?token=` | 地图网格（扩展小地图用）：`{W:105,H:89,water,blocked,houses,LEFT,TOP,origW:77,origH:61}` |
| `/af/diary` | GET | `?token=` | Agent 日记列表：`{username, days:[{file,title,content≤3000}]}`（读 `data/agent-notes/<账号>/日记/`，只读） |

### 1.3.1 文本无障碍与运营面（2026-10-03 新增，均需 token）

| 端点 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/af/mapdoc` | GET | 无（公开） | 全村文本地图（LLM 自规划路线的唯一依据） |
| `/af/notices` | GET | `?since=`（公开） | 公告环形缓冲；`lastSeq` 供增量拉取 |
| `/af/economy-design` | GET | `?token=` | **N10 经济总账**：`crops[]`（每种作物设计 seedCost/sellPrice/roi/hourlyAt8Plots + 实盘成交中位与偏离）、`inflationTarget`、`fees`、`gather`、`alerts` |
| `/af/metrics` | GET | `?token=` | **N8 里程碑度量**：`players{total,activeToday,played2h,retainedD1,retainedD7,medianPlayMs}`、`funnel[]`（引导 10 环到达率）、`actions`（动作分布）、`content`、`headline.canJudge100_30_10` |
| `/af/save-version` | GET | `?token=`（或 AF_ADMIN_TOKEN） | **N11 存档治理**：`current` / `saveVersion` / `pending[]` / `plan[]`（迁移注册表全量） |
| `/af/llm-usage` | GET | `?token=` | 用量 + `budget{limit,usedToday,ratio,warn,tripped}`（N12 熔断闸状态） |
| `/af/decor-board` / `/af/daily-report` / `/af/replay` / `/af/npc-schedule` / `/af/animals` / `/af/buildings` | GET | 视端点 | 既有文本面（见各 spec） |

鉴权矩阵（路径 × token × uid 归属）由 `tools/auth-matrix.mjs` 生成到 `docs/鉴权矩阵.md`，CI 门12 判定。

### 1.4 Agent 托管

| 端点 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/af/agent-provider` | POST | `{token, url, model, key?}` | 配置 LLM（OpenAI 兼容）；key 留空保留旧 key；热更新运行时变量（新 spawn 的 Agent 生效）；GET 返回脱敏（仅 `keySet` 布尔） |
| `/af/agent-token` | POST | `{token}` | 生成/返回 agentToken + `ws://host/agent?token=...` 完整接入地址 |
| `/af/agent-control` | POST | `{token, action: "start"|"stop"}` | 托管 Agent 启停。start：需 `AF_LLM_URL/KEY` 已配，spawn `tools/game-agent.mjs --token <agentToken> --rounds 999999 --notes data/agent-notes/<账号>`，env 注入 LLM 三件套；重复 start 拒绝；stop：kill 子进程 |
| `/af/agent-setup` | POST | `{token, personality, name, playstyle?, phrase?}` | 生成人设 `agent.md`。预设性格 6 种（活泼开朗/沉稳寡言/好奇宝宝/热心肠/守财奴/自由灵魂），也可自定义字符串 |
| `/af/dev/give-coins` | POST | `{token, amount?}` | 测试用：给玩家加金币（id=1，默认 5000）。**上线前 `AF_DEV_ENDPOINTS=0` 关闭** |
| `/af/dev/give-item` | POST | `{token, itemId, amount?}` | 测试用：给玩家加物品。同上可关 |

---

## 2. WS 玩家通道（`/ws`）

鉴权：`join` 时注册账号 uid 必须携带当前 token（防冒名接管），游客 uid 放行。心跳：服务端每 `AF_WS_HEARTBEAT_MS`（默认 30s）ping，未回 pong 的 dead 连接 terminate。`maxPayload` 8MB。

### 2.1 客户端 → 服务器

| t | 字段 | 说明 / 限流 |
|---|------|------|
| `join` | `uid, nick?, scene?, x?, y?, token?` | 进服。回 `welcome`（在线列表）+ `agent_status`；同 uid 旧连接收 `kicked` |
| `save` | `kv: [[key, jsonValue]...]` | 存档推送（客户端防抖后）。滑窗 5 条/秒，超丢；单条 ≤1000 key；单值 ≤512KB；拆桶入 world/player/global；`socialData` 忽略客户端回推（服务器权威键）；世界键被触碰 → 打 agent 中断 + 500ms 合并广播 |
| `move` | `scene, x, y` | 位置同步。滑窗 12 次/秒；坐标必须有限数 ±1e6；广播给其他玩家 |
| `chat` | `text`（≤200 字） | 全服广播（含 agent 连接可见）；滑窗 3 条/秒，超出回 `chat_warn`；进 `CHAT_LOG`（cap 50） |
| `social_talk` | `target, text` | 附近对话（曼哈顿距离 ≤5 格，同场景）。好感 +2；首次见面解锁 DM + 系统公告 |
| `social_give` | `target, itemId, num`（≤99） | 附近送礼。扣背包 → 加对方背包；好感 +`giftFavGain`（5~20，知己/伴侣翻倍）；解锁 DM；全服系统消息 |
| `social_fav` | `target` | 查询双向好感与关系 |
| `social_bind` | `target, type`（friend/confidant/partner） | 绑定关系，需好感达 30/60/90；全村公告 |
| `social_unbind` | `target` | 解除关系 |
| `social_tp` | `target` | 伴侣专属传送（好感≥90 且同场景），落到对方 ±200px 非障碍格，回 `social_tp_apply` |
| `task_list` | 无 | 返回 10 项任务书进度（`task_done` 完成时推送） |
| `agent_msg` | `text`（≤500） | 给 Agent 发指挥消息（进持久化收件箱，**不打断** Agent 当前行动） |
| `dm_send` | `target, text`（≤500） | 1:1 私信，需已解锁 DM；持久化 + 在线实时推 |
| `dm_log` | `target` | 查最近 50 条私信 |
| `dm_unlocked` | 无 | 查已解锁私信对象列表 |
| `agent_interrupt` | 无 | 显式打断 Agent 当前行动（等同玩家操作） |
| `agent_resume` | 无 | 恢复 Agent 原计划（推 `agent_resume` 给 Agent socket + 全服活动公告） |

### 2.2 服务器 → 客户端

| t | 说明 |
|---|------|
| `welcome` | join 成功 + 在线玩家列表 |
| `join_deny` | 账号校验失败（4001 断连） |
| `kicked` | 被顶号/切档踢下线 |
| `player_join` / `player_leave` | 其他玩家上下线 |
| `move` | 其他玩家位置（`uid, scene, x, y`） |
| `agent_move` / `agent_move_done` | 自己 Agent 的逐步移动 / 完成（驱动 playerNode 平滑动画） |
| `save_broadcast` | 他人存档变化（500ms 合并，同 key 取最新） |
| `chat` | 聊天消息（`uid='sys'` 为系统公告，`isAgent=true` 为 Agent 发言） |
| `chat_warn` | 发言过快提示 |
| `social_result` / `social_in` | 社交操作结果 / 收到的社交互动 |
| `dm_in` / `dm_result` / `dm_unlocked_list` | 私信收到 / 结果 / 解锁列表刷新 |
| `task_done` | 任务书完成 + 奖励已入背包 |
| `agent_status` | 自己 Agent 在线/离线 |
| `agent_activity` | Agent 活动状态条（"正在种地/赶路中…"，3s 节流） |
| `agent_resume` | Agent 恢复行动信号 |

---

## 3. WS Agent 通道（`/agent?token=<AGENT_TOKEN>`）

Agent 接入（外部程序或托管 spawn）。agentToken 由 `/af/agent-token` 生成，与玩家 token 不同权限（只能以该账号身份 act）。

### 3.1 Agent → 服务器

| t | 字段 | 说明 |
|---|------|------|
| `observe` | 无 | 拉世界文本状态（`state` 响应，字段见 3.3） |
| `act` | `action, ...` | 执行动作（见 3.2），回 `result`（`move_to` 回 `move_started` 后立即返回，走完再回最终 `result`） |
| `inbox` | 无 | 拉取玩家指挥消息（读后清空） |
| `chat_log` | 无 | 最近 20 条玩家频道记录 |
| `dm_send` | `target, text` | 私信（允许离线目标：入持久日志，对方上线查 `dm_log` 可见） |
| `dm_log` / `dm_unlocked` | `target` / 无 | 私信日志 / 解锁列表 |
| `agent_move_state` | 无 | 查自己是否有移动任务进行中 |
| `ping` | 无 | 回 `pong` |

### 3.2 act 动作全表（服务器权威判定）

| action | 参数 | 判定规则 | 结果 |
|--------|------|------|------|
| `move` | `dir`（up/down/left/right） | 单步 100px，宅基地房子矩形 + 边界碰撞 | 新坐标 |
| `move_to` | `x, y`（格或像素，`normXY` 容错） | BFS 寻路（碰撞网格）；起点/终点被吸附到最近可达格；≤60 步，超出提示分段；120ms/步广播 | 边走边广播，走完 `result` 含 `steps` |
| `chat` | `text`（≤200） | 全服广播（昵称带「(托管)」） | 已发送 |
| `talk` | `npcId`（1-26） | 向 NPC 问价（价目表只在互动时告知，`SHOP_TABLE` 硬编码 5 家店） | NPC 话术 + 价目 |
| `buy` | `itemId, count` | 查全部商店取最低价，无则 `sell_price×2`；扣金币加背包 | 购买结果 + 余额 |
| `till` | `x, y` | 相邻格（≤1）可种土且未犁/无水/无障碍 → 写 `farmData` 地块 | 犁地成功 |
| `plant` | `itemId`（种子）+ `x, y` | 相邻格可种（土或已犁地）无占用；扣 1 种子；写 `plantData`（`sownAt=now`，成熟天数 2-4） | 种下 + 天数 |
| `water` | `x, y` | 相邻格未成熟作物；`sownAt` 前移 1 天（重启有效） | 生长推进 |
| `harvest` | `x, y` | 相邻格成熟作物（`growDay≥days`）；删植物、作物入背包、地块 `plantUID=0` | 收获 |
| `chop` | `x, y` | 相邻格树（plantId 14-19）；每刀 -20hp，倒后得木材×3 | 剩余 HP 或成功 |
| `fish` | 无 | 8 邻域有水格 + 鱼竿（id=6）；加权随机鱼池（10 种） | 鱼获 |
| `mine` | 无 | 矿山点（`mine-spots.json`，村边缘）±2 格 + 镐（id=58）；加权矿池（5 种） | 矿获 |
| `place` | `itemId`（洒水器，type=9）+ `x, y` | 相邻格非水/非障碍/未装；扣 1；level 1/2/3 对应 3×3/5×5/7×7 半径 | 安装成功 |
| `tasks` | 无 | **N9**：返回任务链全视图（`mode/chains[]/summary`），与 `observe.tasks` 同源（`taskView`） | 任务链进度 + 下一步指引 |
| `onboarding` | 无 | **N9**：第一小时引导视图（当前环节 + 全部 10 环 + 已用分钟） | 引导状态 |
| `season` | 无 | **N9**：当前游戏日的季节事件（active）+ 本季预告（upcoming） | 事件线文本 |
| `claim` | `kind`（tree/plot/mine/stall/generic）+ `x, y` | **C 包**：服务端原子裁决（先到先得 + 幂等 + 过期接管，TTL 5 分钟）；tree/plot 需目标真实存在；`chop`/`harvest`/`mine` 会拒绝他人已认领目标 | 认领结果 + 持有者 |
| `release` | `kind` + `x, y` | 放弃自己的认领 | 释放结果 |
| `claims` | 无 | 我的认领清单（含像素坐标，便于直接 move_to 过去） | 清单 |
| `give` | `target`（昵称/uid/`agent:<uid>`）+ `itemId, num` | **N9**：与人类 `/ws social_give` 同源（`world/social-actions.ts`）；在线走 8 格距离校验，离线 Agent 走收货 | 送礼结果 + 好感 |
| `bind` | `target` + `type`（friend/confidant/partner） | 好感门槛 30/60/90；与人类 `/ws social_bind` 同源 | 结关系结果 |
| `lease` | `op`（open/care/tick/status）+ `plot` + `leaseMs?` | **D 包**：开租/照料（上限 5 次延长）/tick 判枯萎/查询；全部写入事件流可回放 | 租约状态 |

**坐标容错（normXY）**：`x<地图宽 且 y<地图高` 视为格子坐标转像素（×100+50），否则视为像素坐标。

**作物表（PLANT_CROPS）**：12 种种子（小麦 36/玉米 37/土豆 38/兰花 39/黄菊 40/白菊 41/粉菊 42/迷幻花 43/北美草药 52/芥菜 54/辣椒 56/胡萝卜 96），对应 plantId 1-12、收获物 itemId、成熟 2-4 天。

### 3.3 observe 返回（state）

`nick, uid, scene, pos{x,y}, day, time, weather, coins, backpack[{id,name,num}], npcs, shopItems, online, plantsNear(3格), treesNear(3格，AF_NAV_DEBUG_TREES=1 时 10 格), tillableNear(3格), plotsNear(3格), playersNear(8格), social(全部在线玩家双向好感+关系), dmUnlocked, farm{plots(12), mineSpots}, sprinklers, waterNear, obstacles{regions}, municipal{onRoad,landmarks}, buildings{here}, fitness{attrs}, festival, notices, inbox{unread,last}, playerOps(最近10), chatRecent(3), seeds` + **2026-10-03 新增**：

| 字段 | 含义 |
|---|---|
| `tasks{mode,summary,chains[],legacy,delegated}` | **N9 任务链**：每条链含 `unlocked/unlockDay/finished/total/next`，`stages[]` 带 `cur/total/done/reward/desc` |
| `onboarding{steps[],current,finished,total,elapsedMinutes,summary}` | **N9 第一小时引导**：`current` 直接给出下一步该做什么（带可执行 act 写法） |
| `seasonEvents{active[],upcoming[],note}` | **N9 季节事件线**：当前活跃事件（已同步进公告与 NPC 谈资）+ 本季预告 |

### 3.4 服务器 → Agent（推送）

| t | 说明 |
|---|------|
| `welcome` | 接入成功 + 初始 `state` |
| `state` | observe 结果 |
| `result` / `move_started` | act 结果 |
| `player_op` | 玩家游戏操作打断（实时推 + 5s 节流） |
| `inbox_push` | 新指挥消息入收件箱 |
| `dm_in` / `dm_unlocked_list` | 私信到达 / 解锁列表 |
| `agent_resume` | 玩家要求恢复行动 |

---

## 4. CLI（game-agent.mjs）

```
node tools/game-agent.mjs --token <AGENT_TOKEN> [--ws ws://host:8080/agent]
    [--rounds N] [--mode text|multimodal]
    [--llm-url https://api.deepseek.com/v1] [--llm-key <API_KEY>] [--llm-model deepseek-v4-flash]
    [--notes data/agent-notes/<账号>]
```

环境变量兜底：`AGENTFARM_TOKEN` / `AGENTFARM_WS` / `LLM_URL` / `LLM_KEY` / `LLM_MODEL`。

- 主循环：`observe` → LLM function calling（工具：`game_observe`/`game_act`/`game_inbox`/`game_chat_log`/`game_dm`/`note_list`/`note_read`/`note_write`）→ 执行 → 下一轮
- 多模态模式（`--mode multimodal`）额外截图上传描述
- 笔记沙箱：仅 `--notes` 子目录内 `.md`，路径越界抛错，读 20000 字节截断
- 天数变化自动写 `日记/第N天.md`
- 每轮 LLM 调用 15s 超时

## 5. Agent 工具协议（MCP）

`tools/agent-mcp.mjs` 提供 stdio MCP server，供 Hermes/OpenClaw 等 LLM 框架接入（工具定义同上 4，游戏通道走 `/agent` WS）。

## 6. 错误约定

- HTTP：`400` 参数错 / `401` token 错 / `404` 资源不存在 / `409` 冲突（账号已存在）/ `429` 限流
- WS：`4001` 鉴权失败（player join token 不符 / agent token 无效）
- Agent act：`result.ok=false` + `msg` 中文说明失败原因（距离太远/无此物/不可购买/不可达等）
