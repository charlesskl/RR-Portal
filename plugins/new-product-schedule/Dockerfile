FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tini wget

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json package-lock.json ./
RUN npm ci --production

COPY server.js ./
COPY public/ ./public/

RUN mkdir -p data uploads && \
    chown -R appuser:appgroup /app

EXPOSE 3000

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
