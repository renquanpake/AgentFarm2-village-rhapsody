# WP6 交付回传：订单簿自增序列持久化硬化 + 退差单测守卫 + 砍树并发原子性

## [交付凭据]

- Commit: `48d0ae0` — `fix(market,chop): 订单簿自增序列持久化硬化 + 退差单测守卫 + 砍树并发原子性`（6 文件，+99 / −15）
- 分支与 CI（双分支同一 commit `dec6ca1`，master 由 `578ba22` fast-forward，无 force-push）:
  - Run `37456341255` — CI @ `260103-feat-playable-ship` (`dec6ca1`) → **success**
  - Run `37456390502` — CI @ `master` (`dec6ca1`) → **success**
  - Run `37456340991` / `37456390574` — drive-sync @ 双分支 (`dec6ca1`) → **success**
  - 回传件: 代码 `48d0ae0` + 报告 `dec6ca1`
- 门禁总账（本地实测）:
  - `npx tsc --noEmit` → **exit 0**
  - `npx vitest run` → **51 文件 485/485 通过**，exit 0（新增 1 项退差单测，原 484 → 485）
  - `node tools/security-check.mjs --all` → **PASS**
  - `node tools/hash-manifest.mjs --check` → **原版外壳哈希校验通过（5138 个文件）**
  - `node tools/ui-lint.mjs` → **全绿**（裸色值 0 / AFUI.on 100% / 常驻 DOM 10）
  - `node tools/econ-loop-e2e.mjs`（复用 `afdata-final/slot98`，未换新目录）→ **9/9 零回归**
- 证据件: `drive-inbox/wp6-e2e-evidence.json`（`pass: 9 / total: 9`，9 步全部 `"ok": true`）

## [执行事实清单]

**任务 一 — 订单簿自增序列持久化硬化（杜绝 ID 回绕）**

- `server/src/market/orderbook.ts` `calibrateTo(maxOrderId)`：按指令重写为条件分支——仅当 `maxOrderId >= this.idBase` 才做减法（`currentSeq = maxOrderId - this.idBase`；`this.nextId = Math.max(this.nextId, currentSeq + 1)`）。分段外的历史行属于其他物品簿，直接当成本簿序号会污染 `nextId`。保留 `Number.isFinite` 与非正值守卫。
- `server/src/market/service.ts` `bookOf(item)`：建簿时查询联合全局最大值并喂给 `calibrateTo`。架构师指定的三支照原样落地：
  `market_orders.id` / `market_fills.maker_order` / `market_fills.taker_order`。
- `server/src/persistence/db.ts` 新增迁移 **v7 `market-fills-order-ids`**：`ALTER TABLE market_fills ADD COLUMN maker_order INTEGER DEFAULT 0` / `taker_order INTEGER DEFAULT 0`；`service.ts insertFillRow` 同步写入两列。理由：全成交的 taker 单从不落 `market_orders`（`syncOpen` 只同步挂单），只查 `market_orders` 会漏掉这段已消耗的 id。
- 实机验证：v7 已在持久存档位应用（启动日志 `[db] migration v7 (market-fills-order-ids) 已应用`），新成交行写入 `maker_order=18000014, taker_order=18000015`。
  - **验证次序提醒**：8098 持久实例必须重启后才跑 e2e，否则跑的是内存里的旧代码。本轮第一次 e2e 就是在只改了磁盘代码、未重启服务的状态下跑的，恰好复现了三支查询的回绕（新卖单拿到已被上一轮 taker 吃掉的 `18000012`）；以四支查询重启服务后重跑，同一存档位拿到 `18000014 / 18000015`，回绕消除。

**任务 二 — 限价买单吃低价卖盘退差加固与单测守卫**

- `server/src/market/service.ts` `place()` **核实结论：退差逻辑已存在且正确，未改一行**。`buyerLimit = side==='buy' ? price : f.price`，`refund = Math.max(0, (buyerLimit - f.price) * f.qty)`，`refund > 0` 时 `knapAdd(买方背包, 1, refund)` 并把 `trade.refund` 落事件库（含 `item/price/qty/limit/refund/ts`）。卖方侧 `gross - fee`（10% 烧币）路径未受影响。
- 补一处文档级缺口：`server/src/persistence/events.ts` 的 `EventSchemas` 未登记 `trade.refund`（该事件此前无 schema 条目），已补 `z.object({ item, price, qty, limit, refund, ts })`。
- 新增单测 `server/test/unit/market.test.ts` **「限价买单吃低价卖盘时正确退还价差预留」**，用例名与步骤按指令：
  - 前置：先清掉做市商卖盘（否则买 100 会先吃到做市低价卖单，撞不到 60 那笔）。
  - 卖方 `u1` 挂卖 **60 x1**（落簿 resting=1，不成交）；买方 `u2` 挂买 **100 x1**（预留 100）。
  - 断言：成交价 **60**（取挂单方价）；卖方实收 **54**（`60 - Math.round(60*0.10)`）；买方收货且 `before - after === 60`（预留 100，实付 60，差额 40 已退回钱包）；`trade.refund` 事件存在且 `payload` 匹配 `{refund:40, limit:100, price:60, qty:1}`。
  - 结果：**通过**。

**任务 三 — 砍树并发原子性保障（防多主体双砍刷木材）**

改动位置：`server/src/gateway/ws.ts` `action === 'chop'` 分支。

- 关键段现在完全同步、连续、无 `await`、无异步调用：**查树 → 判死 → 扣血 → 当场移除** 在同一同步块内连排完成。
- `hp <= 0` 直接返回「这棵树已经倒了（无可砍）」，不再扣血、不再发产出。
- **修掉一个真实的复活漏洞**：原判定是 `p.hp = (p.hp || 10) - 20`——`||` 把 `hp === 0` 的已倒树当成「没砍过」复活成 10，再砍一斧就是第二份木材。改为 `p.hp ?? 10`。
- 砍倒后 `plants.splice(plants.indexOf(p), 1)` **在 `knapAdd(pm, 18, 3)` 之前当场执行**：产出木材发生在树已从列表移除之后，彻底阻断同帧并发二次结算。
- 附带收敛：树查找改用 `worldPlants(state)` 取一次列表引用，不再走 `growPlants(state)`——后者在作物 growDay 变化时会调用 `state.persist()` 落盘，把一次磁盘写插在关键段前面属无谓的窗口与开销；认领键 `tree@${gx},${gy}` 与原 `Math.floor(_t.x/100)` 同值，认领兼容性不变。
- 事件语义不变：仍发 `tree.chopped`（含 uId/hp）与 `item.gained`，`apply.ts` 回放路径未改。

**单测总数与验收**

- 新增 1 项退差单测 → 全量 **485/485**（51 文件）。
- 另在既有「重启 ID 校准」用例内补了幽灵单号分支断言（未新增用例数）：模拟 v7 迁移前的历史成交行（`maker_order/taker_order` 全为 0），断言重启后新单号必须大于该幽灵单号。

## [新发现缺陷与技术债]

- **`service.ts bookOf` 校准查询与指令存在一处必要偏差 — 已自决落地** | **P1** | 指令给的三支联合最大值（`market_orders.id` / `maker_order` / `taker_order`）**在生产存档位上不足以杜绝回绕**。实证：本轮实机跑出的订单号序列为 `…18000011(filled) → 18000012(filled) → 18000014(filled)`，其中 `18000012` 这一轮被新卖单占用，而它同时是上一轮已被吃掉的 taker 订单号（events 表 seq 5979 / 6635 两条 `order.placed` 的 `orderId` 都是 `18000012`）。根因：v7 迁移前的历史成交行 `maker_order/taker_order` 全为 0（默认值），幽灵 taker 单号在 `market_orders` 与 `market_fills` 两张表里都已彻底丢失，三支查询只能取到 `18000011`，校准后序号回绕到 `18000012`。已在第 4 支 UNION ALL 补 `SELECT MAX(json_extract(payload,'$.orderId')) FROM events WHERE type='order.placed' AND json_extract(payload,'$.item')=?`——挂单与全成交单都必落该事件，故它给的是完整上界；`events(type, ts)` 已有索引，按 type 过滤后仅数十行，建簿时只查一次。**重启服务以四支查询重跑 e2e 后，新卖单取 `18000014`、taker 取 `18000015`，越过 18000013，回绕消除**；单测已锁死该场景。若架构师认为四支越界，请裁决是否回退为三支（代价：历史库上幽灵单号仍会被复用）。
- `server/src/market/shadow.ts:36` | **P3** | `ShadowMarket.bookOf` 自建 `OrderBook` 且不经 `MarketService.bookOf`，因此不接入本轮校准；影子簿与实盘簿共用同一 id 分段基址。影子簿不落 `market_orders`，当前无碰撞面；若日后影子簿落库需同步接入。
- `server/src/market/service.ts ensureMaker` | **P2** | 承接 WP5：仅在 `place` / `cancel` 路径触发，`op:'book'` 查询不播种做市商单。本轮 e2e 的 9/9 依赖盘面无残留挂单，未受影响。
- 迁移 v7 为 `ALTER TABLE ADD COLUMN`，由 `schema_migrations` 版本表保证只执行一次，不在 SQL 内做幂等判断（node:sqlite 无 `ADD COLUMN IF NOT EXISTS`）；回滚需另行降级迁移，本轮未提供。

## [待裁决项]

- **校准查询取三支还是四支（见上节 P1）**
  - 方案 A（当前实现，推荐）：三支 + `events.order.placed` 第四支。收益：在生产存档位实测消除回绕，历史幽灵单号可被完整覆盖，且 `order.placed` 对挂单与全成交单都是必落事件，上界完整。代价：校准查询依赖事件溯源表，若未来对 `events` 做归档/裁剪，需保证该 item 的 `order.placed` 未被裁掉，或改为把 `maker_order/taker_order` 作为唯一来源并在裁剪前固化一份序号水位。
  - 方案 B（严格按指令三支）：只查 `market_orders.id` / `maker_order` / `taker_order`。收益：查询不跨到事件表，语义自洽。代价：v7 迁移前的历史成交行两个订单号恒为 0，幽灵 taker 单号无法恢复，重启后新单会复用它（已实测发生：`18000012` 被两轮共用）；只有新库或已全量回填两列的库才安全。
  - 建议：取 A。历史库的回绕已经真实发生过一次，三支方案在当前生产数据上无法自证安全。
- **砍树关键段是否需要在 `chop` 动作上加显式认领强制** | **P3** | 本轮已用「同帧同步移除」把双砍窗口关闭，`claimHolder` 检查保持原样（认领为可选，先到先得）。若要进一步把并发主体显式排队，需在 `act chop` 前强制 `claim`，会改变现有玩法口径与新手引导文案，未擅自改动，交架构师定夺。
