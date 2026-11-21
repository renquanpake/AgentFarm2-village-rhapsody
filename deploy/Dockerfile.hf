# Hugging Face Spaces 部署镜像（免费 CPU 档，无需信用卡）
# 构建上下文 = 仓库根目录（HF Space 自动以仓库为上下文构建）
FROM node:22-slim

WORKDIR /app

# 系统依赖（sqlite 是 Node 内置；netcat 供 keepalive 诊断用，可选）
RUN apt-get update -qq && apt-get install -y -qq curl tini && rm -rf /var/lib/apt/lists/*

# 服务端依赖（不含 devDeps）
COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 代码与数据（含 48MB 人设卡面立绘 assets/personalities/）
COPY server/src ./src
COPY data ./data
COPY assets/personalities ./assets/personalities

# 客户端静态页（GitHub Pages 直发是主路径；HF 内托管作兜底，两者皆存）
COPY client/mod ./client/mod
COPY client/index.html ./client/index.html

ENV NODE_ENV=production \
    PORT=8080 \
    AF_NO_TUNNEL=1 \
    AF_NO_GIT=1 \
    AF_DATA_DIR=/data \
    AF_WS_HEARTBEAT_MS=25000

# 持久卷：seed 数据首次启动时自动初始化（saves/accounts 从 seed-villagedb.json 建）
RUN mkdir -p /data && cp -r data/. /data/ 2>/dev/null || true

EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -sf http://127.0.0.1:8080/ >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.ts"]