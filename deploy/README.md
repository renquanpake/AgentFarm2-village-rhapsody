# AgentFarm2 联机 · 三步部署

把 AgentFarm2 跑成**永久在线**、朋友打开你的域名直接进游戏的联机服。
全免费（Fly.io 免费层），存档自动备份到 GitHub。

## 前置

- 一个 GitHub 账号（放代码 + 自动备份存档）
- 一个域名（可选；没有就用 Fly 分配的随机域名）
- 一台能装 Docker 的机器（本地跑）或用 Fly.io（推荐，免运维）

---

## 方案 A：Fly.io（推荐，7×24 在线）

1. 装 `flyctl` 并登录
2. 部署
3. 建持久卷（存档放这，不丢）
4. 重部署
5. 绑域名（有域名才做）
6. 配置自动备份（存档同步到 GitHub）

部署完：

| 入口 | 用途 |
|------|------|
| `https://你的域名` | 朋友打开直接进游戏（无感连服） |
| `https://<app>.fly.dev` | 随机域名，可分享给朋友 |
| `flyctl logs` | 看服务端日志 |

**为什么朋友打开域名就能进**：客户端 `SERVER` 跟随页面域名（https→wss 自适应），
API + WS 全指向当前页面所在的服务器。你部署到哪个域名，朋友开哪个域名就连上你的服。

**存档安全**：
- 主存 = Fly 持久卷（`/data`），`flyctl` 重启/升级不丢
- 备份 = 每小时自动 `git commit + push` 到 GitHub（`backup-saves.mjs`），双重保险

**内存**：单实例 256MB 能跑 afserver + 2~5 个玩家并发。超了再升 512MB（付费 $5/月）。

---

## 方案 B：本地 Docker + Tailscale（内网联机，免费）

适合"我电脑一直开着，朋友在我家局域网 / 同一 Tailscale 组"的场景。

```bash
# 1. 在 repo 根目录（含 client/ + server/ + data/）起服务
docker compose -f deploy/docker-compose.yml up -d
# 只起 afserver，不挂域名/HTTPS（内网用）
# 本地访问 http://127.0.0.1:8080/

# 2. 同网段朋友访问 http://你的内网IP:8080/
# 不同网段：装 Tailscale，用 http://你的tailscaleIP:8080/
```

存档 = 本地 `./data`（compose 挂载）。

---

## 备份机制说明

`server/afserver.mjs` 每小时调 `tools/backup-saves.mjs`：

| 场景 | 行为 |
|------|------|
| 本地开发（有 git） | `git add data/saves + commit + push`（需配 GitHub PAT） |
| Fly 容器（`AF_NO_GIT=1`） | 只存档到 `/data` 卷，跳过 git（容器里没 git 凭据） |

**配 GitHub 备份凭据**（本地方案）：

```bash
# 1. GitHub → Settings → Developer settings → Personal access tokens → 建 token（勾 repo）
# 2. 配 credential helper（token 不落仓库）
git config credential.helper '!f() { echo "username=你的账号"; echo "password=你的token"; };f'
# 3. 验证
node tools/backup-saves.mjs --push
```

---

## 故障排查

| 现象 | 排查 |
|------|------|
| 朋友打不开域名 | `flyctl logs` 看 afserver 是否 running；Caddy 证书是否签发 |
| 登录失败 500 | `flyctl open` 看 8080 是否通；确认 `AF_DATA_DIR=/data` 卷已挂 |
| 存档没备份 | 本地：`git log data/saves`；Fly：看日志 `[backup]` 行 |
| 内存超 | `fly scale vm -n 1 -s shared-cpu-1x 1024`（升 1GB） |
