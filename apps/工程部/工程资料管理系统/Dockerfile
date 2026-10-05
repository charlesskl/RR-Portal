# 工程资料管理系统 — 一体化镜像（前端 + 后端 API）
FROM node:20-alpine

WORKDIR /app

# 先装依赖（利用构建缓存）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 拷贝源码并构建前端
COPY . .
RUN npm run build

# 资料根目录：容器内通过 -v 挂载宿主机目录到 /data
ENV DOCS_ROOT=/data

EXPOSE 3100

# 生产模式运行（vite preview 服务 dist/ + API 中间件）
CMD ["npm", "run", "preview"]
