FROM node:20-alpine

# 阿里云 Alpine 镜像源（dl-cdn 在国内慢）
RUN sed -i 's|https\?://dl-cdn.alpinelinux.org|https://mirrors.aliyun.com|g' /etc/apk/repositories

# better-sqlite3 需要本地编译
RUN apk add --no-cache python3 make g++ su-exec

WORKDIR /app

# 阿里云 npm 镜像
RUN npm config set registry https://registry.npmmirror.com

# 先装依赖利用 layer cache
COPY package*.json ./
RUN npm ci --omit=dev

# 复制源码
COPY server/ ./server/
COPY client/ ./client/
COPY docker-entrypoint.sh /docker-entrypoint.sh

# Bind mount 会把 host 空目录盖掉 server/data，所以把 seed DB 挪到 /opt/seed,
# entrypoint 在首次启动时再把它复制回 server/data（仅当 host 目录为空）
RUN mkdir -p /opt/seed \
 && if [ -f server/data/quotation.db ]; then mv server/data/quotation.db /opt/seed/quotation.db; fi \
 && mkdir -p server/data \
 && chown -R node:node /app /opt/seed \
 && chmod +x /docker-entrypoint.sh

EXPOSE 3007

ENV NODE_ENV=production
ENV PORT=3007

ENTRYPOINT ["/docker-entrypoint.sh"]

CMD ["node", "server/server.js"]
