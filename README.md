# AgentFarm2 —— 原版外壳 × Agent 联机

把《乡村狂想曲》原版游戏当作外壳（画面/地图/角色/生活玩法 100% 原版），机制换成 **AI Agent 多人联机共居**，剧情已去除。

## 快速开始

```bat
deploy\start.bat
```
浏览器打开 **http://127.0.0.1:8080/** → 注册/登录账号 → 开始游戏。

- 一个账号 = 一个角色 = 一份存档（换浏览器/设备用同一账号继续）
- 每个玩家都是主角（继承主角初始档），第 1 位玩家在原版家门口，第 2~8 位出生在**村地图扩展区**的专属宅基地（树根家/小卖部/木匠家/老太太家/屠夫家/村长家/家石伯家房型）
- 聊天：Enter 输入（玩家频道，不影响 Agent）
- 右上角按钮：**📖 日记**（Agent 日记只读）、**📮 指挥**（给 Agent 发消息，不打断它）、**⏸ 打断 / ▶ 恢复**、**🤖 托管中**状态条（Agent 在线常显）

## 玩法动作（玩家与 Agent 共同生活）

| 动作 | 说明 |
|---|---|
| 种地 | 杂货店买种子（36 小麦/37 玉米/38 土豆/39 兰花/40 黄菊/41 白菊/42 粉菊/43 迷幻花/52 北美草药/54 芥菜/56 辣椒/96 胡萝卜）→ 农田或可种土格子种下 → 成熟后收获（1 游戏天 = 10 分钟真实时间） |
| 砍树 | 村庄里的树（两刀~三刀倒），获得木材 |
| 钓鱼 | 站到水边（河边）钓鱼，随机鱼获 |
| 挖矿 | 村庄边缘 6 个矿点（observe 的 farm.mineSpots）挖矿石 |
| 作物共享 | 植物数据在世界桶：你种的我收、我种的你收（服务器权威模拟） |

## 指挥 / 打断 / 恢复

- **📮 指挥**：消息进 Agent 收件箱（`game_inbox` 拉取），**不打断** Agent 当前行动，它告一段落后处理
- **玩家频道聊天**：也不打断 Agent（Agent 想了解可用 `game_chat_log` 看）
- **⏸ 打断**：等同你在游戏里做了一次操作 —— 玩家任何游戏操作（存档变化）都会打断 Agent，它停下当前计划回应你
- **▶ 恢复**：让 Agent 恢复原计划继续行动
- **🤖 托管中**：Agent 接入后右上角常显状态（在线=绿色"托管中"，离线=灰色）

## 外部 Agent 接入（独立程序）

```
node tools\game-agent.mjs --token <接入码> [--rounds N] [--notes 笔记目录]
```

**接入码**：玩家登录后服务器生成（POST /af/agent-token），发给 agent 即可接入。

**感知与决策**：纯文本模型 —— 一切感知来自 `game_observe` 的文本状态，按坐标导航；不看画面。

**能力**：
| 动作 | 说明 |
|---|---|
| `game_observe` | 文本世界状态（位置/时间/金币/背包/NPC/在线玩家/附近植物/可砍树/水边/矿山/收件箱/玩家活动） |
| `game_act move_to` | **直达寻路**：报目标坐标，服务器 BFS 规划路径一口气走完（自动避开房子/水面/边界） |
| `game_act talk` | 找 NPC 问价（屠夫4/木匠6/杂货店13/村长7/医生25），价格只在互动时告知 |
| `game_act buy` | 买物品 |
| `game_act plant/harvest/chop/fish/mine` | 种地/收菜/砍树/钓鱼/挖矿（服务器模拟判定） |
| `game_act chat` | 说话（广播） |
| `game_inbox` | 拉取玩家的指挥消息（读后清除） |
| `game_chat_log` | 查看玩家频道聊天记录 |
| `note_list/read/write` | 笔记沙箱（只允许自己的子目录 `data/agent-notes/<账号>/`），用于长期记忆/任务板/日记 |

**性格人设**：`data/agent-notes/<账号>/agent.md`（预设性格模板：活泼开朗/沉稳寡言/好奇宝宝/热心肠/守财奴/自由灵魂，或自定义）。
生成：`POST /af/agent-setup {token, personality, name, playstyle, phrase}`。
Agent 启动第一件事就是读它，严格按人设行动（口头禅、玩法偏好都会生效）。

**每日日记**：agent 检测到游戏天数变化时自动写 `日记/第N天.md`；玩家在游戏里点"📖 日记"只读查看。

## 架构

```
client/          原版 game/ 副本（画面/逻辑零改动）
  index.html     +1 行注入 mod/agentfarm.js
  mod/agentfarm.js   注入层：账号登录 / 存档网络化 / 多人位置同步 / 远程玩家渲染 /
                    聊天 / 日记面板 / 截图上传 / 宅基地碰撞
server/afserver.mjs  单端口 8080：静态 + 存档API + 账号系统 + /agent 通道
                     （observe/move/move_to 寻路/talk 问价/buy/chat）
data/            存档(world.json)/账号(accounts.json)/种子存档/物品表/NPC表/
                 碰撞网格(village-collision.json)/agent笔记/截图
tools/game-agent.mjs  独立 Agent（LLM 驱动，文本/多模态两类）
tools/agent-mcp.mjs   MCP server（供 Hermes/OpenClaw 等框架接入，stdio）
tools/            地图扩展/碰撞生成/测试脚本/原版代码定位报告
```

## 关键文件

- `docs/AgentFarm2-规划书.md` — 二代规划（P0 已完成，P1/P2 规划）
- `docs/出生地方案.md` — 宅基地/出生点方案
- `tools/原版代码定位报告.md` — 原版系统注入点全集
- `tools/tile-classification.md` — 村地图 tile 分类（纯地面/路/杂物白名单）
- `D:\skills\agentfarm-game\SKILL.md` — 给 Agent 框架用的游戏玩法技能（含非多模态玩法心法）
