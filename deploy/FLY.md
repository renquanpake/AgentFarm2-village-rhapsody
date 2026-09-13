# 部署到 Fly.io（全免费 7×24 在线）

前提：
- 一台 GitHub 仓库（本项目）
- Fly.io 账号（免费，绑卡备用）
- 你的域名（CNAME 指向 Fly 分配的地址）
- 朋友要访问你的域名，需 Cloudflare 代管或 A 记录指向 Fly

## 1. 装 flyctl

```bash
curl -L https://fly.io/get.sh | sh -s
flyctl login
```

## 2. 初始化 app（基于仓库里的 fly.toml，不部署）

```bash
flyctl launch --no-deploy   # 服务名 agentfarm2，region 选离你最近（szx 深圳 / hk 港）
```

（`flyctl launch` 读仓库里的 `fly.toml` 建 app；`--no-deploy` 只建 app 不部署，
避免卷还没建就部署失败。`fly.toml` 已含配置，无需再写）

## 3. 建持久卷（存存档，VPS 重启不丢）

```bash
flyctl volumes create saves -s agentfarm2 -n 3   # 免费层上限 3GB
flyctl volumes list
```

## 4. 确认 fly.toml

仓库根目录的 `fly.toml` 已写好配置（`AF_DATA_DIR=/data` 挂载卷、`AF_NO_GIT=1` 跳过 git、
`AF_NO_TUNNEL=1` 不启动内网穿透、`force_https=true` 自动证书）。确认 `primary_region` 是你选的 region 即可，无需改动。

## 5. 部署

```bash
flyctl deploy
```

第一次约 2-3 分钟（build 镜像 + 装依赖 + 拷 386M 前端资源）。

## 6. 绑域名

```bash
flyctl certificates add 你的域名.com
```

`force_https=true` 已设，朋友直接访问 `https://你的域名.com`。

DNS（在 Cloudflare 或你的注册商）：
- A 记录 `你的域名.com` → 加 Fly 给你的公网 IP（`flyctl apps list` 查）
- 或 CNAME `你的域名.com` → `你的域名.com.fly.dev`

## 7. 验证

```bash
flyctl curl https://你的域名.com/af/status
flyctl logs --follow
```

朋友浏览器打开 `https://你的域名.com` 进游戏。

## 存档永存

- 存档在 Fly 持久卷（`/data/saves`），重启/重部署不丢
- 要异地备份：本地 `flyctl exec cp /data/saves ./backup` 或接 GitHub
- 账号在 `/data/accounts.json`，同卷持久化

## 资源限制

- 免费层：3 个 shared-cpu-1x (256MB) VM，3GB volume，160GB 出站/月
- 单实例 256MB 跑 afserver.mjs + 游戏逻辑偏紧，2-5 个玩家并发没问题
- 内存不够可降到 1 个 VM 或改 shared-cpu-2x（付费 $5/月起）

## 不绑卡能用的边界

Fly.io 免费层允许 3 个 VM，超量才扣费。你的单实例 + 1 卷不会超，0 元。
