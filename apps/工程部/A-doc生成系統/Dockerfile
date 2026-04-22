# --- Stage 1: Build frontend ---
FROM node:20-alpine AS frontend-build

WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Stage 2: Production ---
FROM node:20-alpine AS production

# Install tini for proper signal handling + curl for healthcheck
RUN apk add --no-cache tini curl

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app/server

# Install production dependencies
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./

# Copy built frontend — Express serves from path.join(__dirname, '..', 'client', 'dist')
COPY --from=frontend-build /build/client/dist /app/client/dist

# Ensure data & uploads directories exist with correct ownership
RUN mkdir -p /app/server/data /app/server/uploads && \
    chown -R appuser:appgroup /app

ENV NODE_ENV=production

EXPOSE 3002

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3002/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "node scripts/seed-users.js && node app.js"]
