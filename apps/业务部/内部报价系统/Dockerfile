# 内部报价系统 — RR-Portal app
# Node/Express + node:sqlite（内置，需 Node 22.5+；无需 better-sqlite3 编译）
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
