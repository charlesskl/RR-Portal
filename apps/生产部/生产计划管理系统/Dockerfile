FROM node:20-alpine AS frontend-build

WORKDIR /build/client
# 阿里云 ECS 直连 registry.npmjs.org 会超时，构建阶段统一使用国内镜像。
ENV npm_config_registry=https://registry.npmmirror.com
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ARG BASE_PATH=/production-plan/
ENV VITE_BASE=${BASE_PATH}
RUN npm run build -- --base ${BASE_PATH}

FROM node:20-alpine AS production

RUN apk add --no-cache tini curl python3 make g++
ENV npm_config_registry=https://registry.npmmirror.com

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY server/ ./
COPY --from=frontend-build /build/client/dist /app/client/dist

RUN mkdir -p /app/server/data && \
    chown -R appuser:appgroup /app

ENV NODE_ENV=production
ENV PORT=8080
ENV CLIENT_DIST=/app/client/dist

EXPOSE 8080

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:8080/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "--max-old-space-size=2048", "app.js"]
