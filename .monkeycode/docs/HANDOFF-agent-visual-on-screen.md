# 交接文档：批2 P1 画面可视化（agent-visual-on-screen）

- 日期：2026-10-04
- 交接原因：沙箱 headless 环境进不了 Cocos 村景，用户已拍板三步解法，按此继续即可无缝接手
- 台账：`.superpowers/sdd/2026-10-03-agent-visual-on-screen/progress.md`（gitignore 内，本地跟踪）
- 铁律：回复用简中；不碰 `client/assets/**` 原版文件；`__AF_TEST__` 仅当 `localStorage.af.test==='1'` 注册；壳哈希 5140 不变；每 commit 前 security-check；测试实例用 background terminal timeout 0

## 一、任务目标

批2 P1「画面可视化」：agent 的移动/动作要在玩家画面实时可见。五场景活体断言（`tools/agent-vis-assert.mjs`）全绿 + Task 5 面板快照核对 + 全门禁后收尾。

客户端 Task 2-4 代码已写完（未提交），服务端无需为 P1 本身改代码。当前唯一障碍：**沙箱 Puppeteer（headless + swiftshader）跑不进村景**，导致活体验收卡死。

## 二、用户拍板的三步解法（严格按此执行）

### 第一步：沙箱止血——提交 3 张透明占位图

引擎读到文件、不报 `_compressed` 崩溃即可。原版真件等打包真机版再替换。「先跑通，再完美」。

- 3 张 1024x1024 透明 PNG 已造好（手工构造合法 PNG 头，浏览器解码验证过，curl 200）：
  - `client/assets/resources/native/0e/0e2b73ea-4e59-45de-9c83-e1c10acaaeb7.a104c.png`
  - `client/assets/resources/native/63/6310d49a-4b39-444a-860c-6b8e6d9da830.9c7ea.png`
  - `client/assets/resources/native/aa/aa46e9f3-5f47-48a9-ad37-44cfe6afe4f0.a5f67.png`
- 待办：security-check 后 commit，提交信息注明「缺失原版贴图占位，真机版替换」
- 注意：这三张是新増文件，哈希基线 5140 不含它们，`hash-manifest --check` 仍 PASS

### 第二步：干掉测试工具的假红（两处）

1. **move 载荷**：场景 A/C 从传 `x/y` 改成只传 `dir`（up/down/left/right）。
   - 依据：服务端 `server/src/gateway/ws.ts` act move（约 889 行）只认 `msg.dir`，传 x/y 报「dir 需为 up/down/left/right」且不广播——这是之前假红的根因之一。
   - **已在工作区改好（未提交）**，接手时确认即可。
2. **WebSocket 单点踢人白名单**：`/ws` join 是单点登录，同 uid 二连会踢旧连接（ws.ts:427-433）。给验收工具加白名单让它与玩家共存：
   - 服务端 `server/src/gateway/ws.ts` join case（416-447 行）：识别 `msg.ci === 1`（或升级 URL 带 `?is_ci_bot=true`，用户两方案均可），CI 连接**跳过踢人 + 不写 state.online + 不广播 player_join**，存入旁路观察者集合（建议在 `server/src/persistence/state.ts:106` agentArrives 旁加 `ciObs = new Map<string, Set<WebSocket>>()`)。
   - 广播镜像三处：`publishAgentMove`/`publishAgentMoveDone`（ws.ts:163-179）、`publishAgentActivityGlobal`（server/src/cognition/managed.ts:119-128）——给 ciObs 里同 uid 的 ws 补发 agent_move / agent_move_done / agent_activity。
   - ws close（ws.ts:764）记得从 ciObs 清理。
   - 工具侧带上标识。注意：当前工具设计已不开 /ws（观察全走页面钩子），白名单是给未来直连观察用的，属用户明确要求，照做。

### 第三步：绕过 1300 张贴图的显存刺客（核心破局，CI 无渲染模式）

在注入层加环境判断：检测到 CI（URL 参数如 `?ci=1` 或全局变量）时，Hook Cocos 贴图加载链，遇贴图直接返回空白纹理。1300 张图的解码+显存上传瞬间归零，80 秒崩溃彻底解决。

- **推荐实现（已调研确认可行）**：
  - 新建 `client/mod/ci-headless.js`，在 `client/index.html` 第 49 行（所有 mod 脚本之前、settings.js/main.js 之前）加 `<script src="mod/ci-headless.js">`。**index.html 不在哈希基线里（5140 文件已验证不含），可自由编辑**。
  - 检测：`location.search` 含 `ci=1` 或 `localStorage.getItem('af.ci')==='1'`，置 `window.__AF_CI__ = true`。
  - 贴图拦截：wrap `HTMLImageElement.prototype` 的 `src` setter（Cocos 2.4 web 端贴图走 Image 元素加载，引擎无关、零内部 API），src 命中 `.png/.jpg/.jpeg/.webp` 或 `/assets/` 时替换为运行时 canvas 生成的 64x64 透明 dataURL。用 window 属性 trap（`Object.defineProperty(window,'cc',{set(){...}})`）在 cc 定义瞬间补丁：`cc.SpriteFrame.prototype._checkRect` 置空（消 3300/3400 报错刷屏）+ `cc.errorID` 过滤 3300/3400。
  - 空白图别用 1024x1024（每张解码 4MB x 1343 张照样爆内存），64x64（16KB/张，共约 22MB）即可；rect 超限只产生 errorID 日志（errorID 是纯日志不抛异常，已实测），配合 _checkRect 置零可全消。
- 工具侧：`tools/agent-vis-assert.mjs` 的 goto 改 `BASE + '/?ci=1'`。

## 三、按顺序的待办

1. Commit 占位图（见第一步，security-check 先行）
2. Commit `client/mod/agentfarm.js`（Task 2-4 全部客户端改动，静态门禁已过：node --check / ui-lint / 壳哈希 5140 PASS）
3. Commit `client/mod/af-audio/audio.js`（startBgm 真 bug 修复）
4. Commit `tools/agent-vis-assert.mjs`（RED 基线后的 boot 流改造，已含 dir-only move）
5. 落地第二步服务端白名单（ws.ts + state.ts + managed.ts，过 `tsc --noEmit` + vitest）→ commit
6. 落地第三步 `ci-headless.js` + index.html 注入 → commit
7. 工具补 boot 缺失段：点「开始游戏」后还要**点存档槽进村**（主菜单 → btnStart → UI_STORAGE 12 槽面板 → 点 storageItem1 才进村，当前工具缺最后一步）。已验证范式见 `tools/_probe13.mjs`：Cocos 侧按钮用 `ClickEvent.emit([btn])` 直派发（fired=1/1），候选名 storageItem1 → storageItem0 → item1
8. 杀旧实例后重跑：8097 隔离实例（term_1791107225228_272）启动参数 `AF_SLOT=99 AF_DATA_DIR=/tmp/opencode/afdata-vis AF_NO_TUNNEL=1 AF_NO_GIT=1 AF_DEV_ENDPOINTS=0 AF_ADMIN_TOKEN=vislocal123`；`node tools/agent-vis-assert.mjs --base http://127.0.0.1:8097 --out /tmp/af-visN`，逐场景迭代到 9/9 全绿
9. 清理临时探针 `tools/_probe*.mjs`、`tools/_pngtest.mjs`（13 个文件，均 untracked）
10. Task 5（面板快照核对）+ 全门禁（typecheck / vitest / ui-lint / 壳哈希）→ 更新 progress.md

## 四、问题与解决方法（排障结论，勿重走弯路）

| 问题 | 根因 | 解决 |
| --- | --- | --- |
| 进村后 ~80s 崩溃 | swiftshader 软渲染解码 1343 张贴图爆显存/内存（气球环境可用仅 ~600MB） | 第三步 CI 无渲染模式（贴图全 stub） |
| 引擎 `_compressed` 崩溃 | 仓库缺 3 张贴图，404 后 `CCAsset._nativeAsset` setter 读 undefined 中断场景加载 | 第一步占位图 commit |
| 3300/3400 报错刷屏 | SpriteFrame rect 超贴图尺寸（errorID 纯日志，不抛异常不中断） | _checkRect 置零 + errorID 过滤 |
| 工具 move 假红 | act move 只认 dir，传 x/y 被拒且不广播 | 工具已改 dir-only（未提交） |
| 工具 /ws 连接被踢 | join 单点登录踢同 uid 旧连接 | 第二步服务端白名单；当前工具不开 /ws 靠页面钩子规避 |
| boot 一直 GAME-NOT-READY | 只点了「开始游戏」，未点存档槽（原版流程：主菜单 → 开始游戏 → 存档面板 → 点槽进村） | 待办 7：补 storageItem 点击 |
| 弹层挡按钮 | mod 新手引导弹窗居中遮挡 | 工具已有关弹层循环（稍后再说/✕/关闭） |
| audio.js startBgm 未定义 | unlock 首次交互必抛 ReferenceError（真 bug） | 已修：改调 AFAUD.setBgmMode 带 typeof 守卫（未提交） |

## 五、关键事实（省去重查）

### 服务端
- act move 只认 `msg.dir`（STEP=100px）；move_to 是异步 nav task（先回 move_started，走完广播 agent_move_done），并发 move_to 被「上个移动没走完」拒单；chop 成功 publish「正在砍树」→ agent_activity（E 场景断言 /砍|正在/）
- `/agent` 通道无单点登录问题；agentPos 优先级 = state.agentPos > state.online > 存档
- `/ws` join 鉴权：注册账号必须带当前 token（ws.ts:419-424），游客放行

### 客户端引擎（Cocos 2.4.5，design 1920x1080）
- playerNode 挂载在 `Application.getIns().playerNode`（进村后才 SET）
- `Node.walk(cb)` 是回调式；按钮点击可靠范式 = `ClickEvent.emit([btn])`
- mod 脚本加载顺序：index.html 49-53 行（mod 全部）→ 54 settings.js → 56 main.js；index.html 不在哈希基线

### 环境坑
- 内存气球：`free` 总内存 7965MB 是虚的，实际可用 ~600MB 时 Chrome 必崩；`background_terminal_list` 看配额
- 长命令会把 bash 工具挂死：探针/测试一律 background terminal + timeout 0
- `node --check` 对 ES module 语法可能误报
- `cc.view.convertToUI` 不存在；console error 过滤：`Failed to load resource` 归 resource404s 不计 P0 野错

### 当前断言基线
- RED 基线 `/tmp/af-vis8/report.json` 1/9（唯一 PASS 的 console-error=0 也是误判，实际含 3300/3400）；boot 三段式改造后 FAIL 在 GAME-NOT-READY（等三步落地应解除）

## 六、未提交改动清单（接手时 `git status` 核对）

- `M client/mod/agentfarm.js`：Task 2-4（resolvePlayerNode 三级冗余链 / agentPending 重放队列 / 350ms 插值兜底 / onAgentMoveDone 终点收敛 / spawnAgentFloatText 飘字 / __AF_TEST__ 五钩子，约 237 行）
- `M client/mod/af-audio/audio.js`：startBgm 修复
- `M tools/agent-vis-assert.mjs`：boot 三段式、moveToDone/doneCount、console 过滤、关弹层、点开始游戏、dir-only move
- `?? client/assets/resources/native/{0e,63,aa}/*.png`：3 张占位图
- `?? tools/_probe*.mjs`、`tools/_pngtest.mjs`：临时探针（待办 9 清理）

服务端 `server/` 目前零改动（只做过只读调研），第二步白名单是第一处服务端改动。
