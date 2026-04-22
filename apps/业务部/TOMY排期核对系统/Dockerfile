# Stage 1: Build frontend
FROM node:24-alpine AS frontend-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Backend runtime
FROM node:24-alpine AS backend
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY server/ ./server/
COPY --from=frontend-build /app/client/dist ./client/dist
EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
