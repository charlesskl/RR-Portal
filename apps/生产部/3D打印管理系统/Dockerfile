FROM node:24-alpine

RUN apk add --no-cache tini

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY index.html server.js dedup.js fix-record.js ./
COPY config.example.json data.example.json ./

RUN cp config.example.json config.json \
    && cp data.example.json data.json \
    && chown -R appuser:appgroup /app

EXPOSE 3000

USER appuser

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
