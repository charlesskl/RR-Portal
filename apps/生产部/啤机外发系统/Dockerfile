FROM node:20-alpine AS frontend-build

WORKDIR /build/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
ARG BASE_PATH=/pi-outsource/
ENV VITE_BASE_PATH=${BASE_PATH}
RUN npx vite build --base ${BASE_PATH}

FROM node:20-alpine AS production

# 阿里云 Alpine 镜像源（dl-cdn fastly/IPv6 从 ECS 出站不稳，apk 会卡死）
RUN sed -i 's#dl-cdn.alpinelinux.org#mirrors.aliyun.com#g' /etc/apk/repositories

RUN apk add --no-cache tini curl

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY server/package.json server/
RUN cd server && npm install --omit=dev

COPY server/ /app/server/
COPY --from=frontend-build /build/client/dist /app/client/dist

RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

ENV NODE_ENV=production
ENV PORT=3010
ENV DATA_PATH=/app/data

EXPOSE 3010

USER appuser
WORKDIR /app/server

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3010/api/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
