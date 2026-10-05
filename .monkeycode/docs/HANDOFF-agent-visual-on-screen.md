# 交接文档：批2 P1 画面可视化（agent-visual-on-screen）

- 初版：2026-10-04（上一位 AI 的三步解法与环境止血）
- 本次更新：2026-10-04（接手后推进到活体断言 7/9，余 D/E 两项 + 三个环境/原版坑）
- 台账：`.superpowers/sdd/2026-10-03-agent-visual-on-screen/progress.md`（gitignore 内，本地跟踪，**不在仓库里**）
- 计划稿：`docs/superpowers/plans/2026-10-03-agent-visual-on-screen.md`（唯一在册的未完成批次计划稿）
- 铁律：回复用简中；不碰 `client/assets/**` 原版文件；`__AF_TEST__` 仅当 `localStorage.af.test==='1'` 注册；壳哈希 5140 不变；每 commit 前 security-check；测试实例用 background terminal timeout 0
- **接手第一步**：`node tools/dev-env-check.mjs` 自检环境，再读 `docs/接手与验证指南.md`（凭据 / 克隆 / 起实例 / 门禁）

## 一、一句话现状

进村链路已打通，玩家节点确认挂载；活体断言 **7/9 通过**（boot / A / C / C-黑洞钩子 / B 飘字 / D 可发起 / console error=0），**D 终点对齐与 E 面板文案仍未绿**，二者是同一个根因（D1 arrive 确认环）。

## 二、本次落地的 5 个提交

| commit | 内容 |
|---|---|
| `135ee97` | 服务端 CI 旁路观察者：`state.ciObs` + join 带 `ci=1`（或 URL `?is_ci_bot=true`）跳过单点登录踢人/不写 online/不广播 player_join + `agent_move`/`agent_move_done`/`agent_activity` 镜像补发 + 6 条单测 |
| `99e12e8` | `client/mod/ci-headless.js` + index.html 注入：CI 下贴图全 stub + SpriteFrame rect 报错消音 |
| `bf8029d` | 断言工具补存档槽进村段 + 走 `?ci=1` |
| `cf1cfd6` | 断言工具打通进村链路（存档槽走组件入口）+ 三处等待预算按实测放宽 |
| 待提交 | `getPlayerItem` 能力查找 + `changeDir` 隔离 + `serverPos` 回落 `welcome` + arrive 场景判等放宽 + 工具加 `diag` 输出 |

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

### 3. D/E 同根因：arrive 确认环

- 服务端 `runNavTask` 逐航点 `waitArrive`，超时 `AF_NAV_ARRIVE_MS`（默认 **8000ms**/航点）；10 航点最坏 80s。
- 客户端只在「节点进入目标 80px 内」时回报 `agent_arrive`（posTimer 200ms 轮询）。节点不动 → 从不回报 → 服务端只能盲推超时兜底 → `agent_move_done` 不来 → D 的 `done=false`、终距 ≈ 1000px（正好一个航段）。
- 已放宽一处：场景判等放行未初始化态（`getSceneType()` 在快速进村路径下可能仍是 0，判严了 arrive 永不回报）。**这一改尚未验证**，见第五节。

### 4. ci-headless 的引擎补丁必须轮询挂，不能靠 window 陷阱

- 引擎用 `defineProperty` 覆盖 `window.cc`，`Object.defineProperty(window,'cc',{set(){}})` 陷阱**静默失效**（实测 `_checkRect`/`errorID` 都没挂上，3300 报错照旧）。
- 已改为 200ms 轮询补补丁（命中即停，最多 120s）。实测日志：`ci-headless 引擎补丁：_checkRect=true errorID=true（尝试 3 次）`。

### 5. 环境坑（都是本次实际踩到的）

- **内存气球**：可用内存常在 300–700MB。上一轮遗留的 Chrome 进程（约 900MB）会让下一次 `puppeteer.launch()` 30s 超时起不来；按 PID 精确清理后可用内存回到 1.1GB。
- **`networkidle2` 必然超时**：游戏持续发起资源请求，`waitUntil: 'networkidle2'` 每次都等满 90s，还会让后面的钩子等待连锁失败。已改 `domcontentloaded`。
- **页面冷启动很慢**：mod 钩子 ~20s 就绪，但 Cocos 场景要到 40–85s 才 `getRunningScene()`，软渲染下波动大。所有等待预算都按实测放宽（菜单 200s / 存档面板 180s / arrive 150s）。
- **`__AF_TEST__.diag()`**：本次新增的诊断钩子（`af.test=1` 才注册），返回节点/组件解析结果、`lastMove`、pending 状态与 arrive 五要素。D 场景失败时断言输出会带上它。

## 四、剩余问题（接手就干这三条）

### D（首要，连带 E）：move_to 终点对齐 ≤40px

现状 `dist 1000px (done=false)`。已放宽 arrive 的场景判等，但**改完还没跑过验证**（本轮按用户要求暂停）。下一步：

1. 跑 `node tools/agent-vis-assert.mjs --base http://127.0.0.1:8097 --out /tmp/af-visN`，看 D 的 `actual` 里 `arrive=` 字段（工具会自动带出 `diag().arrive`：target/index/sent/hosted/pos/connected）。
2. `sent=false` → 80px 判等没满足：查 `pos` 是否为节点坐标（`readPlayerPos` 走 `player.getSceneType()` + node 位置）、tween 是否被下一条 `agent_move` 的 `stopAgentTweens()` 提前打断。
3. `sent=true` 但服务端仍超时 → 查 `index`（seg）与服务端 `route.i` 是否对得上，以及 `checkArrive(wp, actual, 120)` 的 120px 校验。
4. 兜底：测试实例上加 `AF_NAV_ARRIVE_MS=3000` 缩短盲推惩罚，先让 D 绿再回头抠真实链路。

### E：面板文案含「砍|正在」

E 依赖 D 先走完（当前 agent 还在 赶路中，chop 根本没发出去，`chopped=false`）。D 绿之后再看是否需要按 Task 5 核对 `#af-agent-live-t` 与 `/af/agent-log` 的同词映射。

### 真人玩家的走路动画（未验证，影响「能不能玩」）

`changeDir` 被隔离后不再抛，但**走路状态机并没有真正接管**——当前位置收敛完全靠 tween 直接摆位。后果：agent 在画面上是「瞬移/平滑滑动」而不是原版走路动画。原因是快速进村路径下玩家被教程置进了 `stateClass` 缺项的状态。**正常玩家流程（非测试注入）下 `changeDir` 是否可用，本次没有验证过。**

## 五、本次没验证/不敢打包票的部分

- arrive 场景判等放宽后的 D 结果（改完即暂停）。
- 真人浏览器（非 CI 模式）里的完整可玩性：本次全部证据都来自 headless 自动化，`--disable-gpu` + swiftshader 与真机渲染路径不同。
- 门3 协议回归 / 门9 回放一致性：需要起服务端跑 `ws-test.mjs` 与 `replay-consistency.mjs`，本次未跑（其余十道门均已跑通，见下）。

## 六、门禁实测（本分支，2026-10-04）

| 门 | 结果 |
|---|---|
| 门1 typecheck | PASS（tsc 0 错）|
| 门2 vitest | 454/454 PASS（基线 448 + CI 观察者单测 6）|
| 门3 协议回归 | 未跑（需起服务端 + `ws-test.mjs`）|
| 门4 秘密扫描 | PASS（`security-check --all`）|
| 门5 原版哈希 | PASS（5140 文件）|
| 门6 导航校验 | PASS（gen-nav/build-scene-collisions/gen-home-slots/check-roads/nav-audit/nav-replay 全过）|
| 门7 角色扮演评测 | PASS |
| 门8 旗舰 UI | PASS（ui-lint + ui-smoke 28/28）|
| 门9 回放一致性 | 未跑 |
| 门10 文本无障碍表面审计 | PASS |
| 门11 存档键审计 | PASS |
| 门12 路由鉴权矩阵 | PASS（49 路由 / 未授权 0）|

## 七、起测试实例的命令（照抄即可）

```bash
bash tools/ci-seed-datadir.sh /tmp/opencode/afdata-vis
cd server && AF_SLOT=99 AF_DATA_DIR=/tmp/opencode/afdata-vis AF_NO_TUNNEL=1 AF_NO_GIT=1 \
  AF_DEV_ENDPOINTS=0 AF_ADMIN_TOKEN=vislocal123 PORT=8097 node src/index.ts
```

浏览器类工具（`agent-vis-assert.mjs` / `shot-client.mjs` / `shot-dm.mjs` / `shot-session.mjs`）已统一改用 `puppeteer-core` + 显式 `executablePath`，与 `tools/package.json` 的声明一致，不再需要给全局 puppeteer 建软链（ESM 不认 `NODE_PATH`，那是本次之前的临时绕过）。`AF_CHROME` 必须用 `node tools/dev-env-check.mjs` 输出的本机实际路径——工具默认值硬编码的 chrome-154 在本机不存在。

## 八、文档归档约定（本次新增）

`docs/superpowers/plans/` 只保留**未完成**批次的计划稿。已完成的四份（nav-obstacle-audit / move-msg-coords / rules-prompt / newbie-tutorial）复选框从未勾选，留着会被误读成待办，已删除；完成记录保留在 `docs/长期工作规划书.md` 批次表与 git 历史里。