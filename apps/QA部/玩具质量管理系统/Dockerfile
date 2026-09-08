# 玩具质量管理系统 ToyQMS
# 两阶段：前端静态导出（Next.js output:export）+ 后端 Fastify/node:sqlite 单容器托管。
# 后端使用 Node 内置 node:sqlite（需 Node ≥ 22.5，这里用 24），无原生编译依赖。

# ── 阶段一：构建前端静态产物 out/ ──
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --cache /tmp/npm-cache

COPY . .
RUN npm run build

# ── 阶段二：运行时（后端 + 静态前端 + SQLite 数据）──
FROM node:24-alpine AS production

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
