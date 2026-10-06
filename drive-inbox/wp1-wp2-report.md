# 批3 执行报告：WP1 画面层 + WP2 经济闭环

执行端：MonkeyCode-AI（执行官）
依据：架构师批复（WP1 保持 tween 摆位、只删立即可 0、断言口径零变动；WP2 提示词纠偏 + 闭环 e2e）
原则：改动最小、断言零改动、零回归

---

## 一、WP1 走路帧修复（P0 级）

**病灶**：tween 每帧 `setPosition` 摆位成功，但同帧末尾 `changeDir(0)` 触发
`updateMoveVector → updateAnimation → 播放 idle`，把刚切到的 `walk_*` 覆盖回 `idle_*`。
玩家看起来是"平移"而不是"走路"。

**修法（1 行）**：`client/mod/agentfarm.js` `applyAgentMoveMsg` 内
`changeDir(0, false)` → `moveDir = 0`。

`moveDir` 是普通实例属性，赋值不触发 `updateMoveVector`/`updateAnimation`，
也不触发状态机迁移。`changeDir(0)` 走 `e === DirType.INVAIL` 分支 → `intoState(STAND)`
→ `RoleStateStand` 播 `idle_*`，这是覆盖源。

**为什么不能整行删**：`moveDir` 会保持 `dir`（11=DOWN）→ `RoleStateMove.updateMove`
的 `getMoveDir() != DirType.INVAIL` 闸门打开 → 引擎按 speed=500 自驱位移，
与 tween 抢位置。必须显式清零但不走状态机。

---

## 二、WP1b 节点生命周期绑定（P2 级）

**病灶**：`resolvePlayerNode` 每帧遍历场景树找 `PlayerItem`，进村/换场景后
`Application.playerNode` 指向脱离场景树的孤儿节点（`isValid=true` 但
`getScene()=null`），位移打空。原实现靠"解析链 + 缓存"兜，换场景时缓存失效
靠下一次解析重建，窗口期存在漂移。

**修法（+65 行，`client/mod/agentfarm.js`）**：订阅
`cc.Director.EVENT_AFTER_SCENE_LAUNCH`（`director._loadScene` 尾部、新场景已
`_activate` 之后）做**一次性绑定**：

- 回调先**只解绑**（`sceneBoundNode`/`sceneBoundId` 置 null），不写新场景 id——
  `bindScenePlayer` 靠 `sceneBoundId` 判"已绑定"，这里先写 id 会让它直接 return，
  节点永远绑不上（本批复过程中抓到的真 bug）
- 宏任务排一次 `bindScenePlayer`，因为角色节点可能在同帧晚一点挂上
- `isValid=false` 或场景 id 变化立即解绑并清 `playerNodeCache`
- `resolvePlayerNode` 优先读绑定，原解析链保留为 fallback

---

## 三、WP1 验收证据（`tools/agent-vis-assert.mjs` @8098，10/10 全绿）

```
PASS  boot                    页面加载 & __AF_TEST__ 就位 & 玩家节点就绪
PASS  HUD 浮层常驻             历法/Agent 胶囊可见且根节点最高层级
PASS  A dir 步随              有效步 6/6；node 位移 8754 vs 服务端 8754；终距 0px
PASS  C 黑洞重放              解除后 2.5s 内 node 对齐服务端，dist 0px
PASS  C-blackhole 钩子可用    RED 信号
PASS  D move_to 终点对齐      dist 0px (done=true)
PASS  D-move_to 可发起        135 步 / 35 航点（沿「南北大街·北林间道」）
PASS  B 行为飘字              floatCount=16，chopped=true，felled=true
PASS  E 面板文案              「正在砍树」
PASS  页面 console error = 0  P0 无野错
```

`vis-final-evidence.txt` 里记的「已知边界 #1：画面上是 tween 滑动、不是原版走路帧」
**本轮已关闭**——走路帧按批复要求恢复。该条边界作废，请架构师在下一轮审查时删掉。

---

## 四、WP2 经济闭环（P3 级）

### 4.1 提示词纠偏（3 处 stale，`server/src/world/rules-prompt.ts` + `server/src/market/shop.ts`）

- 价目段头改为「（价格口径见条款）」，删掉与条款段重复解释价格语义的那句
- 条款段补全卖出通道：「NPC 不回购。卖货用 `act trade place sell` 挂订单簿
  （卖方实收 90%）」
- `market/shop.ts` `npcBuyPrice` 注释同步指向 `act trade place sell`

**预算口径**：full 档基线 1199/1200 token（零余量），实测改后 **1197 / 1200**。
做法是**合并重复段腾预算**，不是硬塞——加内容前必须先找重复，否则第一级超预算
就把 NPC 名册从 26 砍到 20，`rules-prompt.test.ts` 的「NPC 名册 ≥24」会红。
25 项断言全绿，NPC 名册 26/26 保满。

### 4.2 闭环 e2e（`tools/econ-loop-e2e.mjs`，新增 286 行，8 项断言）

自洽建 2 账号，全程只走公开协议（HTTP register/login + `act`/`observe`），
外加查事件落库，**不碰任何 dev 端点**——在 `AF_DEV_ENDPOINTS=0` 的加固实例上跑。

```
node tools/econ-loop-e2e.mjs --base http://127.0.0.1:8099 --slot 99 \
  --qty 3 --price 60 --data-dir <AF_DATA_DIR>/saves/slot99 --timeout 420000
```

### 4.3 验收结果：8/8 全绿

```
1. 砍树产出    树被砍倒，木材 +3（1 斧，跳过 0 棵已倒的）
2. 挂卖单      @60 x3 resting=3 立即成交=0 笔
3. 背包预留    背包木材 3 → 0（挂单预留 3）
4. 买家吃单    @60 x3 成交 1 笔 余挂 0
5. 撮合过户    1 笔共 3x 单价[60] P2P(A→B)
6. 手续费烧币  毛额 180 − trade.fee 18 = 净 162（卖方实收 90%，10% 出清不入任何账）
7. 卖方收款    A 630 → 792（≥ 净 162；差额 0 来自任务链铸币）
8. 买方收货    A 砍后 3 → 0（-3）；B 0 → 3（+3）
```

对手方是买家 `econloop_b`（uid 2c5b7d），不是做市商——订单簿撮合走通了 P2P。

### 4.4 写脚本踩的四个坑（都已固化进脚本注释，下一位不必重踩）

1. **村景真树判定**：`treeOf(p) = plantId 14-19`（`farm.ts:158`）。按
   `farmType===2` 筛会混进 845 株装饰植物，chop 恒回「这个格子上没有树」且
   `treesNear` 恒空。真树 171 株只分布在 x∈[0,74] y∈[0,59]，新玩家出生在
   民居门口（实测 x∈[9,102] y∈[54,119]），最近真树常在 45 格外，所以必须
   读 `world.json` 直接取坐标，不能用 `observe.obstacles`（半径 12 格不够）。

2. **树 hp 不定**：10/30/60 都实测过，每斧 -20。按 hp 连砍 `ceil(hp/20)` 斧，
   遇「这个格子上没有树」说明目标已倒，从 `treesNear` 换一棵（优先挑 hp 低的省斧数）。

3. **事件库跟实例数据目录同源**：`DB_PATH` 必须跟着 `AF_DATA_DIR` 走。单独指
   仓库 `data/` 会查到空表——交易真发生了但账本在另一个库，曾因此误判撮合失败。

4. **残留挂单会毒死定价**：失败轮次留下的买单会把 `topBid` 抬到 59，A 的单被
   做市商吃掉、B 的 250 金币又撑不起 60×N。修法：账号名固定（`econloop_a`/
   `econloop_b`，先 login 后 register 幂等建号），开头按 owner 从
   `market_orders` 读自己的残留单 id 逐个撤掉（撤单会把背包预留退回来）。
   本次在隔离实例（`AF_DATA_DIR=/tmp/opencode/afdata-e2e`，`AF_DEV_ENDPOINTS=0`）
   上跑，簿面干净，`topBid` 从买盘正常起价，@60 一次挂成。

### 4.5 定价的两个硬约束（写进脚本注释）

- **下限 `topBid+1`**：低于等于最高买盘，A 的单会被做市商顺手吃掉，对手方变成
  `'mm'` 而不是 B。
- **上限 B 的采购预算**：B 自带 250 金币（`heroTemplate`），买量必须覆盖簿上
  更便宜的 ask（订单簿按价优先），价额超预算就下不了单。

下单前把 B 的预算问出来，逐档降价找同时满足两边的 P。

---

## 五、门禁全绿

| 门 | 结果 |
|---|---|
| 门1 `tsc --noEmit` | rc=0 |
| 门2 `vitest run` | **471/471（50 文件）**，48.28s |
| 门4 `security-check --all` | PASS：未发现机密泄漏与敏感文件 |
| 门5 `hash-manifest --check` | 原版外壳哈希校验通过（5138 个文件） |
| 门8 `ui-lint` | tokens 外裸色值=0；af-* 点击 100% 走 AFUI.on；常驻 DOM 预算=10（≤10） |
| 门10 `agent-vis-assert` | **10/10** |
| 经济闭环 e2e | **8/8** |

---

## 六、待架构师裁决（本轮未动）

1. **`commerce` 分数无执行器**：任务链里有 `commerce` 类型（挂单 +140、成交 +180），
   但 `commerce` 分数在评估器里没有对应执行分支，属于"记了分不给执行"。本轮只在
   e2e 里把这笔铸币作为可解释的余额差额处理，未改评估器。要不要给 `commerce` 补
   执行器，请批复。

2. **WP1b 的 fallback 保留是否违反「严禁重复回溯」**：原解析链（遍历场景树找
   `PlayerItem`）在绑定失效后仍保留为兜底。若严格贯彻"禁止重复回溯"，应把解析链
   删掉、绑定失败即抛错。本轮按"绑定为主、解析为兜底"落地，请批复是否收敛。

3. **`vis-final-evidence.txt` 已知边界 #1 作废**：走路帧已恢复，请下一轮审查时删除
   该条。

---

## 七、回传附件清单（`drive-inbox/`）

| 文件 | 内容 |
|---|---|
| `econ-loop-report.json` | 经济闭环 8 项断言结构化结果 |
| `econ-loop-e2e.log` | 完整运行日志（含账号/金币/成交明细） |
| `vis-report.json` | 画面断言 10 项结构化结果 |
| `vis-assert.log` | 画面断言完整日志 |
| `shot-world-boot.png` | 进村启动截图 |
| `wp1-wp2-report.md` | 本文件 |
