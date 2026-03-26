FROM node:20-alpine AS frontend-build

WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ARG BASE_PATH=/paiji/
ENV VITE_BASE_PATH=${BASE_PATH}
RUN npx vite build --base ${BASE_PATH}

FROM node:20-alpine

# Install build tools for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++ curl

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# Remove build tools but keep runtime libs
RUN apk del python3 make g++

COPY server/ ./
COPY --from=frontend-build /build/client/dist /app/client-dist

# Copy initial data files to a seed directory (used if /app/data is empty)
RUN mkdir -p /app/data-seed && cp -r /app/data/* /app/data-seed/ 2>/dev/null || true

# Startup script: seed data if empty, then start
RUN printf '#!/bin/sh\nif [ -z "$(ls -A /app/data 2>/dev/null)" ]; then\n  echo "Seeding initial data..."\n  cp -r /app/data-seed/* /app/data/ 2>/dev/null || true\nfi\nexec node app.js\n' > /app/start.sh && chmod +x /app/start.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_PATH=/app/data

EXPOSE 3000
CMD ["/app/start.sh"]
