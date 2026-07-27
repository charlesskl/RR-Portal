FROM node:20-alpine

RUN apk add --no-cache tini curl

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY index.html server.js dedup.js fix-record.js ./
COPY config.example.json data.example.json ./

# 数据/配置由 server.js 在 DATA_PATH（默认 /app/data，bind mount）首次启动时自动生成
RUN mkdir -p /app/data && chown -R appuser:appgroup /app

EXPOSE 3000

USER appuser

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
