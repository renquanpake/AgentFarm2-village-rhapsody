# AgentFarm2 · Railway 部署指南（免费档，零银行卡）

> 为什么选 Railway：① 永久免费、不要卡；② **WebSocket 心跳保活**——玩家在线就不会睡（跟 HF 那种 48h 无访问就睡的本质区别）；③ GitHub 直接登录；④ 自动 HTTPS + 固定域名。

---

## 关键规格（Free 档）

| 项 | 值 | 对我们的影响 |
|---|---|---|
| 月费 | $0，无需信用卡 | ✅ |
| CPU/内存 | 1 vCPU / 0.5 GB 每服务 | ⚠️ 紧但够 ≤4 人小服 |
| 存储卷 | 0.5 GB | ✅ 存档位只有几十 MB |
| 自定义域名 | ❌ 用 `*.up.railway.app` 子域 | 可后续绑 CF |
| 休眠 | 无出站流量 5~10 分钟 | ✅ **WebSocket 心跳=出站流量，永不睡** |
| 日志 | 3 天历史 | 排障够用 |

**试用档**：新账号送 30 天 × $5 额度（资源翻倍），先试这个再降免费档。

---

## 第 1 步：注册 + 授权仓库

1. `https://railway.com` → **Continue with GitHub**
2. 授权后 Railway 会列出你的 GitHub 仓库——选 `AgentFarm2-village-rhapsody`
3. 新建 Project → Add Service → 从该仓库添加

## 第 2 步：连接仓库并推送

```bash
cd /workspace
git remote add railway https://git@git.railway.app/<workspaceId>/agentfarm2.git
git push railway master
```

首次推会触发构建。镜像 = 项目根目录的 `Dockerfile`，Railway 自动识别。

> 我们已经在仓库根放了 Dockerfile，若 Railway 不自动识别，进 dashboard → Deploy → Build → 设 `Dockerfile` path 即可。

## 第 3 步：配环境变量（在 dashboard → Variables）

镜像已经内置以下缺省值，正常无需手动配（要改再在 dashboard 覆盖）：

```
PORT=8080                          # Railway 运行时会自动注入，别覆盖
AF_NO_TUNNEL=1
AF_NO_GIT=1
AF_DATA_DIR=/data
AF_WS_HEARTBEAT_MS=25000           # < 100s CF空闲线，保持隧道/长连活跃
AF_MAX_PLAYERS=4                   # Free档资源，建议封顶 4 人
AF_DEV_ENDPOINTS=0                 # 生产关调试发币发物端点
```

**Persistent Volume**：dashboard → Storage → New Volume，挂到 `/data`（0.5 GB 上限够用）。存档会跨重启保留。
挂载后 `/data` 是空卷也没关系：服务启动时会自动把镜像内的 `/seed-data` 铺进 `/data`（Node 启动路径 `ensureSeedData()` 执行，dashboard 里配了 startCommand 也绕不开；已存在的存档一律不覆盖）。部署日志会出现 `[seed] 已从 /seed-data 铺设 N 个文件`。

## 第 4 步：上线验收

- 服务 Running 后先看健康检查：`curl -i https://<service-name>.up.railway.app/healthz` 应返回 `200 ok`
- Railway 的 healthcheckPath 已配成 `/healthz`（不依赖静态客户端，构建成功后一定可探活）
- 镜像内含客户端整包（383MB 原版资源），`/` 直接出游戏页；浏览器同源自动连本服务的 `/ws`，无需配 SERVER
- 注册→进村→小地图三件套通即收工（首次加载资源较多，耐心等 20-60 秒）

---

## 已知坑与对策

| 坑 | 对策 |
|---|---|
| 0.5 GB 内存紧张（Node + SQLite + 子进程） | 单存档位、关掉不必要的 agent 子进程（测试期不托管大脑） |
| 重启丢 /data 外的配置 | 配置全走 env，不落盘 |
| 客户端静态页怎么发 | 已随镜像托管，`/` 直接出页；若后续拆 CDN，再把 `client/` 挪出去 |
| assets/personalities 48MB | COPY 进镜像层不占运行时内存；若构建慢可拆为单独 volume 或按需拉 |
| 免费档只有 1 个服务、3 个项目 | 单房版本刚好一个服务，无需扩展 |

---

## 与 HF Static 的关系

你之前提到 HF 只能选 Static——那就把 **HF 当纯静态 CDN**（发 `client/` 目录出网页链接），**Railway 当后端**跑 Node。两者拼起来：

```
玩家点 GitHub Pages 链接（或 HF Space 静态页）
  → 浏览器加载 client/index.html + mod/agentfarm.js
    → SERVER = https://<service>.up.railway.app
      → WS / HTTP 全通
```

---

## 退出 / 取消

Railway 免费档随时停用、不扣费。取消订阅只在升级到 Hobby 之后才会生效，纯 Free 档本来就是 0。