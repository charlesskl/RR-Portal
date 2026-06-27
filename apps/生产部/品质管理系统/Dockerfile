# 兴信 QMS 品质管理系统
# 零 npm 依赖：用 Node 内置 node:http + node:sqlite（需 Node ≥ 22.5，这里用 24），
# 无需 better-sqlite3，省去 alpine 原生编译链。
FROM node:24-alpine AS production

RUN apk add --no-cache tini curl

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# 静态前端 + server/ 一起拷入（server.js 的 ROOT=上级目录=/app 托管静态）
COPY . ./

RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

ENV NODE_ENV=production
ENV PORT=3400
ENV DATA_PATH=/app/data
ENV NODE_NO_WARNINGS=1

EXPOSE 3400

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3400/api/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "server/server.js"]
