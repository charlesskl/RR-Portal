# 内部报价系统 — RR-Portal app
# Node/Express + node:sqlite（内置，无需 better-sqlite3 编译）
# 2026-06-17: 触发干净重建，使运行镜像真正切到 node:24-alpine（之前部署复用了旧 node:22 镜像）
# 用 node:24-alpine（现行 LTS）：node:sqlite 已转正、无需 --experimental-sqlite flag，
# 与本地验证通过的环境一致。22.x 上 node:sqlite 行为有差异，曾导致容器启动崩溃。
FROM node:24-alpine

# 阿里云 Alpine + npm 镜像（国内 ECS 加速）
RUN sed -i 's|https\?://dl-cdn.alpinelinux.org|https://mirrors.aliyun.com|g' /etc/apk/repositories
RUN npm config set registry https://registry.npmmirror.com

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3211 \
    DB_FILE=/app/backend/data/data.db \
    TZ=Asia/Shanghai

# 先装依赖利用 layer cache（依赖全是纯 JS，无需编译工具）
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY backend ./backend
COPY frontend ./frontend

# 数据库目录 + 上传目录（部署时 bind-mount 持久化这两个目录）
RUN mkdir -p /app/backend/data /app/backend/uploads

EXPOSE 3211
CMD ["node", "backend/server.js"]
