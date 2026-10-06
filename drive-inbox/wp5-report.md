# WP5 交付回传：两处 P2 阻塞项根治 + 两项核心缺陷闭环

## [交付凭据]

- Commit: `cf3d3d5` — `fix(market): 重启校准订单 id 杜绝 UNIQUE 撞车 + treesNear 服务端过滤假目标树`（8 文件，+189 / −18）
- 分支与 CI: `260103-feat-playable-ship` + `master`（双分支同一 commit，master 由 `138c036` fast-forward 至 `cf3d3d5`，无 force-push）
  - Run `37444391312` — CI @ `260103-feat-playable-ship` → **success**
  - Run `37444391459` — CI @ `master` → **success**
  - Run `37444391334` / `37444391405` — drive-sync @ 双分支 → success
- 门禁总账: tsc **exit 0** | vitest **484/484** | 门5 哈希 **5138 通过** | ui-lint **全绿**（裸色值 0 / AFUI.on 100% / 常驻 DOM 10） | e2e **9/9** | vis **未重跑**（本轮未触碰 `client/**`，沿用批4 的 10/10）
- 提交前安全审查: `node tools/security-check.mjs` → PASS

## [执行事实清单]

**任务 1 — 根治 `market.test.ts:138` 偶发超时**
- `server/test/unit/market.test.ts:138`：`持久化与 OHLC` 用例签名改为 `it(..., async () => { ... }, 15000)`，断言逻辑零改动。
- 验证：`npx vitest run test/unit/market.test.ts` → **12/12 通过**（349ms）；全量 `npx vitest run` → **51 文件 484/484 通过**，此前该项在全量并行下的 5s 超时抖动消失。

**任务 2a — 复用存档位全局清盘**
- `tools/econ-loop-e2e.mjs` 前置清理段重写：扫当前 slot 库 `market_orders WHERE item_id=? AND status='open'` 全部 wood 订单，`owner` 经存档位同级 `accounts.json`（含 token，免密码）映射后逐个走 ws `op:'cancel'` 撤单。
- 撤单必须走协议：撤单才把挂单预留退回去，直改 DB 会与内存订单簿脱节并被下次 `persist()` 覆盖。
- 无凭据 owner 记入 `skipped` 并打印，盘面未清干净时由后续算价保护显式 `bad()` 报出，不静默。

**任务 2b — 动态算价保护**
- `P = Math.max(PRICE, topBid > 0 ? topBid + 1 : 60)`；`P * QTY > bCoins` 时 `QTY = Math.max(1, Math.floor(bCoins / P))`。
- 连带改动：`QTY` 由 `const` 改 `let`，`buyQty` 由钳制后的 `QTY` 推导，下游 8 处期望值（挂单/预留/撮合/收款/回炉/汇总）自动跟随，硬编码 3x 预算溢出彻底消除。

**附带闭环（本轮两处核心缺陷，已在同 commit 内）**
- `server/src/market/orderbook.ts` 新增 `calibrateTo()`；`server/src/market/service.ts:31` `bookOf` 建簿时喂 `SELECT MAX(id) FROM market_orders WHERE item_id=?`。
  - 红测证明：临时注释校准调用后，`market.test.ts` 重启用例真抛 `UNIQUE constraint failed: market_orders.id`（`service.ts:256`），恢复后转绿。
- `server/src/navigation/reloc.ts` 新增纯函数 `chopReachable()`（与 `actionPrecheck` 的 target-blocked / no-stand 同源）；`server/src/cognition/observe.ts` 下发 `treesNear` 前排除落在阻挡/水面/树丛格与孤岛空地上的永不可砍树。未改动任何地图、TMX、原版数据或烘焙资产。
  - 新增单测：`reloc.test.ts` 5 例（阻挡格/水格/树丛格/孤岛空地/nav 为 null）、`market.test.ts` 1 例。
- `.monkeycode/MEMORY.md` 登记 4 段式汇报模板全文与四项工程红线。

**e2e 实机证据（复用 `afdata-final/slot98`，未换新目录）**
- 启动日志 `市场恢复：3 笔挂单 + 1 笔历史成交`；服务日志零 market 错误、零 `UNIQUE constraint`。
- 9/9 全绿：砍树 2 斧木材 +3 → `@60 x3` 落簿 resting=3 → 背包预留 3→0 → B `@60 x3` 成交 1 笔余挂 0 → `market_fills` 1 笔 3x 单价 60 P2P(A→B) → 毛额 180 − `trade.fee` 18 = 净 162 → A 630→792 → A 3→0 / B 0→3 → B 回炉 1x 得 3 金币，`trade.recycle` 1 条。
- `market_orders` id 序列单调：`18000003 / 18000004(filled) / 18000006 / 18000007 / 18000010`，`18000005` 为全成交未落簿的 taker，重启后序号正确越过。
- 证据件：`drive-inbox/econ-loop-e2e.log`（9 处 `"ok": true`，`pass: 9 / total: 9`）。

## [新发现缺陷与技术债]

- `server/src/market/service.ts:110` 与 `:206` | **P2** | `ensureMaker` 仅在 `place` / `cancel` 路径触发，`op:'book'` 查询不播种做市商单。本轮清盘后订单簿为空但 `recentFills` 非空，故未播种、盘面恰好干净；若某物品历史上从无成交，簿将空盘、无做市商流动性，首个挂单方需自造深度。
- `tools/econ-loop-e2e.mjs` 清盘段 | **P3** | owner→账号映射依赖存档位同级 `accounts.json` 的 `token` 字段。该字段随登录刷新，长期未登录账号的 token 可能过期，清盘会跳过该 owner 并由算价保护显式报红，不会静默误判为全绿。
- `server/src/market/shadow.ts:36` | **P3** | `ShadowMarket.bookOf` 自建 `OrderBook` 且不校准时序，影子簿与实盘簿共用同一 id 分段基址。影子簿不落 `market_orders`，当前无碰撞面；若日后影子簿也落库，需同步接入校准。

## [待裁决项]

无。两处 P2 按指令精确落地；核心缺陷实现选择（校准入口置于 `bookOf` 而非 `restoreOpen` 内部、过滤谓词抽为 `reloc.ts` 纯函数而非内联于 `observe`）已按 Ponytail 自决，红测与实机证据俱在，残余风险见上节，交架构审查复核。
