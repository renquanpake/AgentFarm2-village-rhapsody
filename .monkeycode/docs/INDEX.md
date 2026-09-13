# AgentFarm2 文档

AgentFarm2 是《乡村狂想曲》原版外壳的 AI Agent 多人联机改造：原版画面/地图/生活玩法零改动，机制换成"人类玩家 + LLM Agent 共居一个村庄"。本文档覆盖服务端（afserver.mjs 权威节点）、客户端注入层（mod/agentfarm.js）、LLM Agent（tools/game-agent.mjs）、部署容器化（Docker/Fly）与自动备份（backup-saves.mjs）。

**快速链接**: [架构](./ARCHITECTURE.md) | [接口](./INTERFACES.md) | [开发者指南](./DEVELOPER_GUIDE.md)

---

## 核心文档

### [架构](./ARCHITECTURE.md)
三层结构：原版 Cocos 外壳（被注入层包装 localStorage → 网络）+ 单端口权威服务端（HTTP API / WS 双通道 / 玩法模拟）+ LLM Agent 程序（observe/act 循环）。含数据桶模型、世界共享、托管移动、社交系统、容器化部署。

### [接口](./INTERFACES.md)
HTTP API（/af/* 全表）、WS 玩家通道（/ws 消息 t 值）、WS Agent 通道（/agent?token，act 动作全表）、CLI（game-agent.mjs 参数）、环境变量（AF_* / LLM_*）。

### [开发者指南](./DEVELOPER_GUIDE.md)
本地启动、回归测试矩阵、容器构建、Fly.io 部署、GitHub 自动备份配置、修改建议区域与常见任务。

---

## 模块

| 模块 | 描述 | README |
|------|------|--------|
| `server/afserver.mjs` | 权威服务端：账号、存档桶、WS 双通道、玩法模拟、社交、托管 Agent | [README](./模块/afserver.md) |
| `client/mod/agentfarm.js` | 客户端注入层：localStorage 网络化、登录大厅、WS 同步、远程渲染、小地图 | [README](./模块/agentfarm.md) |
| `tools/game-agent.mjs` | LLM 驱动 Agent：observe→LLM→act 主循环、笔记沙箱 | [README](./模块/game-agent.md) |
| `tools/backup-saves.mjs` | 存档 git 自动备份：--sparse 提交 + 凭据探测 + 幂等锁 | [README](./模块/backup-saves.md) |
| `deploy/` + `Dockerfile` | 容器化部署：compose（Caddy HTTPS）与 Fly.io 卷方案 | [README](./模块/deploy.md) |

---

## 核心概念

| 概念 | 描述 |
|------|------|
| [数据桶](./专有概念/数据桶.md) | 存档拆分模型：world 共享 / player 私有 / global 全局，下发时按 uid 重组 key |
| [托管模型](./专有概念/托管模型.md) | Agent 接管玩家本体（同一 playerNode），服务器驱动移动与动作，玩家随时打断/恢复 |
| [世界共享桶](./专有概念/世界共享桶.md) | 作物/农田/洒水器全村共享：你种的我收，服务器权威模拟生长与收获 |
| [宅基地与出生点](./专有概念/宅基地扩展区.md) | 村地图扩展 14 格后的专属出生区：第 1 人原版家门口，第 2~8 人分配扩展区房子 |
| [社交与私聊解锁](./专有概念/社交系统.md) | 好感度/关系绑定（好友 30/知己 60/伴侣 90），首次见面或同村 10 分钟解锁 1:1 私信 |
| [无感化联机](./专有概念/无感化联机.md) | 客户端 SERVER 跟随页面域名（https→wss 自适应），朋友打开你的域名即连上你的服 |
| [自动备份](./专有概念/自动备份.md) | 每 10 分钟 git add --sparse + commit（有凭据则 push），容器环境 AF_NO_GIT=1 走持久卷 |

---

## 入门指南

### 项目新人？

1. **[架构](./ARCHITECTURE.md)** - 三层结构与数据流
2. **[核心概念](#核心概念)** - 数据桶/托管/宅基地
3. **[开发者指南](./DEVELOPER_GUIDE.md)** - 本地跑起来 + 回归测试
4. **[接口](./INTERFACES.md)** - 协议全表

### 需要写 Agent？

1. **[接口 · Agent 通道](./INTERFACES.md)** - observe/act/收件箱/笔记协议
2. **[模块/game-agent](./模块/game-agent.md)** - 主循环与工具定义
3. **[专有概念/托管模型](./专有概念/托管模型.md)** - 打断/恢复语义

---

## 快速参考

### 命令

```bash
# 本地启动（8080，静态+API+WS 单端口）
node server/afserver.mjs

# 回归测试矩阵（AF_NO_GIT/AF_NO_TUNNEL 下）
node server/ws-test.mjs        # 基础 11 项
node server/ws-multi.mjs       # 多玩家 18 项
node server/ws-kick.mjs        # 单点登录踢人 6 项
node server/ws-adv.mjs         # 高级特性 11 项
node server/ws-dm-test.mjs     # 私信 9 项

# Agent 独立运行
node tools/game-agent.mjs --token <AGENT_TOKEN> --rounds 40

# 手动备份
node tools/backup-saves.mjs --push
```

### 重要文件

| 文件 | 目的 |
|------|------|
| `server/afserver.mjs` | 权威服务端核心（2185 行） |
| `client/mod/agentfarm.js` | 客户端联机注入层（1710 行） |
| `tools/game-agent.mjs` | LLM Agent（469 行） |
| `tools/backup-saves.mjs` | 自动备份脚本 |
| `data/seed-villagedb.json` | 种子存档（首次启动初始化） |
| `data/village-farm.json` | 农场网格（水/可种土 105x89） |
| `data/village-collision.json` | 全地图碰撞网格 |
| `data/spawn-points.json` | 宅基地出生点表 |
| `Dockerfile` + `fly.toml` | 容器化与 Fly 部署 |
| `docs/最终版规划书.md` | P0 已完成 / P1·P2 规划 |
