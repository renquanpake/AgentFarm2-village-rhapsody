# 批4 执行报告：语义压缩 / 纯协议寻路 / 帧级绑定 / 资源消耗出口

执行官：MonkeyCode　回传时间：2026-10-06

## 结论

四个任务全部落地，四道门禁 + 两项活体断言全绿。e2e 从 8 项扩到 9 项（新增「回炉消耗」），
9/9 通过；vis-assert 10/10 通过。执行过程中挖出两处服务端真实缺陷，见末节，未擅自改原版代码。

---

## 任务一（P0）rules-prompt 语义压缩：1197 → 1120 token

目标 ≤1120，命中上限且留 0 余量，NPC 名册 26/26 全量保留。

| 档位 | 字符 | token | rulesHash |
|---|---|---|---|
| full | 2240 | **1120** | `be464c8afd` |
| lite | 274 | **137** | `d1dd164000` |
| catalog-terse | 1120 | **560** | — |

分段（full 档，`【段名】` 起首行计字符，含换行）：

```
世界观 56｜日历 10｜价目 118｜地标 50｜建筑 85｜NPC 名册 123｜动作 10｜任务 19｜条款 13
```

压缩手段（只砍表述冗余，不动任何数值与业务规则）：

1. **身份去重**：NPC 岗位与人设 identity 相同时砍掉重复括注。
2. **日历去重**：删「10 天一季，四季循环」——【世界观】已声明，纯重复。
3. **价目**：段头去掉 `【价目】` 前缀，条目改用 `；` 分隔。
4. **地标**：`村景像素:` 替代完整句式。
5. **建筑**：统一为 `(2 门位 8150,8050)` 紧凑形。
6. **条款**：反幻觉尾句保持逐字不变（`以上资料未写明的，回答不知道。`），其余三行压缩。
7. **删除** `SEASON_DAYS` 的无效 import。

`rules-prompt.test.ts` 25/25 全绿，含全部既有断言（NPC 注入句、价目、坐标口径、六折标注）。

**动作表 562 token 未压缩**：压缩动作表会让 agent 失去动作名清单，属功能性损失，且当前预算
（1120/1200）不需要动它。

---

## 任务二（P1）e2e 弃用 world.json 硬读，改纯协议寻路

删掉 `loadTrees()` 与 `node:fs` import。树场定位改为三段式，全程只用公开协议：

1. `move_to {near:'北路口里程碑'}` —— 走公开地标网络，落点 (94,53)。
2. `GET /af/mapdoc` 解析阻挡簇 bbox —— 挑西北象限（`x1<82 && y2<62`）离当前位置最近的林区簇。
   该端点专为「纯文本 LLM 自规划路线」生成，阻挡簇/建筑门位/地标/跨场景门户都在里面。
3. 簇内 `observe` 读 `treesNear`（3 格窗），逐棵试砍。

实测 `navSteps=194`、`hops=6`（走完最近簇后换到可砍的簇）。

### 寻路过程中查清的服务端契约（此前靠探针拼出来的部分已写进 e2e 注释）

- `observe` 返回 `state`，**位置在 `pos.x/pos.y`**，不在顶层 `x/y`。取错就永远是 `[0,0]`。
- `treesNear` 条目带 `gx/gy/px/py/plantId/hp`；`hp` 实测有 10/30/60 三档，每斧 -20。
- `act chop` 的落点判定走 `actionPrecheck(nav, [gx,gy], [px,py])`：先 chebyshev 距离 ≤1，
  再查 `cellKindOf(nav, gx, gy) === 'open'`。**树格若被导航格标记为建筑/障碍，直接回
  target-blocked，这类树物理上砍不动。**
- `act move` 只吃 `dir`（up/down/left/right），没有绝对坐标；`up` 是 `ny += STEP`（y 变大）。
- `move_to` 的结果在寻路**结束时**才回，`steps` 是已走路数；结果里的 `pos` 是真实落点，
  不保证贴着目标（目标格被阻挡时吸附到最近可站环）。
- `normXY` 把 `< MW(217) && < MH(201)` 的入参当**格坐标**乘 100+50，pixel 值大于该阈值时原样通过。
  所以砍 (7150,150) 不会被误算，但传 `(715,15)` 会被放大成 (71550,1550)。

### e2e 砍树逻辑重做（原实现有三处会导致 14 斧全 far）

- `standNextTo`：先算树 8 邻里可站的格作为 `move_to` 目标。
- `approach`：`move_to` 之后按 chebyshev 距离用单步 `move` 补足到 ≤1 格。
- 只有 `chop` 返回**非 ok**（已倒 / target-blocked / 太远）才把这棵标记 dead 换下一棵；
  「砍了一斧头」说明树还活着（hp 60 要 3 斧），留在原地继续砍。
- 本簇砍不动就换 mapdoc 里下一个林区簇，不再原地重试。

---

## 任务三（P1）弃用 setTimeout 宏任务，改帧级确定性节点绑定

`client/mod/agentfarm.js`（+45/-13），改动全部在 `client/mod/`，未碰 `client/assets/**`
与混淆引擎文件。

- 新增 `BIND_FRAME_LIMIT = 10`、`stopFrameProbe()`、`startFrameProbe(sc)`。
- 监听 `cc.Director.EVENT_AFTER_UPDATE`（引擎主循环内 lateUpdate 之后、draw 之前触发，
  与场景激活同一条帧管线）逐帧调 `resolvePlayerNode()`。
- 命中即**当帧完成绑定并立即注销监听**；10 帧未命中记 `console.warn` 后同样注销。监听永不常驻。
- `releaseSceneBind()` 先停帧探测再清引用；`sceneLaunchCb` 直接同步调 `bindScenePlayer()`，
  去掉 `setTimeout(bindScenePlayer, 0)`。
- 解析链保留为回退，绑定未就绪或失效时行为与改造前一致。

理由：`setTimeout(0)` 的宏任务排在渲染帧之外，场景内节点晚挂上来时它已经跑完，绑定必然失败
退回 fallback——这就是此前 WP1b 在部分场景静默失效的根因。

vis-assert **10/10 通过**，含 A dir 步随（有效步 6/6，终距 100px）、C 黑洞重放（dist 0px）、
D move_to 终点对齐（dist 0px, done=true）、B 行为飘字（fc=14）、E 面板文案、
页面 console error = 0。

---

## 任务四（P2）基础资源消耗出口：打铁炉回炉

**不加工具耐久/磨损**：`stamina.ts:4` 注释明写背包只有一件工具，磨损会卡死买不起第二件的新手。
改用「打铁炉回炉」做消耗出口，闭合「砍伐 → 挂单 → 购买 → 消耗」。

- `shop.ts` 新增 `RECYCLE_RATE = 0.5`、`RECYCLABLE = new Set([18])`、`RecycleResult`、
  `doRecycle(state, tables, uid, itemId, qty)`。回收价 = `basePriceOf(id) × RECYCLE_RATE`。
- **定价阶梯（低→高，故意留档，任何一档不能反超上一档）**：
  回炉 0.5 < NPC 收购参考 0.6 < 订单簿卖方实收 0.9。
  倒挂会让玩家绕过撮合直接回炉，订单簿流动性失效。单测把这条不等式钉死。
- `ws.ts:1352` 新增 `action === 'recycle'` 分支：落 `trade.recycle` + `task.progress` + 广播。
- `act-catalog.ts` 加条目并进 `HIGH_FREQ_ACTS`。
- 新增 `server/test/unit/recycle.test.ts` 7 项：扣包发币、回收价同源、定价阶梯不倒挂、
  白名单外拒绝、数量不足/缺玩家/非法数量无副作用、目录含 recycle、紧凑表 ≤560 token。

`RECYCLE_RATE` 从最初的 0.4 提到 0.5：0.4 时木材回收仅 1 金币（`basePriceOf(18)=4`），
作为消耗出口几乎无意义；0.5 仍有真实产出且留足与 0.6 的档差。

---

## 门禁结果

| 门禁 | 结果 |
|---|---|
| tsc `--noEmit` | exit 0，无输出 |
| vitest 全量 | **478/478 通过**（51 个测试文件，含新增 7 项） |
| security-check `--all` | PASS |
| hash-manifest `--check` | 原版外壳哈希校验通过（5138 个文件） |
| ui-lint | 裸色值 0；af-* 点击绑定 100% 走 AFUI.on；常驻 DOM 预算 10/10 |
| e2e 经济闭环 | **9/9 通过**（新增第 9 项回炉消耗） |
| vis-assert | **10/10 通过** |

e2e 关键等式（`--qty 3 --price 60`，隔离实例 8099 / slot99）：

```
砍倒 1 棵 → 木材 +3 → 挂单 @60 x3 → B 吃单 1 笔 P2P(A→B)
毛额 180 − trade.fee 18 = 净 162（卖方实收 90%，10% 出清不入任何账）
A 954 → 1116；B 木材 +3 → 回炉 1x 得 3 金币，trade.recycle 事件 1 条
```

`market_fills` / `events` 查询全部加 `ts >= RUN_TS` 水位：这两张表历史追加、隔离实例跨轮复用
同一存档位，不带过滤会把上一轮成交算进本轮（毛额翻倍、卖方收款口径被污染）。

---

## 挖出的两处服务端缺陷（未改，请架构师裁决）

**1. `market_orders.id` 重启后 UNIQUE 冲突（P1）**

`orderbook.ts:202` 的 `restoreOpen` 只把 `nextId` 推进到**未成交**订单的序号，已成交/已撤销的
订单从不计入。重启后下一张单拿到与已落库行相同的 id，`INSERT` 撞 UNIQUE 约束抛
`UNIQUE constraint failed: market_orders.id`，被 watchdog 捕获吞掉，挂单静默失败（服务端不报、
客户端拿到 null）。

复现：任一存档位上有历史成交后重启实例再挂单即触发。本批因此改用全新 `AF_DATA_DIR` 跑 e2e 绕过。
修法很明确（`nextId = max(本地序号+1, 表内 max(id)+1)`），但属撮合核心路径，未擅动。

**2. 树木与导航阻挡格重叠，导致部分树永远砍不动（P2，数据侧）**

`act chop` 对 `treesNear` 里列出的树可能回
`目标格 71,0 为建筑/障碍不可站立`——树确实存在（`growPlants` 里有），但它的格在导航网格里被
标记为建筑/障碍，`actionPrecheck` 在距离判定之后拦住它。`treesNear` 不做这层过滤，
所以 agent 会反复拿一棵砍不动的树撞墙。

e2e 已做容错（这类树标记后换下一簇），但根因在数据：树种在阻挡格上。建议要么
`growPlants` 生成时避开导航阻挡格，要么 `treesNear` 过滤掉不可站目标格的树。

---

## 遗留与建议

- full 档 1120 token 正好顶在批4 目标线上，余量 0。下一批若再加段需要重新分配预算，
  建议先把动作表（当前约 562 token）压一版腾出余量，再往规则里加东西。
- e2e 的砍树依赖「mapdoc 林区簇里至少有一棵可砍的树」。当前 7 个簇够用，但若数据侧修掉
  上述第 2 条缺陷，容错路径可保留（它是防御，不是绕过）。
- `act chop` 的失败文案在「太远」和「目标格不可站立」之间区分清楚，对纯协议 agent 很有价值，
  建议把这两类失败原因在动作目录里写明白。

## 回传文件

- `drive-inbox/wp4-report.md`　本报告
- `drive-inbox/token-evidence.txt`　full/lite/terse token 与分段计数
- `drive-inbox/econ-loop-e2e.log`　e2e 9 项原始输出（exit 0）
- `drive-inbox/vis-report.json`　vis-assert 10 项断言明细
- `drive-inbox/vis-assert.log`　vis-assert 原始日志
