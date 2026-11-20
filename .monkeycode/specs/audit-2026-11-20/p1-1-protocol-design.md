# P1-1 protocol.ts 全量重构设计（短版）

## Intent
把 `server/src/gateway/protocol.ts` 的 `z.any()` 字段替换为语义化校验器，同时**保持与冻结 legacy afserver.mjs 行为等价**（设计原则见文件头注释第 2-3 行）。

## Goals
1. 关键数值字段用 `z.coerce.number()` —— 兼容字符串数字（如 legacy 客户端发 `"x":"3500"`）
2. 关键文本字段用 `z.string().or(z.coerce.string())` —— 兼容数字字符串
3. TS 接口由 zod schema 用 `z.infer<>` 派生，单一事实源
4. **保留 `.passthrough()`** —— 存量客户端多发字段不破坏

## Non-Goals
- 不做 zod-to-TS codegen（ponytail：项目零构建步骤，codegen 是过度工程）
- 不改 ws.ts/http.ts 中 handler 对字段的 String()/Number() 调用（下游 NaN 守卫已在 MEMORY 记录，本轮不动）
- 不收紧 union 外的 passthrough 未知字段策略（legacy 行为）
- 不引入新依赖（zod 已有）

## Constraints
- 单测协议回归必须全绿：`cd server && npx vitest run test/unit/protocol*.test.ts`
- 端到端协议回归必须全过：`AF_BASE=http://127.0.0.1:<port> node server/ws-test.mjs`
- tsc --noEmit 零错误

## 批次划分（一次性全量，但分批 commit 便于审查）

| 批 | 范围 | 文件:行 | 估计行数 |
|---|---|---|---|
| B1 | GameJoinMsg + GameSaveMsg（kv 数组已经强校验） | protocol.ts:9-10 | ~5 |
| B2 | GameMoveMsg + GameChatMsg + 6 条 social_* | protocol.ts:11-18 | ~15 |
| B3 | 任务/私聊/打断/到达（agent_arrive 含 scene/x/y/index） | protocol.ts:19-26 | ~10 |
| B4 | Spectate/unspectate + agent 通道全部 | protocol.ts:27-65 | ~25 |
| B5 | HTTP body 8 个 schema（已较完整，仅补 infer 类型） | protocol.ts:74-85 | ~10 |
| B6 | 协议调用点联调（ws.ts / http.ts 仅引用类型，不改逻辑） | 多处 | 视情况 |

每批提交前跑 tsc + vitest。B6 若联调无变更则跳过。

## Risks
- `z.coerce.number()` 会改 `undefined` 行为：legacy 下 undefined 通过 any，coerce 后变成 0。可能影响 GameJoinMsg.scene 等可缺失字段的对齐。
  - 处置：对可缺失字段使用 `z.coerce.number().optional().default(0)` 或 `.nullable()`，按 legacy 实测行为逐个对齐。
- `passthrough()` 下未知字段仍通过——这是有意的 legacy 行为，保留。
- 不排除未来加 `.strict()` 收紧的可能性，本轮不动。

## 验证证据基线
B1-B5 每批 commit 前必跑：
```
cd server && npx tsc --noEmit && npx vitest run test/unit/protocol*.test.ts
```
端到端：每完成 2 批跑一次 `AF_BASE=... node server/ws-test.mjs`。