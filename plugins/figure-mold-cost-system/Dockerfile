FROM node:20-alpine AS builder

WORKDIR /app

# Build deps for better-sqlite3 native compile
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev


FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tini curl

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy compiled node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY . .

RUN mkdir -p data public/uploads && \
    chown -R appuser:appgroup /app

EXPOSE 3001

USER appuser

HEALTHCHECK --interval=30s --timeout=5s CMD curl -sf http://localhost:3001/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
