FROM node:20-alpine AS frontend-build

WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ARG BASE_PATH=/qa-weekly-report/
ENV VITE_BASE_PATH=${BASE_PATH}
RUN npx vite build --base ${BASE_PATH}

FROM node:20-alpine AS production

RUN apk add --no-cache tini curl
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev

COPY server/ /app/server/
COPY --from=frontend-build /build/client/dist /app/client/dist

RUN mkdir -p /app/data /app/server/uploads /app/server/uploads/images \
  && chown -R appuser:appgroup /app/data /app/server/uploads

ENV NODE_ENV=production
ENV PORT=3210
ENV DATA_PATH=/app/data
ENV BASE_PATH=/qa-weekly-report

EXPOSE 3210

USER appuser
WORKDIR /app/server

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3210/api/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
