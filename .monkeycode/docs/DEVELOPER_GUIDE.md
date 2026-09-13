# 开发者指南

## 项目目的

AgentFarm2 是《乡村狂想曲》原版外壳的 AI Agent 多人联机系统。原版 Cocos 游戏零改动，由注入层（`client/mod/agentfarm.js`）把存档层换成网络层；`server/afserver.mjs` 是权威节点，负责账号、存档桶、玩法模拟、社交、托管 Agent；`tools/game-agent.mjs` 是 LLM 驱动的独立 Agent。

**核心职责**:
- 玩家无感联机（打开房间地址即进，账号=角色=存档）
- 人类与 Agent 共居：作物/农田全村共享，服务器权威判定
- Agent 可托管（接管玩家本体）、可被玩家随时打断/恢复
- 7×24 容器化房间（Fly.io 卷）+ 存档自动 git 备份

**相关系统**:
- Cocos 原版游戏 - 画面/渲染/输入外壳（零改动）
- OpenAI 兼容 LLM - Agent 大脑（房主配置一次全房间共用）
- GitHub - 代码 + 存档异地备份

## 环境搭建

### 前置条件

- Node.js ≥ 18（ESM `spawn` + `structuredClone` 需 18+）
- 可选：Git + GitHub 凭据（存档自动备份 push）
- 可选：Docker / flyctl（容器化部署）

### 安装与运行

```bash
# 服务端依赖（仅 ws + localtunnel，node_modules 不入仓库大文件）
cd server
npm install

# 本地开房（8080，静态+API+WS 单端口）
cd ..
node server/afserver.mjs

# 浏览器 http://127.0.0.1:8080/ → 注册 → 进村
```

首次启动读 `data/seed-villagedb.json` 初始化存档（坐标 +14 格一次性迁移到世界坐标系 105×89）。

### 环境变量

| 变量 | 必需 | 描述 | 示例 |
|------|------|------|------|
| `PORT` | 否 | 监听端口，默认 8080 | `3000` |
| `AF_DATA_DIR` | 否 | 数据目录（容器指到持久卷） | `/data` |
| `AF_CLIENT_DIR` | 否 | 静态前端目录（容器内） | `/app/client` |
| `AF_SLOT` | 否 | 存档位 1-3，默认 1 | `2` |
| `AF_GROW_MS` | 否 | 1 游戏天毫秒（默认 600000=10 分钟，测试设小） | `60000` |
| `AF_LLM_URL` | 托管时 | Agent 的 LLM 接口（OpenAI 兼容） | `https://api.deepseek.com/v1` |
| `AF_LLM_KEY` | 托管时 | LLM 密钥（`<API_KEY>` 占位） | `sk-...` |
| `AF_LLM_MODEL` | 否 | 模型名，默认 deepseek-v4-flash | `deepseek-chat` |
| `AF_NO_GIT` | 否 | 1 时跳过 git 自动备份（容器/无凭据环境） | `1` |
| `AF_NO_TUNNEL` | 否 | 1 时不启动内网穿透（测试/容器必开） | `1` |
| `AF_WS_HEARTBEAT_MS` | 否 | WS 心跳周期，默认 30000 | `30000` |
| `AF_DEBUG` | 否 | 开详细日志 | `1` |
| `LLM_URL`/`LLM_KEY`/`LLM_MODEL` | Agent CLI | Agent 自身 LLM 配置（托管时由 afserver 注入） | 同上 |

⚠️ 绝不把 LLM 密钥、玩家 token 写入仓库；示例一律用 `<API_KEY>` 占位。

### 运行模式

| 场景 | 启动 |
|------|------|
| 本地开房（默认） | `node server/afserver.mjs`（自动起隧道 + git 备份） |
| 纯本地测试 | `AF_NO_GIT=1 AF_NO_TUNNEL=1 node server/afserver.mjs` |
| 容器 | `Dockerfile` + `AF_DATA_DIR=/data AF_NO_GIT=1 AF_NO_TUNNEL=1` |
| Agent 独立 | `node tools/game-agent.mjs --token <AGENT_TOKEN> --rounds 40` |

## 开发工作流

### 回归测试矩阵

无框架，纯 `ws` 客户端脚本，对着运行中的 afserver 打：

| 脚本 | 覆盖 | 用例数 |
|------|------|--------|
| `server/ws-test.mjs` | join/save/move/chat 基础 | 11 |
| `server/ws-multi.mjs` | 多玩家并发 + save_broadcast | 18 |
| `server/ws-kick.mjs` | 单点登录踢人（kicked 时序） | 6 |
| `server/ws-adv.mjs` | 社交/私信/任务/切档高级特性 | 11 |
| `server/ws-dm-test.mjs` | 私信解锁 + 离线投递 | 9 |
| `server/ws-attack.mjs` / `ws-attack2.mjs` | 攻击韧性（洪泛/超大值/畸形消息不断服） | - |
| `server/ws-restart.mjs` | 重启后存档恢复 | - |

```bash
# 先起服务（测试模式），再逐脚本
AF_NO_GIT=1 AF_NO_TUNNEL=1 node server/afserver.mjs &
node server/ws-test.mjs && node server/ws-multi.mjs && node server/ws-kick.mjs \
  && node server/ws-adv.mjs && node server/ws-dm-test.mjs
```

验收基线（上次全绿）：11 + 18 + 6 + 11 + 9/9。

### 代码组织约定

- 服务端单文件 `afserver.mjs`，按区段注释划分（账号 → 存档 → HTTP → WS 玩家 → 社交 → 玩法 → Agent → 隧道 → 定时器）；新增功能先定位区段再插，保持"一个区段一件事"
- 客户端注入层 `agentfarm.js` 是 IIFE，不污染全局（仅 `window.__AF_MOD__` / `__AF_SPAWNS__` / `__AF_ORIG_BOOT__` 约定）
- 玩法数值表集中在 `afserver.mjs` 顶部（PLANT_CROPS/FISH_POOL/MINE_POOL/SHOP_TABLE），改玩法先查表
- 静态数据表在 `data/*.json`（物品/NPC/碰撞/农场网格/出生点），脚本生成，手工改动需同步碰撞

### 提交规范

- `feat:` 新功能 / `fix:` 修复 / `chore(saves):` 自动备份（脚本生成，勿手工）/ `docs:` 文档
- 修改 `data/saves/` 之外的内容走分支 MR；存档由备份脚本自动提交

## 常见任务

### 添加新 Agent 动作

1. `afserver.mjs` act 区段加 `action === 'xxx'` 分支（判定 + `persist()` + `taskCount` + `publishAgentActivity`）
2. 顶部加数值表（如有概率池/价格）
3. `game-agent.mjs` `GAME_TOOLS` 的 `game_act` description 里补 action
4. `ws-adv.mjs` 加用例
5. 更新本文件 + INTERFACES.md 动作表

### 修改玩法数值

- 作物天数/价格：`afserver.mjs` `PLANT_CROPS` / `SHOP_TABLE`
- 世界几何：`data/village-farm.json`（水/土）+ `data/village-collision.json`（阻挡）——二者由 `tools/build-collision.mjs` 从 tmx 生成，手改需同步
- 出生点：`data/spawn-points.json`（houses 数组，id/rect/door）

### 容器化部署

**Dockerfile 关键设计**（详见 模块/deploy.md）：
- 配置 .json 烤进 `/app/data`（不可变层）；运行时卷挂 `/data`
- CMD：`cp -n /app/data/*.json /data/`（只补缺失，不覆盖运行时存档/账号）再 `exec node afserver.mjs`
- `AF_DATA_DIR=/data`、`AF_CLIENT_DIR=/app/client`、`AF_NO_GIT=1`、`AF_NO_TUNNEL=1`

**compose（Caddy 方案）**：
```bash
# 仓库根 .env：CADDY_DOMAIN=你的域名.com
echo "CADDY_DOMAIN=你的域名.com" > .env
cd deploy && docker compose up -d
# 朋友打开 https://你的域名.com → 无感进房
```

**Fly.io**：
```bash
flyctl launch --no-deploy   # 读 fly.toml
flyctl volumes create saves -n 3
flyctl deploy
flyctl certificates add 你的域名.com
```

### 配置 GitHub 自动备份

```bash
# 仓库根（凭据走 credential helper，token 不落仓库）
git config credential.helper '!f() { echo "username=<你的账号>"; echo "password=<PAT_TOKEN>"; };f'
node tools/backup-saves.mjs --push   # 验证 dry-run 通过
```

备份行为：`AF_NO_GIT=1` 跳过；无凭据仅本地 commit（不阻塞游戏）；幂等锁 `.backup-lock`（10 分钟）防定时器与手动并发。

### 给 Agent 配 LLM

游戏内右下角 **📮 指挥 → 🤖 模型设置**（`/af/agent-provider`），填 OpenAI 兼容三件套。配置存 `data/agent-provider.json`，热更新运行时变量（新 spawn 的 Agent 生效）。房主配一次全房间共用。

## 修改建议区域（低风险起步）

| 区域 | 风险 | 说明 |
|------|------|------|
| `afserver.mjs` 玩法区（1326+ 行） | 低 | 加动作/改数值，有 `persist()` 兜底 |
| `data/*.json` 数值表 | 低 | 物品/NPC/价格，不改 schema 即可 |
| `agentfarm.js` UI 区 | 中 | 登录大厅/聊天面板，注意 IIFE 闭包 |
| `afserver.mjs` 存档桶（90-143 行） | 高 | 改拆桶逻辑会污染存档，必须跑全回归 |
| `afserver.mjs` 账号系统（44-84 行） | 高 | token 语义改动影响全客户端 |
| 客户端 localStorage 包装（agentfarm.js 408+ 行） | 高 | 原版读档路径强依赖，改后先单玩家验证 |

## 故障排查

| 现象 | 排查 |
|------|------|
| 朋友连不上 | 房主防火墙放行 Node.js；`/af/room` 看 tunnelUrl；容器环境确认 Caddy 证书签发 |
| 登录 401 反复 | 单点登录踢旧连接（kicked）；或 token 过期重登 |
| Agent 不动 | `/af/agent-status` 查在线；`afserver` 日志看 spawn 是否失败（缺 LLM_KEY） |
| 作物不生长 | 定时器 5min 洒水 + `growPlants` 被动推进；`AF_GROW_MS` 是否被调小 |
| 存档没备份 | 本地 `git log data/saves`；Fly 看日志 `[backup]`；`AF_NO_GIT` 是否=1 |
| 切档后数据串 | `switch-slot` 已清全部内存 Map；若自定义了全局状态需一并清 |
