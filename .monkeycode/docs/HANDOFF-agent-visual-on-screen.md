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
- **`item.changeDir(dir,false)` 会抛** `Cannot read properties of undefined (reading 'checkEnableState')`：新手教程把玩家置进了 `stateClass` 里没有的状态，方法内部取 `stateClass[state]` 落空。**这一抛把 `applyAgentMoveMsg` 后面全部打断**（含 350ms 位置收敛兜底），实测症状就是「服务端在动、画面 node 位移恒为 0」。已在 try 内调用。

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

## 四、剩余问题（现在只剩这一条真问题）

### 真人玩家的走路动画（未验证，影响「能不能玩」）

`changeDir` 被隔离后不再抛，但**走路状态机并没有真正接管**——当前位置收敛完全靠 tween 直接摆位。后果：agent 在画面上是「瞬移/平滑滑动」而不是原版走路动画。原因是快速进村路径下玩家被教程置进了 `stateClass` 缺项的状态。**正常玩家流程（非测试注入）下 `changeDir` 是否可用，至今没有验证过。** 这是活体断言覆盖不到的部分——断言只比位置与文案，不看帧动画。

已修完的部分（不再需要接手）：D move_to 终点对齐（`dist 0px, done=true`）、E 面板文案（`正在砍树`）、C 黑洞重放（`dist 0px`）、P0 `_nativeAsset` 野错（`console error = 0`）。

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