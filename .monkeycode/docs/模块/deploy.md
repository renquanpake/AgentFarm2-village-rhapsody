# 模块：deploy/ + Dockerfile

## 概述

容器化部署方案（`deploy/` 目录 + 仓库根 `Dockerfile`/`fly.toml`/`.dockerignore`）。支持两条路径：**compose（Caddy 反代）** 与 **Fly.io（持久卷）**，均为"朋友打开你的域名即进房"的无感化房间。

**位置**: `deploy/`、`Dockerfile`、`fly.toml`、`.dockerignore`

## 文件构成

| 文件 | 职责 |
|------|------|
| `Dockerfile` | node:20-alpine 基础镜像；配置烤入 `/app/data`；VOLUME `/data`；CMD 补缺失后启 |
| `fly.toml` | Fly.io 定义：`primary_region=szx`、volume `saves`→`/data`（3GB）、env `AF_NO_GIT=1 AF_NO_TUNNEL=1`、`force_https` |
| `deploy/docker-compose.yml` | afserver（`./data:/data`，静态挂 client）+ caddy（`../client:/srv/agentfarm/client:ro`） |
| `deploy/Caddyfile` | `{$CADDY_DOMAIN:?请在 .env 中设 CADDY_DOMAIN=你的域名}` 注入，自动 HTTPS + WS 透传 |
| `deploy/start.bat` | 本地一键开房（Windows，起隧道 + 备份） |
| `deploy/FLY.md` | Fly 部署教程 |
| `deploy/README.md` | compose 部署说明 |

## 关键设计：配置与运行时数据路径分离

```
镜像层（不可变）：/app/data/*.json（配置烤入）
运行时卷：        /data（存档/账号/笔记，持久化）
CMD：            mkdir -p /data && cp -n /app/data/*.json /data/ && exec node /app/afserver.mjs
```

`cp -n`（no-clobber）只补缺失文件，不覆盖运行时已生成的存档/账号——容器重启数据不丢，配置更新（重建镜像）也能平滑补进新配置。`AF_DATA_DIR=/data`、`AF_CLIENT_DIR=/app/client`、`AF_NO_GIT=1`、`AF_NO_TUNNEL=1`。

## compose 启动

```bash
# 仓库根 .env：CADDY_DOMAIN=你的域名.com
echo "CADDY_DOMAIN=你的域名.com" > .env
cd deploy && docker compose up -d
# 朋友打开 https://你的域名.com → 无感进房
```

## Fly.io 启动

```bash
flyctl launch --no-deploy
flyctl volumes create saves -n 3
flyctl deploy
flyctl certificates add 你的域名.com
```

## 相关页面

- [架构 · 容器化部署](../ARCHITECTURE.md)
- [专有概念/无感化联机](../专有概念/无感化联机.md)
- [开发者指南 · 容器化部署](../DEVELOPER_GUIDE.md)
