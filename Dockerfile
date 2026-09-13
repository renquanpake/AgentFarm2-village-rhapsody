# AgentFarm2 服务端容器镜像
# 配置 .json 进镜像 /app/data（不可变层）；运行时 ./data:/data（compose）或
# Fly volume 挂载，CMD 启动前把配置拷到卷（只补缺失，不覆盖运行时存档/账号）。
# 前端静态 + API + WS 全走 8080，Caddy/nginx 反代 + 自动 HTTPS 即可。

FROM node:20-alpine

WORKDIR /app

# ---------- 依赖（layer 缓存，代码改动不重装）----------
COPY server/package.json ./
RUN npm install --production

# ---------- 服务端 + 工具 ----------
COPY server/afserver.mjs .
COPY tools/ ./tools/

# ---------- 前端静态资源（容器内提供，反代直连即可）----------
COPY client/ ./client/

# ---------- 配置层（放 /app/data，避开 /data 卷挂载遮蔽）----------
COPY data/items.json /app/data/items.json
COPY data/npcs.json /app/data/npcs.json
COPY data/village-collision.json /app/data/village-collision.json
COPY data/village-farm.json /app/data/village-farm.json
COPY data/spawn-points.json /app/data/spawn-points.json
COPY data/mine-spots.json /app/data/mine-spots.json
COPY data/agent-personalities.json /app/data/agent-personalities.json
COPY data/seed-villagedb.json /app/data/seed-villagedb.json

ENV PORT=8080 \
    AF_SLOT=1 \
    AF_NO_TUNNEL=1 \
    AF_DATA_DIR=/data \
    AF_CLIENT_DIR=/app/client

# 运行时持久卷（Fly.io volume / 本地 ./data）
VOLUME ["/data"]

EXPOSE 8080

# 启动：cp -n 把配置补到卷（只补缺失，不覆盖已存在的运行时存档/账号），再启 afserver
CMD ["/bin/sh", "-c", "mkdir -p /data && cp -n /app/data/*.json /data/ 2>/dev/null; exec node /app/afserver.mjs"]
