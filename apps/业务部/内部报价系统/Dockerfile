# 内部报价系统 — RR-Portal app
# Node/Express + node:sqlite（内置，无需 better-sqlite3 编译）
# 用 node:22-alpine：实测线上唯一可正常 serving 的镜像。
# 2026-06-17 教训：曾改 node:24-alpine 触发重建，结果容器启动崩溃(502)；而 node:22 镜像稳定 8/8。
# node:24-alpine(musl) 下本应用 node:sqlite 行为异常，回退至 node:22-alpine。勿再改。
FROM node:22-alpine

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
