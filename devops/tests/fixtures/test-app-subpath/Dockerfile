# ============================================================
# Node.js Monorepo Dockerfile Template — RR-Portal
# ============================================================
# For apps with server/ + client/ structure.
# Stage 1: Build the frontend (Vite/React/Next.js)
# Stage 2: Production server with built client assets
#
# Managed by the DevOps agent. Do not edit manually.
# ============================================================

# --- Stage 1: Build the frontend ---
FROM node:20-alpine AS client-build

WORKDIR /build

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# --- Stage 2: Production server ---
FROM node:20-alpine

# Install tini for proper signal handling and curl for health checks
RUN apk add --no-cache tini curl

WORKDIR /app

# Install server dependencies
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# Copy server code
COPY server/ ./

# Copy built client assets
COPY --from=client-build /build/dist /app/client-dist

# Create data directories (added by QC-10 if needed)
RUN mkdir -p /app/data /app/uploads /app/templates

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app/data /app/uploads /app/templates
USER appuser

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "app.js"]
