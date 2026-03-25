FROM node:20-alpine

WORKDIR /app

# Install build tools for native modules (bcrypt, jimp, etc.)
RUN apk add --no-cache python3 make g++ curl

# ── Build frontend ──
COPY client/package.json client/package-lock.json ./client/
WORKDIR /app/client
RUN npm ci

COPY client/ ./
RUN npm run build

# ── Install backend ──
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./

# Express serves from path.join(__dirname, '..', 'client', 'dist')
# __dirname = /app/server → clientDist = /app/client/dist (already built above)

# Ensure data & uploads directories exist
RUN mkdir -p /app/server/data /app/server/uploads

EXPOSE 3002

CMD ["sh", "-c", "node scripts/seed-users.js && node app.js"]
