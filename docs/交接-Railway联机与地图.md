# 交接：Railway 上线 + 联机 + 小地图（2026-11-21）

> 写给下一个接手的 AI。只记录事实，不重复背景。所有命令可直接照抄。

## 一、当前线上状态（可直接验证）

- 服务：Railway 项目 `732ae600-8fda-4159-b1ce-c4a5073d26d1`，服务 `outstanding-spontaneity`。
- 域名：`https://outstanding-spontaneity-production.up.railway.app`，根路径直接进游戏（客户端整包打进镜像）。
- 探活：`/healthz` 返回 200。
- 持久卷已挂 `/data`（volume `outstanding-spontaneity-volume`，id `a9ecb23c-...`），跨部署保留账号/存档。
- 玩家上限 `AF_MAX_PLAYERS=10`（Railway variable 已设）。
- 已验证：注册/登录、`/af/mapdoc`（全村文本地图）、`/af/mapgrid`（189x173、41 路、16 地标）、`/af/card-image`、`/af/art-manifest` 全 200；`server/ws-test.mjs` 13 项全过（对线上域跑）；部署日志出现 `[seed]` 铺种记录。

## 二、我已经做完的（提交都在 origin/master）

1. `03c2ddf` Railway 首次部署可用：`/healthz`、`railway.json` 去掉 startCommand、Dockerfile 归位仓库根。
2. `2b224ea` 种子数据铺设进 Node 启动路径（`persistence/seed.ts` + `index.ts` 调 `ensureSeedData()`）。**关键教训**：Railway dashboard 的 startCommand 会覆盖 Dockerfile CMD，铺种/初始化只能放 Node 代码里，不能靠 CMD。
3. `f63f370` 修种子目录落点 `COPY data /seed-data`（相对路径 `./seed-data` 会落到 `/app/seed-data`，与 `AF_SEED_DIR`/断言不一致，被 `|| true` 静默吞掉导致空世界）。
4. `066a638` 客户端整包（383MB）打进镜像，根路径直接出游戏页，同源自动连 `/ws`。
5. `e0c82f4` 修镜像布局：`COPY server/src /app/server/src`（config 用 `../..` 推仓库根，src 放 `/app/src` 会把 CLIENT_ROOT 算成 `/client` 全 404）。
6. `57b9433` 修 `agentfarm.js` 一个引号缺失（38b107e 引入）导致整个 mod 脚本 SyntaxError、卡在启动页；顺手把天气/氛围特效限制为进村（welcome 事件）后才显示。
7. `984201f` 用 `welcome` 事件作为进村信号（`window.__AF_INWORLD__`），加载页不再被雨层覆盖。

## 三、我正在进行、被中断的（下一步从这里接）

**目标**：修复玩家反馈的「按 M 打开小地图，显示有问题、看不出实际样子」。

已定位到根因（**未提交**，改动还在工作区）：
- `client/mod/agentfarm.js` 的小地图绘制用 `ctx.fillStyle = 'var(--af-c-sky)'` 等 CSS 变量。**Canvas 2D 不认 CSS 变量**，颜色失效，水/障碍/路/地标全画成错色或残色，所以地图「看不出实际样子」。
- 我已在 `agentfarm.js` 里加了 `cssColor(name, fallback)` 辅助函数（读 `getComputedStyle` 真值，回落 tokens.css 设计值），并把 6 处 canvas 取色替换掉了（行 ~3537/3538/3543/3597/3598/3604/3648/3664/3665）。**改动在工作区，`node --check` 已过，未 commit / 未 push / 未部署**。

**验证进度**（用 Playwright 无头 Chrome 实机进村截图）：
- 进村路径已摸清：`btnList/btnStart`（开始游戏）→ `storageItem1` 组件调 `onClick({getButton:()=>cc.Event.EventMouse.BUTTON_LEFT})` 存档进游戏。脚本 `tools/map-live.mjs` 已能走到村景（sceneType=1，出现 `btnMap` 等 HUD 按钮）。
- **还没截到小地图实际画面**：需要再点 `btnMap` 打开面板截图，确认 cssColor 修复后水/路/地标颜色正确、原版羊皮纸区（LEFT/TOP 起 origW×origH）留白透出正常。

**下一步照做**：
1. 确认工作区改动还在：`git status` 看 `client/mod/agentfarm.js` 未提交；跑 `git diff client/mod/agentfarm.js` 复查 cssColor 替换完整。
2. 无头进村并点 `btnMap` 截图（改 `tools/map-live.mjs`，进村后 `emit('btnMap')` 或调 `injectVillageMap`，再 `page.screenshot`）。
3. 用 `read` 工具看截图，判断地图是否已还原实际样子；颜色仍不对就继续调 `cssColor` 回落值或 `paintMapOverlays`。
4. 全绿后：`git add client/mod/agentfarm.js` → `node tools/security-check.mjs` → commit → `git push origin master` → 触发部署：
   `railway api 'mutation($s:String!,$e:String!){serviceInstanceDeploy(serviceId:$s,environmentId:$e,latestCommit:true)}' --var s=0a116250-c155-4cc3-8f74-4603370c88d6 --var e=d943761f-a155-4534-a983-6a8b02511d35`
   再回 `tools/map-live.mjs` 截图复验线上。

## 四、环境与工具速查

- Railway CLI 已 browserless 登录（账号 `gyy182856@163.com`）。查状态 `railway status`、查部署 `railway deployment list`、看日志 `railway logs --deployment <id>` / `--build`。
- **`railway up` 别用**：客户端 380MB 会撞 Cloudflare 413 上传上限。发布一律走「push GitHub + serviceInstanceDeploy(latestCommit)」，见上。
- 无头浏览器：`playwright-core`（在 `/workspace/node_modules`）+ Chromium `/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`，启动加 `--no-sandbox --disable-dev-shm-usage`。已 `apt-get install` 齐运行库。无中文字体（截图文字是方块，不影响判断画面）。
- 本地起服自检：`AF_NO_TUNNEL=1 AF_NO_GIT=1 AF_DATA_DIR=<临时空目录> AF_SEED_DIR=<git archive 出的 data> node server/src/index.ts`。
- 门禁：commit 前必跑 `node tools/security-check.mjs`；客户端改动跑 `node tools/hash-manifest.mjs --check`（mod 层豁免）、`node --check client/mod/agentfarm.js`。

## 五、已知遗留 / 风险

- `railway.json` 触发 deprecation 警告，2026-12-01 前建议迁 `.railway/railway.ts`（`railway config migrate`）。
- `ui-lint.mjs` 现报 23 处 af-* 面板直接点击绑定（存量，非本次引入），门8 暂红，不影响运行。
- 测试账号（deployok01/railtest01-02 等，密码 pass1234）已占 10 人里的部分名额，正式开放前考虑清掉或放宽 `AF_MAX_PLAYERS`。
- 老服务/域名 `agentfarm2-village-rhapsody-production...` 已离线废弃，别再用。
