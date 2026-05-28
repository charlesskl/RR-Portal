FROM node:20-alpine AS production

RUN apk add --no-cache tini curl python3 make g++

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev && apk del python3 make g++

COPY server/ ./

RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

ENV NODE_ENV=production
ENV PORT=3300
ENV DATA_PATH=/app/data

EXPOSE 3300

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3300/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "app.js"]
