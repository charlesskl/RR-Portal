# 玩具质量管理系统 ToyQMS
# 两阶段：前端静态导出（Next.js output:export）+ 后端 Fastify/node:sqlite 单容器托管。
# 后端使用 Node 内置 node:sqlite（需 Node ≥ 23.4，这里用 24），无原生编译依赖。

# ── 阶段一：构建前端静态产物 out/ ──
FROM node:24-alpine AS build

# 生产 ECS 在阿里云内，直连 registry.npmjs.org 会超时；npm 默认
# replace-registry-host=npmjs，会把 lockfile 里 npmjs.org 的 resolved URL
# 自动替换成此 registry。仅作用于构建期，不影响运行时。
ENV npm_config_registry=https://registry.npmmirror.com

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --cache /tmp/npm-cache

COPY . .
# 生产部署在 RR Portal 的 /toyqms/ 子路径：构建时注入 basePath，
# 静态资源 URL 带 /toyqms 前缀，nginx 剥前缀后命中容器内 out/_next/*。
RUN NEXT_PUBLIC_BASE_PATH=/toyqms npm run build

# ── 阶段二：运行时（后端 + 静态前端 + SQLite 数据）──
FROM node:24-alpine AS production

ENV npm_config_registry=https://registry.npmmirror.com

RUN apk add --no-cache tini curl
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund --cache /tmp/npm-cache

COPY server/ ./server/
COPY --from=build /app/out ./out

RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

ENV NODE_ENV=production
ENV PORT=3420
ENV HOST=0.0.0.0
ENV TOYQMS_DATA_DIR=/app/data
ENV TOYQMS_STATIC_DIR=/app/out
ENV NODE_NO_WARNINGS=1

EXPOSE 3420

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3420/api/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "server/index.js"]
