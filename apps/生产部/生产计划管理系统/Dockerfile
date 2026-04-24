FROM node:20-alpine AS frontend-build

WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ARG BASE_PATH=/production-plan/
ENV VITE_BASE=${BASE_PATH}
RUN npx vite build --base ${BASE_PATH}

FROM node:20-alpine AS production

RUN apk add --no-cache tini curl python3 make g++

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
CMD ["node", "app.js"]
