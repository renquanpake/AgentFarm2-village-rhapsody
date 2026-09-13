# 模块：client/mod/agentfarm.js

## 概述

客户端联机注入层（1710 行，IIFE，`client/index.html` 注入 1 行引入）。原版 Cocos 游戏零改动，本层把 `localStorage` 读改写透明换成网络，并叠加登录大厅、聊天、指挥/打断、日记面板、小地图、远程玩家渲染。

**位置**: `client/mod/agentfarm.js`
**引入**: `client/index.html` 末尾 `<script src="mod/agentfarm.js">`

## 代码区段

| 区段 | 行号 | 职责 |
|------|------|------|
| SERVER 推断 | 顶部 | `__AF_SERVER__` > `localStorage.af_server` > 页面域名自适应（https→wss） |
| localStorage 包装 | 408+ | 四方法 hook：`getItem` 启动同步拉权威档写 `villagedb_10000`；`setItem` 本地写 + 防抖推 WS `save`；key 翻译（固定后缀 100001 ↔ uid 后缀） |
| 登录大厅 UI | 中 | 选模式 → 选存档位（房主）/输地址或房间码（房客）→ 账号登录（401 自动注册） |
| WS 玩家通道 | 中 | 18 case（join/save/move/chat/social_*/task_list/agent_msg/dm_send/agent_interrupt/agent_resume） |
| 远程渲染 | 下 | `agent_move`/`agent_move_done` 平滑驱动 `playerNode`；远程玩家节点复用原版 |
| 小地图 | 下 | 105×89 网格覆盖 `pnlContent`（`/af/mapgrid`），水/阻挡/房子渲染 |

## 关键约定

- **不污染全局**：仅暴露 `window.__AF_MOD__` / `__AF_SPAWNS__` / `__AF_ORIG_BOOT__`
- 原版读档路径强依赖 `localStorage['villagedb_10000']`，包装层是其唯一入口
- 登录成功后放行原版 `boot`（`__AF_ORIG_BOOT__`）

## 相关页面

- [架构 · 客户端注入层](../ARCHITECTURE.md)
- [专有概念/无感化联机](../专有概念/无感化联机.md)
