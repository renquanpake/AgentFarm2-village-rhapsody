# 模块：server/afserver.mjs

## 概述

AgentFarm2 的权威服务端，单文件 2185 行（ESM，无框架，原生 `http` + `ws`）。一个进程承载：账号系统、存档桶、HTTP API、WS 双通道（玩家 + Agent）、玩法模拟、社交、托管 Agent 生命周期、定时器、隧道。

**位置**: `server/afserver.mjs`
**入口**: `node server/afserver.mjs`（`PORT`/`AF_SLOT`/`AF_DATA_DIR`/`AF_CLIENT_DIR` 可调）

## 代码区段（按行号定位）

| 区段 | 行号 | 职责 |
|------|------|------|
| 常量与数值表 | 20-35 | 端口、路径、AF_* 变量 |
| 数值池 | 36-200 | PLANT_CROPS（12 作物）、CROP_BY_PLANT_ID、FISH_POOL（10 种鱼）、MINE_POOL（5 种矿）、SHOP_TABLE（5 家店价目） |
| 账号系统 | 44-84 | 注册/登录/token、sha256+salt、注册限流 |
| 存档桶 | 90-143 | world/player/global 三桶 + 3 存档位 |
| 玩法定时器 | 200-227 | 洒水器 5min / growPlants / DM 解锁 15s / 内存清理 5min / git 备份 10min |
| HTTP API | 229-684 | `/af/*` 全表（save/room/join-room/agent-* /saves/switch-slot/diary/mapgrid） |
| WS 玩家通道 | 685-1304 | join/save/move/chat/social_*/task_list/agent_msg/dm_send（18 case + 多层节流） |
| Agent 工具函数 | 1307-1540 | publishAgentMoveDone / persistAgentPosition / PLANT_CROPS 反向表 / notePlayerOp 5s 节流 / inbox 持久化 |
| Agent WS 通道 | 1542-1904 | observe 聚合（plantsNear/treesNear/tillableNear/plotsNear/social/dmUnlocked/farm.mineSpots/sprinklers/waterNear/inbox/playerOps/chatRecent/seeds） |
| Agent 动作 | 1905-2185 | till/water/plant/harvest/chop/fish/mine/place/attack 等，坐标 ±1 格校验 |

## 关键机制

- **账号**：`sha256(salt + '::' + password)`；每次登录换新 token；agentToken 独立权限（`/af/agent-token`）
- **单点登录**：同 uid 再上线 → 旧连接收 `kicked` 后 terminate
- **节流矩阵**：save 5 条/秒、move 12 次/秒、chat 3 条/秒、save_broadcast 500ms 合并、agent_activity 3s、notePlayerOp 5s、maxPayload 8MB——防单玩家拖垮事件循环
- **切档（switch-slot）**：persist 旧档 → 清全部内存运行时 Map → 重载 → 踢全在线连接
- **静态托管**：`AF_CLIENT_DIR` 下的 client/ 走 GET，SPA 回退 index.html

## 相关页面

- [接口全表](../INTERFACES.md)
- [架构 · 数据流](../ARCHITECTURE.md)
- [模块/agentfarm](agentfarm.md)（客户端对应层）
