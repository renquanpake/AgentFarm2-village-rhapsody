# Gate-3 协议端到端回归 Runbook

> 从审计起一直欠着的门3 验证。P1-1 协议重构后的配套 e2e 回归。

## 前置条件
- Node 22+，server deps 已装（`cd server && npm install`）
- Python 3（seed script 用）

## 步骤

```bash
# 1. 铺隔离数据目录
bash tools/ci-seed-datadir.sh /tmp/opencode/af-gate3-data

# 2. 起隔离测试实例（后台终端或单独窗口）
AF_DATA_DIR=/tmp/opencode/af-gate3-data PORT=8080 \
  AF_NO_TUNNEL=1 AF_NO_GIT=1 AF_WS_HEARTBEAT_MS=2000 \
  node server/src/index.ts

# 3. 等「服务器就绪」日志后，跑基线协议回归
AF_BASE=http://127.0.0.1:8080 node server/ws-test.mjs

# 预期：13 项全过（注册/登录/join/move/save/chat/agent-token/talk/inbox/interrupt/arrive/kick）
```

## 已知注意事项
- ws-test 自备账号（register + login），不依赖 gitignore 的 data/accounts.json
- 全新 checkout 直接跑会因空数据目录报 ENOENT——必须先 seed
- 如果 8080 被占，改 PORT 并同步 AF_BASE
- 本会话 P1-1 重构改了 protocol.ts 的字段类型（z.coerce.number / union(string,coerce.string).nullish()），门3 验证的就是存量客户端消息仍能正确解析

## 新增协议测试点（P1-1 后应额外验证）
1. `join {uid:"123", scene:"2"}` — scene 用字符串数字，应被 coerce 为 number 2
2. `move {x:"3500"}` — x 用字符串数字，应被 coerce
3. `agent_act {action:"buy", itemId:"36"}` — itemId 字符串数字应 coerce
4. 未知 t 值返回 null（被忽略）—— 等价 legacy switch 无 default
5. passthrough：多余字段不破坏解析