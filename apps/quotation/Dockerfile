FROM node:20-alpine

# better-sqlite3 requires native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY server/ ./server/
COPY client/ ./client/

# SQLite data directory — mount a volume here in production
RUN mkdir -p server/data

EXPOSE 3004

ENV NODE_ENV=production
ENV PORT=3004

CMD ["node", "server/server.js"]
