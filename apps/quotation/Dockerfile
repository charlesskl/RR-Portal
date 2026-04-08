FROM node:20-alpine

# better-sqlite3 requires native compilation
RUN apk add --no-cache python3 make g++ su-exec

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY server/ ./server/
COPY client/ ./client/
COPY docker-entrypoint.sh /docker-entrypoint.sh

# SQLite data directory — mount a volume here in production
RUN mkdir -p server/data && chown -R node:node /app && chmod +x /docker-entrypoint.sh

EXPOSE 3004

ENV NODE_ENV=production
ENV PORT=3004

ENTRYPOINT ["/docker-entrypoint.sh"]

CMD ["node", "server/server.js"]
