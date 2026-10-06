# 交接文档：批2 P1 画面可视化（agent-visual-on-screen）

- 初版：2026-10-04（上一位 AI 的三步解法与环境止血）
- 第二次更新：2026-10-05（活体断言收敛到 **10/10 全绿**，含 4 个此前未记录的真因）
- 台账：`.superpowers/sdd/2026-10-03-agent-visual-on-screen/progress.md`（gitignore 内，本地跟踪，**不在仓库里**）
- 计划稿：`docs/superpowers/plans/2026-10-03-agent-visual-on-screen.md`（唯一在册的未完成批次计划稿）
- 铁律：回复用简中；不碰 `client/assets/**` 原版文件；`__AF_TEST__` 仅当 `localStorage.af.test==='1'` 注册；壳哈希 5138 不变；每 commit 前 security-check；测试实例用 background terminal timeout 0
- **接手第一步**：`node tools/dev-env-check.mjs` 自检环境，再读 `docs/接手与验证指南.md`（凭据 / 克隆 / 起实例 / 门禁）

## 一、一句话现状

活体断言 **10/10 全绿**（boot / HUD / A dir 步随 / C 黑洞重放 / C 钩子 / D move_to 终点 / D 可发起 / B 行为飘字 / E 面板文案 / console error=0）。本轮实测：A `node 位移 11562 vs 服务端 11562, 终距 0px`；C `dist 0px`；D `dist 0px (done=true)`；B `fc=15 felled=true`；E `正在砍树`。

复跑命令：`node tools/agent-vis-assert.mjs --base http://127.0.0.1:8098 --out /tmp/opencode/visN --user userN --pass passN`（单轮 5–12 分钟）。

## 二、本次落地的 5 个提交

| commit | 内容 |
|---|---|
| `135ee97` | 服务端 CI 旁路观察者：`state.ciObs` + join 带 `ci=1`（或 URL `?is_ci_bot=true`）跳过单点登录踢人/不写 online/不广播 player_join + `agent_move`/`agent_move_done`/`agent_activity` 镜像补发 + 6 条单测 |
| `99e12e8` | `client/mod/ci-headless.js` + index.html 注入：CI 下贴图全 stub + SpriteFrame rect 报错消音 |
| `bf8029d` | 断言工具补存档槽进村段 + 走 `?ci=1` |
| `cf1cfd6` | 断言工具打通进村链路（存档槽走组件入口）+ 三处等待预算按实测放宽 |
| 待提交 | `getPlayerItem` 能力查找 + `changeDir` 隔离 + `serverPos` 回落 `welcome` + arrive 场景判等放宽 + 工具加 `diag` 输出 |

后续（`9001484`，收口到 10/10 全绿的那一批，含断言工具改动）：孤儿 PlayerItem 节点判定升级、`resolvePlayerNode()` 收口全仓 6 处、`_nativeAsset` null 守卫、tween 始终执行 + `trySendArrive` 提前 + 阈值 120 对齐、`onAgentMoveDone` 清 payload 回落到 done 权威坐标、`lastAuthAt` 单调时间戳丢弃过期黑洞 pending、断言改顶层 `observe` 协议 + `treesNear` 驱动砍树 + 连砍两斧。

## 三、推进过程里挖到的硬事实（省得重走）

### 1. headless 进村的真实链路（四步，前三步都不响应鼠标/emit）

```
主菜单「开始游戏」→ ClickEvent.emit（btnStart 组件，坐标点击必落空，y 偏 45px）
  → 存档面板（节点名 /^storageItem/，面板根节点不叫 UiStorage，别按名字找面板）
  → storageItem1.onClick(e)   ← 需 e.getButton()===cc.Event.EventMouse.BUTTON_LEFT
  → （新号无存档）UiRename 改名框 → onBtnSure() → startGame(storageKey)
```

- `storageItem1` **没有 cc.Button**，走原版自定义 `MouseEventMgr`；`ClickEvent.emit` / `node.emit('touch-end')` / 坐标点击**全部无效**。
- 存档槽方法体（实测抓取）：
  `onClick(e){ this.onHover(); e.getButton()==BUTTON_LEFT && (haveArchive(storageKey) ? startGame(storageKey) : openUi({uiRes:UI_RENAME, data:(e)=>startGame(storageKey,e)})) }`
- 存档面板弹出**不稳定**：首发 `btnStart` 可能空打（处理器依赖异步资源），工具已改为等面板期间每 15s 重发一次。

### 2. agent 在画面上不动的两个真凶（都已修）

- **`getPlayerItem()` 按模块名 `PlayerItem` 取不到组件** → 每条 `agent_move` 都进 pending 队列永远 flush 不掉。已改为按能力找（节点上唯一带 `changeDir` 的自定义组件）。
- **`changeDir(dir,false)` 外面套 try/catch 是防御性写法，但它今天不抛**（2026-10-06 实测纠正）：`stateClass` 键 1-12 全齐、`state=1(STAND)`、`checkEnableState(MOVE)=false`、`intoState(MOVE)=true`、切后 `state=2(MOVE)`；`?ci=1` 观察者与真实加载两条路径 Spine 状态完全一致（`skeletonData.name==="skeleton"`）。**此前「新手教程把玩家置进 `stateClass` 缺项状态 → `changeDir` 抛 `checkEnableState`」的说法作废。** 真实节点不动的原因只剩上一条 `getPlayerItem()` 取不到组件，以及 2b-1 的孤儿节点。try/catch 保留无害。

修完这两条：A 场景从 node 位移 0 → 292（服务端 255，终距 100px）；C 场景 dist 453px → **0px**；页面 pageerror 归零。

### 2b. 后续三轮又挖出的 4 个真因（2026-10-05，全绿前最后一批）

1. **`Application.playerNode` 会指向脱离场景树的孤儿 PlayerItem**。进村后该引用 `isValid=true` 但 `getScene()` 为 null、parent 是 `"New Node"`，所有位移都打在假节点上。**不能只看 isValid**；必须校验祖先链根节点等于 `cc.director.getScene()`。另外 `getScene()` 在进村链路下 `_scene` 传播会中断（真角色能被 `scene.walk` 命中却返回 null），所以不能用它判等在树内。最终判据：祖先链到根 + 节点上唯一带 `changeDir` 的自定义组件。全仓 6 处直取 `App.default.getIns().playerNode` 已收口到 `resolvePlayerNode()`。
2. **`observe` 是顶层消息，不是 act**。`ws.ts` 里 `case 'observe'` 回包 `{t:'state'}`；发 `act('observe')` 只会回 `unknown action`，之前的断言因此 `treesNear` 恒空、chop 从未真正发出。断言已改顶层协议。
3. **砍树必须站格 + 连砍**。服务端 `actionPrecheck` 要求 `|gx-px|>1 || |gy-py|>1` 即判 `far`；树初始 `hp=30`、每斧 `-20`，**只有 `hp<=0` 才 `publish('正在砍树')`**，所以 E 文案要连砍两斧。站格不能靠 `obstacles.regions` 的 bbox 角/缘格猜（异形丛角格常没树，回「这个格子上没有树」），要 `observe` 取 `treesNear` 的真实树格，砍不到再站到「树与玩家之间那一格」校正一次。
4. **黑洞 pending 会与 `agent_move_done` 抢跑**。黑洞解开时若 `done` 已把节点吸附到终点，重放旧 pending 会把画面 tween 回中间格（症状：C 场景 dist 300px）。修法：`lastAuthAt` 单调权威时间戳——`onAgentMove` 成功应用与 `onAgentMoveDone` 吸附都刷新它，`flushAgentPending` 发现 pending 早于它就丢弃。真网络分区（done 也丢）时 lastAuthAt 不更新，pending 仍会被应用。

### 3. arrive 确认环（D 绿掉的三个配套改动）

- 服务端 `runNavTask` 逐航点 `waitArrive`，超时 `AF_NAV_ARRIVE_MS`（默认 **8000ms**/航点）；38 航点最坏 8s×38。断言窗口因此按服务端真实预算设 `--long 120000`。
- 客户端原「350ms 内到不了就放弃」兜底会直接让 D 停在半路。已改为**始终 tween 到目标**（500px/s，0.2–2.0s），`changeDir(0,false)` 停走路状态机避免与 tween 竞争；跨场景段延后 1s 再重新解析节点。
- `trySendArrive()` 从 posTimer 200ms tick 提到 tween 完成回调里立即发；客户端判等阈值 80px 对齐服务端 `checkArrive` 的 120px。
- `onAgentMoveDone` 记录 `lastServerPos` 并清空 `lastAgentMovePayload`，让 `serverPos()` 回落到 done 的权威落点（末段广播目标只是 next-target，与实落位可差 <120px，混用会假红）。

### 3b. ci-headless 的第三个引擎补丁：`_nativeAsset` null 守卫

贴图全 stub 后，`postLoadNative` 回调在 `native=undefined` 时仍给 `_nativeAsset` 赋值，`Texture2D` 的 setter 读 `undefined._compressed` 直接抛野错（P0 项）。已包一层 null 跳过并记 `window.__AF_CI_ERR__`。只在 CI 模式生效——真浏览器贴图正常，不会命中。

### 4. ci-headless 的引擎补丁必须轮询挂，不能靠 window 陷阱

- 引擎用 `defineProperty` 覆盖 `window.cc`，`Object.defineProperty(window,'cc',{set(){}})` 陷阱**静默失效**（实测 `_checkRect`/`errorID` 都没挂上，3300 报错照旧）。
- 已改为 200ms 轮询补补丁（命中即停，最多 120s）。实测日志：`ci-headless 引擎补丁：_checkRect=true errorID=true（尝试 3 次）`。

### 5. 环境坑（都是本次实际踩到的）

- **内存气球**：可用内存常在 300–700MB。上一轮遗留的 Chrome 进程（约 900MB）会让下一次 `puppeteer.launch()` 30s 超时起不来；按 PID 精确清理后可用内存回到 1.1GB。
- **`networkidle2` 必然超时**：游戏持续发起资源请求，`waitUntil: 'networkidle2'` 每次都等满 90s，还会让后面的钩子等待连锁失败。已改 `domcontentloaded`。
- **页面冷启动很慢**：mod 钩子 ~20s 就绪，但 Cocos 场景要到 40–85s 才 `getRunningScene()`，软渲染下波动大。所有等待预算都按实测放宽（菜单 200s / 存档面板 180s / arrive 150s）。
- **`__AF_TEST__.diag()`**：本次新增的诊断钩子（`af.test=1` 才注册），返回节点/组件解析结果、`lastMove`、pending 状态与 arrive 五要素。D 场景失败时断言输出会带上它。

## 四、走路帧与节点生命周期（2026-10-06 WP1 已落）

### 走路帧动画（2026-10-06 已定位并修复）

**病灶（实测确认）**：`applyAgentMoveMsg` 收尾的 `item.changeDir(0, false)` 走 `e==DirType.INVAIL` 分支 → `intoState(STAND)`，`RoleStateStand` 同帧重播 `idle_down`，把刚播下的 `walk_down` 覆盖掉。帧只活一帧，肉眼就是「滑动/瞬移」。

**不是 `stateClass` 缺项**：键 1-12 全齐、`changeDir` 不抛（见 2）。状态机自驱也确认可用——`intoState(2)` + `setMoveDir(5)` 保持 1.5s，node 从 `[13400,8600]` 走到 `[13633,8600]`（+233px），与 `agentfarm.js` 的 tween 驱动确实并存。

**修法（最小改动，10/10 断言口径零变动）**：`changeDir(0, false)` 改成 `item.moveDir = 0`。`moveDir` 是普通实例属性（`setMoveDir` 内 `this.moveDir = e`），直接赋值不触发 `updateMoveVector` / `updateAnimation`，方向帧不被改；而 `RoleStateMove.updateMove` 的闸门是 `getMoveDir() != DirType.INVAIL`，闸一关状态机就不再自驱位移，位置仍由 tween 独占驱动。整行删除会让 `moveDir` 保持 `dir`，状态机与 tween 抢位置，A/C/D 位移口径就会漂移。`clearAgentMoveState()`（真正停止时）仍走 `changeDir(0)`——那时需要回切 STAND 并停脚步声。

### 节点生命周期（WP1b，已改）

`resolvePlayerNode` 之前每次位移都回溯祖先链 + 遍历组件猜节点。现在订阅 `cc.Director.EVENT_AFTER_SCENE_LAUNCH`（`director._loadScene` 尾部、新场景已 `_activate` 后，是官方权威的场景就绪事件）做一次性绑定：换场景 → 旧绑定失效 → 排一个宏任务解析新角色节点 → 后续全命中缓存。节点 `isValid=false` 或场景 ID 变化立即解绑并清 `playerNodeCache`，避免把上个场景的孤儿节点继续当角色打位置。解析链保留为回退，绑定未就绪时行为与改造前一致（10/10 不回归）。

已修完的部分（不再需要接手）：D move_to 终点对齐（`dist 0px, done=true`）、E 面板文案（`正在砍树`）、C 黑洞重放（`dist 0px`）、P0 `_nativeAsset` 野错（`console error = 0`）、走路帧动画、节点生命周期绑定。

## 五、没验证/不敢打包票的部分

- **真人浏览器（非 CI 模式）里的完整可玩性与走路动画**：全部证据都来自 headless 自动化，`--disable-gpu` + swiftshader 与真机渲染路径不同；CI 模式贴图全 stub，视觉接缝（草地/沙地）无法在沙箱里判断，需真机渲染环境复核。
- 门3 协议回归 / 门9 回放一致性：需要起服务端跑 `ws-test.mjs` 与 `replay-consistency.mjs`，本次未跑（其余门均已跑通，见下）。
- `_nativeAsset` null 守卫只在 CI 模式生效；真浏览器路径未观测到该野错。

## 六、门禁实测（本分支，2026-10-05 复跑）

| 门 | 结果 |
|---|---|
| 门1 typecheck | PASS（tsc 0 错）|
| 门2 vitest | **471/471 PASS**（50 文件）|
| 门3 协议回归 | 未跑（需起服务端 + `ws-test.mjs`）|
| 门4 秘密扫描 | PASS（`security-check`）|
| 门5 原版哈希 | PASS（**5138** 文件，生成物已豁免登记）|
| 门6 导航校验 | PASS（gen-nav/build-scene-collisions/gen-home-slots/check-roads/nav-audit/nav-replay 全过）|
| 门7 角色扮演评测 | PASS |
| 门8 旗舰 UI | PASS（ui-lint 三项：裸色值 0 / AFUI.on 100% / 常驻 DOM 10≤10）|
| 门9 回放一致性 | 未跑 |
| 门10 文本无障碍表面审计 | PASS |
| 门11 存档键审计 | PASS |
| 门12 路由鉴权矩阵 | PASS（49 路由 / 未授权 0）|
| 活体断言 | **10/10 PASS**（`tools/agent-vis-assert.mjs`，见第一节实测数据）|

## 七、起测试实例与复跑断言（照抄即可）

```bash
bash tools/ci-seed-datadir.sh /tmp/opencode/afdata-vis
cd server && AF_SLOT=99 AF_DATA_DIR=/tmp/opencode/afdata-vis AF_NO_TUNNEL=1 AF_NO_GIT=1 \
  AF_DEV_ENDPOINTS=0 AF_ADMIN_TOKEN=vislocal123 PORT=8097 node src/index.ts
```

起好后复跑活体断言（单轮 5–12 分钟，`--long` 是单个 act 的等待窗口，默认 120s 对齐服务端 8s×航点数）：

```bash
node tools/agent-vis-assert.mjs --base http://127.0.0.1:8097 \
  --out /tmp/opencode/visN --user userN --pass passN
```

每轮换 `--user/--pass/--out`，避免与上一轮的存档/报告撞。断言内部走 `?ci=1`（CI 观察者通道，跳过单点登录踢人），不需要改服务端配置。

浏览器类工具（`agent-vis-assert.mjs` / `shot-client.mjs` / `shot-dm.mjs` / `shot-session.mjs`）已统一改用 `puppeteer-core` + 显式 `executablePath`，与 `tools/package.json` 的声明一致，不再需要给全局 puppeteer 建软链（ESM 不认 `NODE_PATH`，那是本次之前的临时绕过）。`AF_CHROME` 必须用 `node tools/dev-env-check.mjs` 输出的本机实际路径——工具默认值硬编码的 chrome-154 在本机不存在。

## 八、文档归档约定（本次新增）

`docs/superpowers/plans/` 只保留**未完成**批次的计划稿。已完成的四份（nav-obstacle-audit / move-msg-coords / rules-prompt / newbie-tutorial）复选框从未勾选，留着会被误读成待办，已删除；完成记录保留在 `docs/长期工作规划书.md` 批次表与 git 历史里。
## 九、经济闭环（WP2，2026-10-06 落地）

架构师批复走「提示词纠偏 + 闭环 e2e」，两项都已落：

### 提示词纠偏（3 处 stale，改完未破预算）

full 档预算基线 **1199/1200 token，零余量**——加一句就把 NPC 名册从 26 砍到 20（`rules-prompt.test.ts` 断言 ≥24 直接红）。做法是**合并重复段**腾空间：

| 位置 | 原表述 | 改后 |
|---|---|---|
| `rules-prompt.ts` 价目段头 | `（买入=玩家实付金币；NPC 收购参考=市场基价六折，当前无卖出通道）` | `（价格口径见条款）` |
| `rules-prompt.ts` 条款段 | `当前没有卖出通道，别承诺能卖` | `NPC 不回购。卖货用 act trade place sell 挂订单簿（卖方实收 90%）` |
| `market/shop.ts` 注释 | 同「暂无卖出通道」 | 指向 `act trade place sell` |

改完实测 **1197 token，NPC 名册 26/26 保满**，`rules-prompt.test.ts` 25/25 绿。教训：预算零余量的提示词只能靠合并重复段加内容，不能硬塞。

### 闭环 e2e（`tools/econ-loop-e2e.mjs`）

自洽建 2 账号，全程只走公开协议 act/observe + 查事件落库，**不碰 dev 端点**——`AF_DEV_ENDPOINTS=0` 的加固实例上也能跑。跑法：

```
node tools/econ-loop-e2e.mjs --base http://127.0.0.1:8098 --slot 98 --qty 3 --price 60 \
  --data-dir /tmp/opencode/afdata-final/saves/slot98 --timeout 420000
```

8 项断言：砍树产出 → 挂卖单 → 背包预留 → 买家吃单 → 撮合过户 → 手续费烧币 → 卖方收款 → 买方收货。

**四个踩过的坑（都写进代码注释了）**：

1. **村景真树判定**：`treeOf(p) = plantId>=14 && plantId<=19`。按 `farmType===2` 筛会混进 845 株装饰植物，chop 回「这个格子上没有树」且 `treesNear` 恒空——空转三轮。真树只有 171 株，分布在 x∈[0,74] y∈[0,59]，而新玩家出生在民居门口（x∈[9,102] y∈[54,119]），最近真树常在 45 格外；`observe.obstacles.regions` 半径只有 12 格够不着，所以按 `--data-dir` 读 `world.json` 取最近真树格喂 `move_to`（测试脚手架，不进协议）。
2. **定价双约束**：下限 `topBid+1`（做市商买单恒为 `base×(1-spread)`≈5，低于它 A 的单会被做市商吃掉、对手方变 `'mm'` 而非买家）；上限 B 的 250 金币自带预算（买量要覆盖簿上更便宜的 ask，订单簿按价优先）。脚本逐档降价找同时满足两边的 P，实测 60→59。
3. **任务铸币污染余额**：挂单触发「集市学徒-挂单」+140、成交触发「成交」+180，直接铸币进 A 的余额，**不能用余额增量做精确等式**。所以精确口径只对事件落库成立：`market_fills` 记对手方与价格、`events.type='trade.fee'` 记烧币金额；余额断言改成 `>= net` 并把差额报告为任务铸币。
4. **事件库跟实例数据目录同源**：`DB_PATH` 必须跟着 `AF_DATA_DIR` 走，单独指仓库 `data/` 会查到空表（交易真发生了但账本在另一个库）——曾因此误判撮合失败。

撮合账（实测）：卖 3 木材 @59 → 毛额 177，`trade.fee` 烧 18（=round(177×0.1)），A 实收 159，B 得 3 木材。

### 待架构师复核（本次自行裁决，未请示）

- `commerce` 维度的 LLM 行为自动执行器未实现（`personality.ts` 已在打分，但没有消费者把它转成挂单动作）。本轮按最小改动原则不动它，只在提示词里把卖出通道说清楚。
