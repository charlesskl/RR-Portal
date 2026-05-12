FROM node:20-alpine AS frontend-build

WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ARG BASE_PATH=/penyou/
ENV VITE_BASE_PATH=${BASE_PATH}
RUN npx vite build --base ${BASE_PATH}

FROM node:20-alpine AS production

# tini: 信号处理; curl: healthcheck; python3/make/g++: better-sqlite3 原生编译; poppler-utils: PDF→图片
RUN apk add --no-cache tini curl python3 make g++ poppler-utils

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# 安装 server 依赖（编译完原生模块后删 toolchain，缩小镜像）
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev && apk del python3 make g++

COPY server/ /app/server/
COPY --from=frontend-build /build/client/dist /app/client/dist

# data dir（DATA_PATH 指向这里，bind-mount 到 host），权限给 appuser
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

ENV NODE_ENV=production
ENV PORT=3100
ENV DATA_PATH=/app/data

EXPOSE 3100

USER appuser
WORKDIR /app/server

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3100/api/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "app.js"]
