# 服务端生产镜像（Railway / Hugging Face / 任意 Docker 主机通用）
# 构建上下文 = 仓库根目录；客户端静态资源不在此镜像内（走 GitHub Pages/CDN）
FROM node:22-slim

WORKDIR /app

RUN apt-get update -qq && apt-get install -y -qq curl tini && rm -rf /var/lib/apt/lists/*

# 服务端依赖（不含 devDeps；lockfile 已入库，npm ci 可复现）
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 代码与运行数据
COPY server/src ./src
# 绝对路径：./seed-data 会落到 /app/seed-data，与 AF_SEED_DIR=/seed-data 不一致
COPY data /seed-data
COPY assets/personalities ./assets/personalities
COPY assets/generated ./assets/generated
# 客户端整包（383MB 原版资源）：单服务直接出网页，浏览器同源连 /ws
COPY client ./client

# 构建期硬断言：种子数据缺文件直接红，避免运行期静默空世界
RUN test -f /seed-data/seed-villagedb.json \
 && test -f /seed-data/village-farm.json \
 && test -f /seed-data/nav/nav-2.json \
 && test -f /app/client/index.html \
 && test -f /app/client/main.88891.js \
 && test -f /app/client/mod/agentfarm.js

ENV NODE_ENV=production \
    PORT=8080 \
    AF_NO_TUNNEL=1 \
    AF_NO_GIT=1 \
    AF_DATA_DIR=/data \
    AF_SEED_DIR=/seed-data \
    AF_WS_HEARTBEAT_MS=25000 \
    AF_MAX_PLAYERS=4 \
    AF_DEV_ENDPOINTS=0

# 持久卷挂载点：卷为空时由启动命令从 /seed-data 自动铺静态数据（存档不覆盖）
# 0777 兼容 HF Spaces 等以非 root(uid 1000) 运行容器的平台
RUN mkdir -p /data && chmod 0777 /data

EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -sf "http://127.0.0.1:${PORT:-8080}/healthz" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "mkdir -p /data && (cp -an /seed-data/. /data/ || echo '[docker] 预铺种失败，交给 ensureSeedData 重试'); exec node src/index.ts"]