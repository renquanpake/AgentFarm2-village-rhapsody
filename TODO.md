# AgentFarm2 当前待办

## 已修复

- [x] 托管模型：Agent 接管玩家本体，不再创建 `uid@agent` 第二个角色。
- [x] 托管移动：服务器逐步广播 `agent_move`，客户端平滑驱动原版 `Application.playerNode`；原版相机继续跟随。
- [x] 托管移动时序：`move_to` 现在区分“开始”和“完成”，客户端只在完成后恢复本地同步，Agent 也只在真正走完后继续。
- [x] 托管坐标持久化：移动完成后写回玩家 `playerData`，刷新后保留位置。
- [x] 扩展小地图：打开原版 `btnMap` 后，替换真正的 `pnlContent` 背景为服务器 `105x89` 网格；不再误改角色标记。
- [x] 扩展地图验证：浏览器端验证移动和小地图打开，服务端日志确认 `105x89` 更新。

## 当前待办

- [x] 托管状态下屏蔽本地键盘移动，避免玩家输入和 Agent 移动同时写入位置。
- [ ] Agent 进入/离开场景时接入原版场景切换，而不是只支持当前场景内移动。
- [ ] 为小地图增加玩家当前位置标记，并确认扩展区坐标和原版 NPC 标记不偏移。
- [ ] 为 `move_to` 增加中途断线、打断和 Agent 重启后的恢复测试。
- [ ] 将调试脚本中的账号、令牌和模型密钥全部改为环境变量；已经暴露过的凭证必须轮换。

## 已实现但仍需验收

### 服务器

- [x] plant / harvest / chop / fish / mine
- [x] 坐标容错、收件箱、聊天、打断、恢复、托管状态
- [x] 世界作物、碰撞网格、宅基地、小地图网格 API

### 客户端

- [x] 登录、网络存档、聊天、指挥、打断、恢复
- [x] 玩家本体托管移动
- [x] 扩展地图碰撞和扩展小地图

### Agent 程序

- [x] move_to / talk / buy / chat / plant / harvest / chop / fish / mine
- [x] observe / inbox / chat_log / 日记和笔记

## 验证命令

```bash
node tools/verify-hosted-move.mjs
```

服务器：

```bash
node server/afserver.mjs
```

Agent：

```bash
node tools/game-agent.mjs --token <agentToken> --mode text --rounds 40 --notes data/agent-notes/<username>
```

## 说明

- README 中“一个账号 = 一个角色”现在与实现一致；托管不是额外的 Agent 化身。
- 旧的“双主角”“Agent 节点不动”排查记录已失效，不要继续按旧方向排查。
- 不在本文件、脚本或提交记录中保存密码、Agent token、API key 等真实凭证。
