FROM node:20-alpine AS frontend-build

WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ARG BASE_PATH=/paiji/
ENV VITE_BASE_PATH=${BASE_PATH}
RUN npx vite build --base ${BASE_PATH}

FROM node:20-alpine AS production

# 系统工具：tini(信号处理) + curl(健康检查) + 编译工具(原生模块) + poppler-utils(PDF转图片)
RUN apk add --no-cache tini curl python3 make g++ poppler-utils

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY server/ ./
COPY --from=frontend-build /build/client/dist /app/client-dist

# Ensure data directory exists with correct ownership
RUN mkdir -p /app/data /app/uploads && \
    chown -R appuser:appgroup /app/data /app/uploads

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_PATH=/app/data

EXPOSE 3000

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "app.js"]
