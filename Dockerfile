# AgentFarm2 服务端容器镜像
# 用法：fly.io / 任意 Docker 宿主。数据放持久卷，挂到 /data（AF_DATA_DIR）
# 前端静态 + API + WS 全走 8080，Caddy/nginx 反代 + 自动 HTTPS 即可

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

# ---------- 数据目录骨架 ----------
# 只放"配置/种子"类，运行时存档放持久卷。容器启动时 afserver 会按需建 saves/
COPY data/items.json data/
COPY data/npcs.json data/
COPY data/village-collision.json data/
COPY data/village-farm.json data/
COPY data/spawn-points.json data/
COPY data/mine-spots.json data/
COPY data/agent-personalities.json data/

ENV PORT=8080 \
    AF_SLOT=1 \
    AF_NO_TUNNEL=1 \
    AF_DATA_DIR=/data \
    AF_CLIENT_DIR=/app/client

# 持久卷挂载点（Fly.io: /data）
VOLUME ["/data"]

EXPOSE 8080

CMD ["node", "afserver.mjs"]
