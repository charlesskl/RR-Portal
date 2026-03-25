# ============================================================
# Node.js Dockerfile Template — RR-Portal
# ============================================================
# Managed by the DevOps agent. Do not edit manually.
# Phase 2 onboarding scripts copy this and customize per app.
#
# .dockerignore patterns (create alongside Dockerfile):
#   node_modules, .git, .env, *.md, .vscode, .idea, coverage, dist
# ============================================================

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

# RUN npm run build

# --- Stage 2: Production ---
FROM node:20-alpine AS production

# Install tini for proper signal handling (PID 1 / SIGTERM)
RUN apk add --no-cache tini

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy production dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

# RUN rm -rf tests/ *.test.js

EXPOSE 8080

# Switch to non-root
USER appuser

# Health check — expects GET /health to return 200
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --spider -q http://localhost:8080/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
