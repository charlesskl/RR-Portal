FROM node:22-alpine AS builder

WORKDIR /app

# Use Aliyun alpine mirror — ECS in China; default dl-cdn (fastly/IPv6) throughput is unreliable
RUN sed -i 's#dl-cdn.alpinelinux.org#mirrors.aliyun.com#g' /etc/apk/repositories

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM node:22-alpine

WORKDIR /app

# Use Aliyun alpine mirror — ECS in China; default dl-cdn (fastly/IPv6) throughput is unreliable
RUN sed -i 's#dl-cdn.alpinelinux.org#mirrors.aliyun.com#g' /etc/apk/repositories

RUN apk add --no-cache tini curl

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
# server.js 启动时 require 历史单价迁移脚本及其数据文件，缺一不可（否则会 MODULE_NOT_FOUND 崩溃）
COPY cost-price-import.js cost-prices-from-workbook.json ./
COPY --from=builder /app/dist ./dist

RUN mkdir -p data && chown -R appuser:appgroup /app

EXPOSE 3008

USER appuser

HEALTHCHECK --interval=30s --timeout=5s CMD curl -sf http://localhost:3008/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
